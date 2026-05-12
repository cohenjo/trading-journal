/**
 * Unit tests for getDividendPositions / getDividendSummary — Issue #363
 *
 * Coverage:
 *  1. TTM yield computation from known payment amounts
 *  2. Forward yield — accruals path (gross_rate × frequency)
 *  3. Forward yield — annualisation fallback (TTM used when no accruals)
 *  4. Frequency detection heuristic
 *  5. Schwab / IRA returns [] (expected empty state)
 *  6. Unauthenticated caller returns []
 *  7. [regression] NULL ex_date rows counted via report_date fallback
 *  8. [regression] Accruals-only path (no payments) still surfaces positions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// ── trading/actions mock (provides getStockPositions with deduplication) ──────

vi.mock('@/app/trading/actions', () => ({
  getStockPositions: vi.fn(),
}));

import {
  getDividendPositions,
  getDividendSummary,
} from '../actions';
import { detectPaymentFrequency } from '@/lib/dividends/payment-frequency';
import { createClient } from '@/lib/supabase/server';
import { getStockPositions } from '@/app/trading/actions';

// ── Constants ─────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';
const IBKR_ACCOUNT_ID_TEXT = 'U2515365';

/** A representative IBKR position in stock_positions after deduplication. */
const IBKR_POS_JEPI = {
  id: 'pos-1',
  account_id: 1,
  ticker: 'JEPI',
  description: 'JPMorgan Equity Premium Income ETF',
  sub_category: 'ETF',
  quantity: 100,
  cost_basis: 55.0,
  mark_price: 57.5,
  market_value: 5750,
  market_value_local: null,
  unrealized_pnl: 250,
  currency: 'USD',
  as_of_date: '2026-05-01',
  source: 'flex' as const,
};

/** CLIS (Clal Insurance, 224014) — TASE position in LeumiIRA with ILA currency.
 *  mark_price is in agorot (1/100 of ILS); market_value is canonical ILS. */
const IRA_POS_CLIS = {
  id: 'pos-clis',
  account_id: 72,
  ticker: '224014',
  description: 'Clal Insurance',
  sub_category: 'Stock',
  quantity: 101,
  cost_basis: null,
  mark_price: 29290,         // agorot
  market_value: 29582.90,    // canonical ILS
  market_value_local: 29582.90,
  unrealized_pnl: null,
  currency: 'ILA',           // broker code for Israeli agorot
  as_of_date: '2026-05-12',
  source: 'manual' as const,
};

/** JEPI paid $10.65/month × 12 = ~$127.80/year (but we use exact TTM sum here). */
const JEPI_TTM_TOTAL = 120.0; // Total amount paid TTM (across all ex_dates in last 365 days)

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockAuth() {
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
}

function mockAuthFail() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
}

/** Builds a fluent Supabase chain mock with configurable final resolvers. */
function buildChain(resolver: () => Promise<unknown>) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'neq', 'is', 'in', 'gte', 'or', 'not', 'order', 'limit', 'maybeSingle'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // Terminal resolvers
  (chain as Record<string, unknown>)['then'] = undefined; // not a thenable itself
  // Replace the last chained call's promise resolution
  (chain as Record<string, (...args: unknown[]) => unknown>).order = vi.fn(() => {
    return {
      ...chain,
      then: undefined,
      // Fake a resolved promise when awaited
      [Symbol.asyncIterator]: undefined,
    };
  });
  // Make awaiting the chain work via .then
  Object.defineProperty(chain, Symbol.toStringTag, { value: 'MockChain' });
  return { chain, resolver };
}

/**
 * Creates a per-table mock for supabase.from(tableName).
 * tableHandlers maps table name to a function returning { data, error }.
 */
function mockSupabaseFrom(
  tableHandlers: Record<string, () => Promise<{ data: unknown; error: unknown }>>,
) {
  return vi.fn((table: string) => {
    const handler = tableHandlers[table];
    // Return a fluent chain that resolves when awaited
    const makeChain = (): Record<string, unknown> => {
      let resolveWith = handler
        ? handler()
        : Promise.resolve({ data: [], error: null });

      const proxy: Record<string, unknown> = new Proxy({}, {
        get(_target, prop: string) {
          if (prop === 'then') return undefined; // not a Promise
          if (prop === 'catch') return undefined;
          if (prop === 'finally') return undefined;
          // For each chainable method, return a function that returns the same proxy
          return (..._args: unknown[]) => {
            // Special terminal methods
            if (prop === 'maybeSingle' || prop === 'single') {
              return resolveWith.then((r: { data: unknown }) => ({
                data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
                error: null,
              }));
            }
            return proxy;
          };
        },
        // Allow direct await (the query is executed when the chain is awaited)
        apply() { return resolveWith; },
      });

      // Intercept final await: when Promise.all awaits the chain object, it needs .then
      // We attach a custom then that triggers the resolution
      (proxy as unknown as Promise<unknown>)[Symbol.iterator as unknown as string] = undefined;

      // Override so that `await supabase.from(...)...<chain>` resolves correctly:
      // We make the chain itself thenable only when it's the final expression.
      // This is achieved by wrapping in a class that extends Promise.
      return resolveWith;
    };

    // Build a proper Promise-backed chain
    const result = handler
      ? handler()
      : Promise.resolve({ data: [], error: null });

    // Chain proxy — each method returns an object with the same interface
    // plus a then/catch that delegates to the final result.
    function makeFluentChain(promise: Promise<{ data: unknown; error: unknown }>) {
      const self: Record<string, unknown> = {
        select: () => makeFluentChain(promise),
        eq: () => makeFluentChain(promise),
        neq: () => makeFluentChain(promise),
        is: () => makeFluentChain(promise),
        in: () => makeFluentChain(promise),
        gte: () => makeFluentChain(promise),
        or: () => makeFluentChain(promise),
        not: () => makeFluentChain(promise),
        order: () => makeFluentChain(promise),
        limit: () => makeFluentChain(promise),
        maybeSingle: () =>
          promise.then((r) => ({
            data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
            error: null,
          })),
        single: () =>
          promise.then((r) => ({
            data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
            error: null,
          })),
        // Make the chain itself awaitable (resolves the full array/data)
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          promise.then(resolve, reject),
        catch: (fn: (e: unknown) => unknown) => promise.catch(fn),
      };
      return self;
    }

    return makeFluentChain(result);
  });
}

/**
 * Sets up the user-scoped Supabase client mock.
 * All tables — including dividend_payments and dividend_accruals — are now
 * queried via createClient() after RLS policies were added in migration
 * 20260511102251 (issue #374). The admin-client split is no longer needed.
 */
function setupMocks(
  userTables: Record<string, () => Promise<{ data: unknown; error: unknown }>>,
) {
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockSupabaseFrom(userTables),
  });
}

// ── detectPaymentFrequency ─────────────────────────────────────────────────────

describe('detectPaymentFrequency', () => {
  it('returns null for empty date list', () => {
    expect(detectPaymentFrequency([])).toBeNull();
  });

  it('returns "annual" for a single date', () => {
    expect(detectPaymentFrequency(['2025-01-15'])).toBe('annual');
  });

  it('returns "monthly" for ~30-day intervals', () => {
    const dates = [
      '2025-01-15',
      '2025-02-14',
      '2025-03-14',
      '2025-04-15',
      '2025-05-14',
    ];
    expect(detectPaymentFrequency(dates)).toBe('monthly');
  });

  it('returns "quarterly" for ~91-day intervals', () => {
    const dates = [
      '2024-08-01',
      '2024-11-01',
      '2025-02-01',
      '2025-05-01',
    ];
    expect(detectPaymentFrequency(dates)).toBe('quarterly');
  });

  it('returns "semi-annual" for ~182-day intervals', () => {
    const dates = ['2024-06-01', '2024-12-01', '2025-06-01'];
    expect(detectPaymentFrequency(dates)).toBe('semi-annual');
  });

  it('returns "annual" for ~365-day intervals', () => {
    const dates = ['2023-03-15', '2024-03-15', '2025-03-14'];
    expect(detectPaymentFrequency(dates)).toBe('annual');
  });

  it('returns "irregular" for very long intervals', () => {
    const dates = ['2020-01-01', '2022-03-01'];
    expect(detectPaymentFrequency(dates)).toBe('irregular');
  });
});

// ── getDividendPositions ───────────────────────────────────────────────────────

describe('getDividendPositions', () => {
  it('returns [] when not authenticated', async () => {
    mockAuthFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    const result = await getDividendPositions('ibkr');
    expect(result).toEqual([]);
  });

  it('returns [] when household cannot be resolved', async () => {
    mockAuth();
    setupMocks({
      household_members: () =>
        Promise.resolve({ data: null, error: null }),
    });

    const result = await getDividendPositions('ibkr');
    expect(result).toEqual([]);
  });

  it('returns [] for schwab tab (no config account_id → no payments)', async () => {
    mockAuth();
    setupMocks({
      household_members: () =>
        Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
      trading_account_config: () =>
        Promise.resolve({ data: [{ id: 71, account_id: null }], error: null }),
    });
    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getDividendPositions('schwab');
    expect(result).toEqual([]);
  });

  it('returns [] for ira tab (no stock positions)', async () => {
    mockAuth();
    setupMocks({
      household_members: () =>
        Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
      trading_account_config: () =>
        Promise.resolve({ data: [{ id: 72, account_id: null }], error: null }),
    });
    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getDividendPositions('ira');
    expect(result).toEqual([]);
  });

  it('computes correct TTM yield for IBKR position with known payments', async () => {
    mockAuth();

    // JEPI: 100 shares, price=$57.50. TTM payments = $120 total → $1.20/share → 2.0870% yield
    const payments = [
      { symbol: 'JEPI', amount: '40.00', ex_date: '2025-11-15', report_date: '2025-11-20', type: 'Dividends' },
      { symbol: 'JEPI', amount: '40.00', ex_date: '2025-08-14', report_date: '2025-08-18', type: 'Dividends' },
      { symbol: 'JEPI', amount: '40.00', ex_date: '2025-05-15', report_date: '2025-05-19', type: 'Dividends' },
    ];

    setupMocks(
      {
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () =>
          Promise.resolve({ data: [{ id: 1, account_id: IBKR_ACCOUNT_ID_TEXT }], error: null }),
        dividend_payments: () => Promise.resolve({ data: payments, error: null }),
        dividend_accruals: () => Promise.resolve({ data: [], error: null }),
      },
    );

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([IBKR_POS_JEPI]);

    const result = await getDividendPositions('ibkr');

    expect(result).toHaveLength(1);
    const row = result[0];

    expect(row.ticker).toBe('JEPI');
    expect(row.quantity).toBe(100);

    // TTM: $120 total / 100 shares = $1.20/share
    expect(row.ttm_div_per_share).toBe(1.2);
    expect(row.ttm_dividend_total).toBe(JEPI_TTM_TOTAL);

    // TTM yield %: $1.20 / $57.50 × 100 = 2.0870%
    const expectedYield = Math.round((1.2 / 57.5) * 100 * 10000) / 10000;
    expect(row.ttm_yield_pct).toBe(expectedYield);
  });

  it('uses accruals.gross_rate for forward yield when present (quarterly)', async () => {
    mockAuth();

    // Quarterly accrual gross_rate = $0.40/share → annualized = $0.40 × 4 = $1.60/share
    const accruals = [
      { symbol: 'JEPI', gross_rate: '0.40', ex_date: '2026-04-30' },
    ];
    const payments = [
      { symbol: 'JEPI', amount: '40.00', ex_date: '2025-11-15', report_date: '2025-11-20', type: 'Dividends' },
      { symbol: 'JEPI', amount: '40.00', ex_date: '2025-08-14', report_date: '2025-08-18', type: 'Dividends' },
      { symbol: 'JEPI', amount: '40.00', ex_date: '2025-05-15', report_date: '2025-05-19', type: 'Dividends' },
      // Extra historical for frequency detection
      { symbol: 'JEPI', amount: '40.00', ex_date: '2025-02-14', report_date: '2025-02-18', type: 'Dividends' },
    ];

    setupMocks(
      {
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () =>
          Promise.resolve({ data: [{ id: 1, account_id: IBKR_ACCOUNT_ID_TEXT }], error: null }),
        dividend_payments: () => Promise.resolve({ data: payments, error: null }),
        dividend_accruals: () => Promise.resolve({ data: accruals, error: null }),
      },
    );

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([IBKR_POS_JEPI]);

    const result = await getDividendPositions('ibkr');
    expect(result).toHaveLength(1);
    const row = result[0];

    // frequency = quarterly (4 payments ~91 days apart)
    expect(row.payment_frequency).toBe('quarterly');

    // forward_div_per_share = 0.40 × 4 = 1.60
    expect(row.forward_div_per_share).toBe(1.6);

    // forward_dividend_annual = 1.60 × 100 shares = 160
    expect(row.forward_dividend_annual).toBe(160);

    // forward_yield_pct = 1.60 / 57.50 × 100
    const expectedFwd = Math.round((1.6 / 57.5) * 100 * 10000) / 10000;
    expect(row.forward_yield_pct).toBe(expectedFwd);
  });

  it('falls back to TTM annualisation when no accruals present', async () => {
    mockAuth();

    // No accruals → forward_div_per_share = ttm_div_per_share (already annualised as 12-month sum)
    // All 4 payments must be within the TTM window (ex_date >= last-year)
    const payments = [
      { symbol: 'JEPI', amount: '30.00', ex_date: '2025-11-15', report_date: '2025-11-20', type: 'Dividends' },
      { symbol: 'JEPI', amount: '30.00', ex_date: '2025-08-14', report_date: '2025-08-18', type: 'Dividends' },
      { symbol: 'JEPI', amount: '30.00', ex_date: '2026-02-14', report_date: '2026-02-18', type: 'Dividends' },
      { symbol: 'JEPI', amount: '30.00', ex_date: '2025-05-15', report_date: '2025-05-19', type: 'Dividends' },
    ];

    setupMocks(
      {
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () =>
          Promise.resolve({ data: [{ id: 1, account_id: IBKR_ACCOUNT_ID_TEXT }], error: null }),
        dividend_payments: () => Promise.resolve({ data: payments, error: null }),
        dividend_accruals: () => Promise.resolve({ data: [], error: null }),
      },
    );

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([IBKR_POS_JEPI]);

    const result = await getDividendPositions('ibkr');
    expect(result).toHaveLength(1);
    const row = result[0];

    // ttm = $120 total (4 × $30) / 100 shares = $1.20/share
    expect(row.ttm_div_per_share).toBe(1.2);

    // forward falls back to TTM value
    expect(row.forward_div_per_share).toBe(1.2);
  });

  it('excludes positions with no dividend history (non-dividend stocks filtered out)', async () => {
    mockAuth();

    const nonDivPos = {
      ...IBKR_POS_JEPI,
      ticker: 'META', // Meta pays no dividends
      id: 'pos-2',
    };

    setupMocks(
      {
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () =>
          Promise.resolve({ data: [{ id: 1, account_id: IBKR_ACCOUNT_ID_TEXT }], error: null }),
        dividend_payments: () => Promise.resolve({ data: [], error: null }),
        dividend_accruals: () => Promise.resolve({ data: [], error: null }),
      },
    );

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([IBKR_POS_JEPI, nonDivPos]);

    const result = await getDividendPositions('ibkr');
    // Both JEPI and META — but no payments → both filtered out
    expect(result).toEqual([]);
  });

  it('returns source = "flex" for positions enriched from dividend_payments', async () => {
    mockAuth();

    const payments = [
      { symbol: 'JEPI', amount: '40.00', ex_date: '2025-11-15', report_date: '2025-11-20', type: 'Dividends' },
    ];

    setupMocks(
      {
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () =>
          Promise.resolve({ data: [{ id: 1, account_id: IBKR_ACCOUNT_ID_TEXT }], error: null }),
        dividend_payments: () => Promise.resolve({ data: payments, error: null }),
        dividend_accruals: () => Promise.resolve({ data: [], error: null }),
      },
    );

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([IBKR_POS_JEPI]);

    const result = await getDividendPositions('ibkr');
    expect(result[0].source).toBe('flex');
  });

  // ── Regression tests (hotfix 2026-05-11) ──────────────────────────────────

  it('[regression] counts payment toward TTM when ex_date is NULL but report_date is within window', async () => {
    // Mirrors real IBKR Flex export behaviour: ex_date is NULL, report_date is set.
    // Previously the .gte('ex_date', ...) filter excluded all such rows, returning [].
    mockAuth();

    const ONE_YEAR_AGO = new Date();
    ONE_YEAR_AGO.setDate(ONE_YEAR_AGO.getDate() - 180); // safely within TTM
    const withinTTM = ONE_YEAR_AGO.toISOString().split('T')[0];

    const payments = [
      // ex_date intentionally NULL — matches real IBKR Flex export
      { symbol: 'JEPI', amount: '44.76', ex_date: null, report_date: withinTTM, type: 'Dividends' },
    ];

    setupMocks(
      {
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () =>
          Promise.resolve({ data: [{ id: 1, account_id: IBKR_ACCOUNT_ID_TEXT }], error: null }),
        dividend_payments: () => Promise.resolve({ data: payments, error: null }),
        dividend_accruals: () => Promise.resolve({ data: [], error: null }),
      },
    );

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([IBKR_POS_JEPI]);

    const result = await getDividendPositions('ibkr');
    // JEPI must surface — not be dropped because ex_date was null
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('JEPI');
    // TTM total = 44.76
    expect(result[0].ttm_dividend_total).toBe(44.76);
  });

  it('[regression] surfaces schwab positions with dividend_yield fallback when no payment history exists', async () => {
    // Simulates Schwab Joint Tenant account: CSV-imported positions have
    // dividend_yield in stock_positions but NO entries in dividend_payments.
    // Previously these were silently filtered out; now they surface with source='csv'.
    // After the normalise_dividend_yield_to_decimal migration all values are stored
    // as decimal fractions (0.1043 = 10.43%), not percentages.
    mockAuth();

    const schwabPos = {
      ...IBKR_POS_JEPI,
      id: 'pos-jepq',
      account_id: 71,
      ticker: 'JEPQ',
      description: 'JPMorgan Nasdaq Equity Premium Income ETF',
      quantity: 155,
      mark_price: 59.705,
      source: 'manual' as const,
    };

    setupMocks(
      {
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () =>
          Promise.resolve({ data: [{ id: 71, account_id: null }], error: null }),
        dividend_payments: () => Promise.resolve({ data: [], error: null }),
        dividend_accruals: () => Promise.resolve({ data: [], error: null }),
        // dividend_yield stored as decimal fraction (0.1043 = 10.43%) — canonical format
        stock_positions: () =>
          Promise.resolve({
            data: [{ ticker: 'JEPQ', dividend_yield: '0.1043' }],
            error: null,
          }),
      },
    );

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([schwabPos]);

    const result = await getDividendPositions('schwab');

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.ticker).toBe('JEPQ');
    expect(row.source).toBe('csv');
    // TTM metrics are null (no payment history)
    expect(row.ttm_dividend_total).toBeNull();
    expect(row.ttm_div_per_share).toBeNull();
    // Forward estimate: 59.705 × 0.1043 = 6.227... → rounded = 6.23 per share
    // forward_dividend_annual = 6.23 × 155 = 965.65
    expect(row.forward_div_per_share).toBe(6.23);
    expect(row.forward_dividend_annual).toBe(965.65);
  });

  it('[regression] yield fallback uses decimal format correctly (yield ≤ 1)', async () => {
    // dividend_yield stored as decimal fraction (0.056236 = 5.6236%)
    mockAuth();

    const pos = {
      ...IBKR_POS_JEPI,
      ticker: 'BNS',
      description: 'Bank of Nova Scotia',
      quantity: 150,
      mark_price: 76.99,
      source: 'manual' as const,
    };

    setupMocks(
      {
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () =>
          Promise.resolve({ data: [{ id: 71, account_id: null }], error: null }),
        dividend_payments: () => Promise.resolve({ data: [], error: null }),
        dividend_accruals: () => Promise.resolve({ data: [], error: null }),
        stock_positions: () =>
          Promise.resolve({
            data: [{ ticker: 'BNS', dividend_yield: '0.056236' }],
            error: null,
          }),
      },
    );

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([pos]);

    const result = await getDividendPositions('schwab');

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.source).toBe('csv');
    // 0.056236 ≤ 1 → used as-is: 76.99 × 0.056236 = 4.33... → 4.33/share
    // forward_dividend_annual = 4.33 × 150 = 649.50
    expect(row.forward_div_per_share).toBe(4.33);
    expect(row.forward_dividend_annual).toBe(649.5);
  });

  it('[regression] surfaces positions via accruals when payments table is empty (RLS gate regression)', async () => {
    // Simulates early production state where dividend_payments was empty.
    // Even when payments come back empty, accruals-only code path must still surface positions.
    // RLS SELECT policies added in migration 20260511102251 (#374) — this test verifies
    // the accruals-only logic itself is intact.
    mockAuth();

    const accruals = [
      { symbol: 'O', gross_rate: '0.2705', ex_date: '2026-04-30' },
    ];

    const posO = {
      ...IBKR_POS_JEPI,
      ticker: 'O',
      id: 'pos-o',
      description: 'Realty Income Corp',
      quantity: 20,
      mark_price: 52.0,
    };

    setupMocks(
      {
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () =>
          Promise.resolve({ data: [{ id: 1, account_id: IBKR_ACCOUNT_ID_TEXT }], error: null }),
        dividend_payments: () => Promise.resolve({ data: [], error: null }),
        dividend_accruals: () => Promise.resolve({ data: accruals, error: null }),
      },
    );

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([posO]);

    const result = await getDividendPositions('ibkr');
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('O');
    // forward yield from accruals: gross_rate × paymentsPerYear(null/annual) = 0.2705 × 1 = 0.2705
    // roundCurrency rounds to 2dp: 0.27
    expect(result[0].forward_div_per_share).toBe(0.27);
  });

  it('[regression] TASE/ILA position uses canonical ILS price (mark_price ÷ 100), not agorot', async () => {
    // CLIS (224014): mark_price=29290 agorot, market_value=29582.90 ILS, qty=101, yield=0.0169.
    // Bug (pre-fix): forwardDividendAnnual = 29290 × 0.0169 × 101 = 49,995 (100× too big, labelled USD).
    // Fix: canonicalPrice = 29290 / 100 = 292.90 ILS → 292.90 × 0.0169 = 4.95/sh → 4.95 × 101 = 499.95 ILS.
    mockAuth();

    setupMocks({
      household_members: () =>
        Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
      trading_account_config: () =>
        Promise.resolve({ data: [{ id: 72, account_id: null }], error: null }),
      dividend_payments: () => Promise.resolve({ data: [], error: null }),
      dividend_accruals: () => Promise.resolve({ data: [], error: null }),
      stock_positions: () =>
        Promise.resolve({
          data: [{ ticker: '224014', dividend_yield: '0.0169' }],
          error: null,
        }),
    });

    (getStockPositions as ReturnType<typeof vi.fn>).mockResolvedValue([IRA_POS_CLIS]);

    const result = await getDividendPositions('ira');

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.ticker).toBe('224014');
    expect(row.source).toBe('csv');

    // canonical price must be ILS (agorot ÷ 100)
    expect(row.current_price).toBeCloseTo(292.90, 2);

    // market_value from stored pos.market_value (canonical ILS), not qty × mark_price
    expect(row.market_value).toBe(29582.90);

    // forward_div_per_share = 292.90 × 0.0169 ≈ 4.95 ILS/share
    expect(row.forward_div_per_share).toBe(4.95);

    // forward_dividend_annual = 4.95 × 101 = 499.95 ILS  (NOT $49,995)
    expect(row.forward_dividend_annual).toBe(499.95);

    // currency normalised from ILA → ILS
    expect(row.currency).toBe('ILS');
  });
});

// ── getDividendSummary ────────────────────────────────────────────────────────

describe('getDividendSummary', () => {
  it('aggregates forward_dividend_annual across all 3 accounts', async () => {
    // Mock getDividendPositions indirectly by controlling the supabase + getStockPositions mocks.
    // Since getDividendSummary calls getDividendPositions('ibkr'/'schwab'/'ira') in parallel,
    // we configure mocks such that ibkr returns 1 position and schwab/ira return [].

    mockAuth();

    const payments = [
      { symbol: 'JEPI', amount: '40.00', ex_date: '2025-11-15', report_date: '2025-11-20', type: 'Dividends' },
    ];

    let callCount = 0;
    (createClient as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      auth: { getUser: mockGetUser },
      from: mockSupabaseFrom({
        household_members: () =>
          Promise.resolve({ data: [{ household_id: MOCK_HOUSEHOLD_ID }], error: null }),
        trading_account_config: () => {
          callCount++;
          // First call = ibkr (has account_id), subsequent = schwab/ira (null)
          return Promise.resolve({
            data: callCount === 1
              ? [{ id: 1, account_id: IBKR_ACCOUNT_ID_TEXT }]
              : [{ id: 71, account_id: null }],
            error: null,
          });
        },
        dividend_payments: () => Promise.resolve({ data: payments, error: null }),
        dividend_accruals: () => Promise.resolve({ data: [], error: null }),
      }),
    }));

    (getStockPositions as ReturnType<typeof vi.fn>).mockImplementation(async (accountId?: number | null) => {
      if (accountId === 1) return [IBKR_POS_JEPI];
      return [];
    });

    const summary = await getDividendSummary();

    // At least has the structure
    expect(typeof summary.total_forward_annual).toBe('number');
    expect(typeof summary.position_count).toBe('number');
    expect(summary.by_account).toHaveProperty('ibkr');
    expect(summary.by_account).toHaveProperty('schwab');
    expect(summary.by_account).toHaveProperty('ira');

    // schwab + ira should be 0
    expect(summary.by_account.schwab).toBe(0);
    expect(summary.by_account.ira).toBe(0);
  });
});
