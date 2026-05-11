/**
 * Unit tests for the dividend accounts Server Actions.
 *
 * Focus: auth / household-scoping logic and business rules:
 *   1. household_id is NEVER accepted from caller; resolved from session.
 *   2. Unauthenticated callers receive empty data or errors.
 *   3. Business rules: duplicate names/linked IDs are rejected.
 *   4. RSU grants auto-create a position row when vested shares > 0.
 *   5. deleteDividendAccount zeroes out dividend_yield on linked snapshot items.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock infrastructure ──────────────────────────────────────────────

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock getStockPositions so getDividendSummary (called by getDividendDashboard)
// returns an empty summary without touching un-mocked Supabase tables.
vi.mock('@/app/trading/actions', () => ({
  getStockPositions: vi.fn().mockResolvedValue([]),
}));

import {
  getDividendDashboard,
  getDividendAccounts,
  getImportableAccounts,
  createDividendAccount,
  importDividendAccount,
  deleteDividendAccount,
  createDividendPosition,
  updateDividendPosition,
  deleteDividendPosition,
} from './actions';
import { createClient } from '@/lib/supabase/server';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

const HOUSEHOLD_ROW = { household_id: MOCK_HOUSEHOLD_ID };

// ── Simplified mock approach ──────────────────────────────────────────────────
// Rather than trying to replicate the full fluent chain, we build targeted
// mocks per test using a per-from-call approach.

beforeEach(() => {
  vi.resetAllMocks();
});

function authOk() {
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
}

function authFail() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
}

function mockHouseholdMembersTable() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
  };
}

// ── getDividendDashboard ──────────────────────────────────────────────────────

describe('getDividendDashboard', () => {
  it('returns empty dashboard when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    const result = await getDividendDashboard('ILS');
    expect(result).toEqual({
      stats: { portfolio_yield: 0, annual_income: 0, dgr_5y: 0, currency: 'ILS' },
      positions: [],
    });
  });

  it('enriches positions with ticker data and aggregates stats in target currency', async () => {
    authOk();
    const positionRows = [
      { id: 1, account: 'Brokerage', ticker: 'AAPL', shares: '10' },
      { id: 2, account: 'Brokerage', ticker: 'MSFT', shares: 5 },
    ];
    const tickerRows = [
      { ticker: 'AAPL', price: '100', currency: 'USD', dividend_yield: '0.02', dividend_rate: '2', dgr_3y: '0.05', dgr_5y: '0.07' },
      { ticker: 'MSFT', price: '200', currency: 'USD', dividend_yield: '0.03', dividend_rate: '4', dgr_3y: '0.04', dgr_5y: '0.09' },
    ];

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return mockHouseholdMembersTable();
        if (table === 'dividend_positions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: positionRows, error: null }),
          };
        }
        if (table === 'dividend_ticker_data') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: tickerRows, error: null }),
          };
        }
        // getDividendSummary → getDividendPositions needs these tables.
        // getStockPositions is mocked to return [] so these tables won't be reached,
        // but trading_account_config is queried before getStockPositions is called.
        if (table === 'trading_account_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'dividend_payments' || table === 'dividend_accruals') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getDividendDashboard('USD');

    // positions are enriched from dividend_positions (legacy path) + ticker data
    expect(result.positions).toHaveLength(2);
    expect(result.positions[0]).toMatchObject({
      id: 1, account: 'Brokerage', ticker: 'AAPL', shares: 10, price: 100,
      annual_income: 20, dividend_yield: 0.02, currency: 'USD',
    });
    // annual_income now comes from getDividendSummary (positions-based).
    // getStockPositions is mocked to return [] → summary returns 0.
    expect(result.stats.annual_income).toBe(0);
    expect(result.stats.dgr_5y).toBeCloseTo(0.08);
  });
});

// ── getDividendAccounts ───────────────────────────────────────────────────────

describe('getDividendAccounts', () => {
  it('returns empty array when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    const result = await getDividendAccounts();
    expect(result).toEqual([]);
  });

  it('returns names from dividend_accounts when records exist', async () => {
    authOk();
    const names = ['Brokerage', 'ESOP', 'Savings'];
    const rows = names.map((n) => ({ name: n }));

    const dividendAccountsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return mockHouseholdMembersTable();
        if (table === 'dividend_accounts') return dividendAccountsQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getDividendAccounts();
    expect(result).toEqual(names);
  });

  it('falls back to trading_account_config when dividend_accounts is empty', async () => {
    authOk();
    const tradingRows = [{ name: 'InteractiveBrokers' }, { name: 'Schwab' }, { name: 'LeumiIRA' }];

    const dividendAccountsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const tradingConfigQuery = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: tradingRows, error: null }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return mockHouseholdMembersTable();
        if (table === 'dividend_accounts') return dividendAccountsQuery;
        if (table === 'trading_account_config') return tradingConfigQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getDividendAccounts();
    expect(result).toEqual(['InteractiveBrokers', 'Schwab', 'LeumiIRA']);
  });

  it('returns empty array on DB error with no fallback data', async () => {
    authOk();

    const dividendAccountsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    };
    const tradingConfigQuery = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return mockHouseholdMembersTable();
        if (table === 'dividend_accounts') return dividendAccountsQuery;
        if (table === 'trading_account_config') return tradingConfigQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getDividendAccounts();
    expect(result).toEqual([]);
  });
});

// ── getImportableAccounts ─────────────────────────────────────────────────────

describe('getImportableAccounts', () => {
  it('returns empty array when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });
    const result = await getImportableAccounts();
    expect(result).toEqual([]);
  });

  it('filters to category=Investments and excludes already-linked IDs', async () => {
    authOk();
    const snapshotItems = [
      { id: '1', name: 'ESOP', category: 'Investments', type: 'RSU', details: null },
      { id: '2', name: 'Savings', category: 'Savings', type: 'Cash', details: null },
      { id: '3', name: 'Already Linked', category: 'Investments', type: 'Brokerage', details: null },
    ];
    const linkedAccounts = [{ linked_id: 3 }]; // id '3' already linked

    let callCount = 0;
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'dividend_accounts') {
          callCount++;
          if (callCount === 1) {
            // First call: get linked IDs via .not('linked_id', 'is', null)
            return {
              select: vi.fn().mockReturnThis(),
              not: vi.fn().mockResolvedValue({ data: linkedAccounts, error: null }),
            };
          }
        }
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({
                data: { data: { items: snapshotItems } },
                error: null,
              }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getImportableAccounts();

    // Only ESOP should appear: id='1', category=Investments, not linked
    // 'Savings' filtered out (wrong category); 'Already Linked' filtered out (linked_id=3)
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(result[0].name).toBe('ESOP');
  });

  it('returns empty array when no snapshot exists', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getImportableAccounts();
    expect(result).toEqual([]);
  });
});

// ── createDividendAccount ─────────────────────────────────────────────────────

describe('createDividendAccount', () => {
  it('returns error when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });
    const result = await createDividendAccount('My Account');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not authenticated/i);
  });

  it('returns error for empty name', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });
    const result = await createDividendAccount('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it('happy path: creates account and returns name', async () => {
    authOk();
    const mockInsertFn = vi.fn().mockResolvedValue({ error: null });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: mockInsertFn,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createDividendAccount('My Brokerage');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.name).toBe('My Brokerage');
    expect(mockInsertFn).toHaveBeenCalledOnce();
    const [row] = mockInsertFn.mock.calls[0] as [Record<string, unknown>];
    expect(row.household_id).toBe(MOCK_HOUSEHOLD_ID);
    expect(row.name).toBe('My Brokerage');
  });

  it('returns error for duplicate account name', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            // Simulate existing row found → duplicate
            maybeSingle: vi.fn().mockResolvedValue({
              data: { name: 'My Brokerage' },
              error: null,
            }),
            insert: vi.fn(),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createDividendAccount('My Brokerage');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already exists/i);
  });
});

// ── importDividendAccount ─────────────────────────────────────────────────────

describe('importDividendAccount', () => {
  it('happy path: imports account and returns name', async () => {
    authOk();

    const mockInsertAccount = vi.fn().mockResolvedValue({ error: null });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: mockInsertAccount,
          };
        }
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await importDividendAccount('42', 'My ESOP');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.name).toBe('My ESOP');
    expect(mockInsertAccount).toHaveBeenCalledOnce();
    const [row] = mockInsertAccount.mock.calls[0] as [Record<string, unknown>];
    expect(row.household_id).toBe(MOCK_HOUSEHOLD_ID);
    expect(row.linked_id).toBe('42');
  });

  it('returns error for duplicate account name', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
            // Name check finds existing row
            maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'My ESOP' }, error: null }),
            insert: vi.fn(),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await importDividendAccount('42', 'My ESOP');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/name already exists/i);
  });

  it('returns error when linked_id already used in household', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            // .not() returns linked rows containing our linked_id
            not: vi.fn().mockResolvedValue({ data: [{ linked_id: 42 }], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn(),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await importDividendAccount('42', 'New ESOP Name');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already linked/i);
  });

  it('auto-creates a dividend_positions row when RSU grants have vested shares > 0', async () => {
    authOk();
    const mockInsertAccount = vi.fn().mockResolvedValue({ error: null });
    const mockInsertPosition = vi.fn().mockResolvedValue({ error: null });
    const rsuItem = {
      id: '99',
      name: 'RSU Plan',
      category: 'Investments',
      type: 'RSU',
      details: {
        stock_symbol: 'MSFT',
        rsu_grants: [
          { vested: 100, unvested: 50 },
          { vested: 75, unvested: 25 },
        ],
      },
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: mockInsertAccount,
          };
        }
        if (table === 'dividend_positions') {
          return { insert: mockInsertPosition };
        }
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { data: { items: [rsuItem] } }, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await importDividendAccount('99', 'RSU Plan');
    expect(result.ok).toBe(true);

    // Verify position was created with aggregated vested shares (100 + 75 = 175)
    expect(mockInsertPosition).toHaveBeenCalledOnce();
    const [posRow] = mockInsertPosition.mock.calls[0] as [Record<string, unknown>];
    expect(posRow.ticker).toBe('MSFT');
    expect(posRow.shares).toBe(175);
    expect(posRow.account).toBe('RSU Plan');
    expect(posRow.household_id).toBe(MOCK_HOUSEHOLD_ID);
  });

  it('does NOT create position when rsu_grants total vested shares is 0', async () => {
    authOk();
    const mockInsertAccount = vi.fn().mockResolvedValue({ error: null });
    const mockInsertPosition = vi.fn().mockResolvedValue({ error: null });
    const rsuItem = {
      id: '88',
      name: 'Unvested RSU',
      details: { stock_symbol: 'GOOG', rsu_grants: [{ vested: 0 }] },
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: mockInsertAccount,
          };
        }
        if (table === 'dividend_positions') {
          return { insert: mockInsertPosition };
        }
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { data: { items: [rsuItem] } }, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await importDividendAccount('88', 'Unvested RSU');
    expect(result.ok).toBe(true);
    expect(mockInsertPosition).not.toHaveBeenCalled();
  });
});

// ── dividend position CRUD ────────────────────────────────────────────────────

describe('dividend position CRUD actions', () => {
  it('createDividendPosition writes household-scoped row and returns normalized position', async () => {
    authOk();
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 10, account: 'Brokerage', ticker: 'AAPL', shares: '12.5' },
          error: null,
        }),
      }),
    });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return mockHouseholdMembersTable();
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Brokerage' }, error: null }),
          };
        }
        if (table === 'dividend_positions') return { insert: mockInsert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createDividendPosition({ account: ' Brokerage ', ticker: 'aapl', shares: 12.5 });

    expect(result.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith({
      account: 'Brokerage', ticker: 'AAPL', shares: 12.5, household_id: MOCK_HOUSEHOLD_ID,
    });
    if (result.ok) expect(result.position.shares).toBe(12.5);
  });

  it('createDividendPosition rejects unknown household account', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return mockHouseholdMembersTable();
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createDividendPosition({ account: 'Ghost', ticker: 'MSFT', shares: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/account not found/i);
  });

  it('updateDividendPosition updates only the household-scoped row', async () => {
    authOk();
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 7, account: 'Brokerage', ticker: 'MSFT', shares: 3 }, error: null }),
          }),
        }),
      }),
    });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return mockHouseholdMembersTable();
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Brokerage' }, error: null }),
          };
        }
        if (table === 'dividend_positions') return { update: mockUpdate };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await updateDividendPosition(7, { account: 'Brokerage', ticker: 'msft', shares: 3 });

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({ account: 'Brokerage', ticker: 'MSFT', shares: 3 });
    if (result.ok) expect(result.position.ticker).toBe('MSFT');
  });

  it('deleteDividendPosition deletes only the household-scoped row', async () => {
    authOk();
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 9 }, error: null });
    const mockDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle }) }),
      }),
    });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return mockHouseholdMembersTable();
        if (table === 'dividend_positions') return { delete: mockDelete };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await deleteDividendPosition(9);
    expect(result.ok).toBe(true);
    expect(mockDelete).toHaveBeenCalledOnce();
    expect(maybeSingle).toHaveBeenCalledOnce();
  });
});

// ── deleteDividendAccount ─────────────────────────────────────────────────────

describe('deleteDividendAccount', () => {
  it('returns error when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });
    const result = await deleteDividendAccount('My Account');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not authenticated/i);
  });

  it('returns error when account not found', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await deleteDividendAccount('Ghost Account');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
  });

  it('happy path: deletes account and positions', async () => {
    authOk();
    const mockDeletePositions = vi.fn().mockResolvedValue({ error: null });
    const mockDeleteAccount = vi.fn().mockResolvedValue({ error: null });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            delete: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                eq: mockDeleteAccount,
              })),
            })),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { name: 'My Account', linked_id: null }, error: null }),
          };
        }
        if (table === 'dividend_positions') {
          return {
            delete: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                eq: mockDeletePositions,
              })),
            })),
          };
        }
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await deleteDividendAccount('My Account');
    expect(result.ok).toBe(true);
    expect(mockDeletePositions).toHaveBeenCalledOnce();
    expect(mockDeleteAccount).toHaveBeenCalledOnce();
  });

  it('when linked, mutates snapshot.data.items[*].details.dividend_yield to 0', async () => {
    authOk();
    const snapshotItems = [
      { id: 5, name: 'RSU Fund', category: 'Investments', details: { dividend_yield: 3.5 } },
      { id: 6, name: 'Other', category: 'Investments', details: {} },
    ];
    const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdateSnapEq = vi.fn().mockImplementation(() => ({ eq: mockUpdateEq }));
    const mockUpdateSnap = vi.fn().mockImplementation(() => ({ eq: mockUpdateSnapEq }));

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            delete: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                eq: vi.fn().mockResolvedValue({ error: null }),
              })),
            })),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { name: 'RSU Fund', linked_id: 5 }, error: null }),
          };
        }
        if (table === 'dividend_positions') {
          return {
            delete: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                eq: vi.fn().mockResolvedValue({ error: null }),
              })),
            })),
          };
        }
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            update: mockUpdateSnap,
            maybeSingle: vi.fn().mockResolvedValue({
              data: { data: { items: snapshotItems }, date: '2024-06-01' },
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await deleteDividendAccount('RSU Fund');
    expect(result.ok).toBe(true);

    // Snapshot update must have been called
    expect(mockUpdateSnap).toHaveBeenCalledOnce();
    const [updatePayload] = mockUpdateSnap.mock.calls[0] as [{ data: { items: typeof snapshotItems } }];
    const mutatedItem = updatePayload.data.items.find((i) => String(i.id) === '5');
    expect(mutatedItem?.details?.dividend_yield).toBe(0);
  });
});
