/**
 * Unit tests for trading Server Actions.
 *
 * Focus: auth / household-scoping behavior and migration parity with the
 * former read/write FastAPI endpoints for configs, summary, and positions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import {
  getTradingConfigs,
  getTradingConfig,
  getTradingSummary,
  getTradingPositions,
  saveTradingConfig,
  getStockPositions,
} from './actions';
import { createClient } from '@/lib/supabase/server';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';
const HOUSEHOLD_ROW = { household_id: MOCK_HOUSEHOLD_ID };

beforeEach(() => {
  vi.resetAllMocks();
});

function authOk() {
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
}

function authFail() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
}

function householdClient() {
  return {
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table !== 'household_members') throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
      };
    }),
  };
}

describe('getTradingConfigs', () => {
  it('returns empty array when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    await expect(getTradingConfigs()).resolves.toEqual([]);
  });

  it('lists configs using Supabase RLS scoping', async () => {
    authOk();
    const rows = [
      {
        id: 1,
        name: 'IBKR Main',
        account_type: 'IBKR',
        host: '127.0.0.1',
        port: 4001,
        client_id: 1,
        linked_account_id: null,
        account_id: 'U2515365',
        last_synced: null,
        compute_options_income: true,
      },
    ];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const is = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ is });
    const from = vi.fn().mockReturnValue({ select });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from,
    });

    const result = await getTradingConfigs();

    expect(from).toHaveBeenCalledWith('trading_account_config');
    const selectColumns = select.mock.calls[0]?.[0] as string;
    expect(selectColumns).toContain('name');
    expect(selectColumns).toContain('account_type');
    expect(selectColumns).toContain('last_synced');
    expect(selectColumns).not.toContain('last_synced_at');
    expect(is).toHaveBeenCalledWith('deleted_at', null);
    expect(result).toEqual(rows);
  });

  it('returns all 3 seeded accounts when household_id is populated', async () => {
    authOk();
    const rows = [
      { id: 1,  name: 'InteractiveBrokers', account_type: 'ibkr',   host: '', port: 0, client_id: 0, linked_account_id: null, account_id: 'U2515365', last_synced: null, compute_options_income: true },
      { id: 71, name: 'Schwab',             account_type: 'schwab', host: '', port: 0, client_id: 0, linked_account_id: null, account_id: null,       last_synced: null, compute_options_income: false },
      { id: 72, name: 'LeumiIRA',           account_type: 'ira',    host: '', port: 0, client_id: 0, linked_account_id: null, account_id: null,       last_synced: null, compute_options_income: false },
    ];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const is = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ is });
    const from = vi.fn().mockReturnValue({ select });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from,
    });

    const result = await getTradingConfigs();

    expect(result.length).toBeGreaterThanOrEqual(3);
    const types = result.map((r) => r.account_type);
    expect(types).toContain('ibkr');
    expect(types).toContain('schwab');
    expect(types).toContain('ira');
  });
});

describe('getTradingConfig', () => {
  it('fetches a single config by id when provided', async () => {
    authOk();
    const row = { id: 7, name: 'Schwab', account_type: 'SCHWAB' };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const limit = vi.fn().mockReturnValue({ eq, maybeSingle });
    const is = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ is });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn().mockReturnValue({ select }),
    });

    const result = await getTradingConfig(7);

    const selectColumns = select.mock.calls[0]?.[0] as string;
    expect(selectColumns).not.toContain('last_synced_at');
    expect(eq).toHaveBeenCalledWith('id', 7);
    expect(result).toEqual(row);
  });
});

describe('saveTradingConfig', () => {
  it('returns error when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    const result = await saveTradingConfig({ name: 'Broker', account_type: 'IBKR' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not authenticated/i);
  });

  it('creates configs with session-derived household_id and without secret fields', async () => {
    authOk();
    const inserted = { id: 10, name: 'New Broker', account_type: 'IBKR' };
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const selectAfterInsert = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select: selectAfterInsert });
    const actionClient = {
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table !== 'trading_account_config') throw new Error(`Unexpected table: ${table}`);
        return { insert };
      }),
    };

    (createClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(actionClient)
      .mockResolvedValueOnce(householdClient());

    const result = await saveTradingConfig({
      name: ' New Broker ',
      account_type: 'IBKR',
      host: '',
      port: '4002',
      client_id: '2',
      linked_account_id: '',
      app_key: 'do-not-persist',
      app_secret: 'do-not-persist',
      account_hash: 'do-not-persist',
    });

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledOnce();
    const [row] = insert.mock.calls[0] as [Record<string, unknown>];
    expect(row).toMatchObject({
      name: 'New Broker',
      account_type: 'ibkr',
      host: '127.0.0.1',
      port: 4002,
      client_id: 2,
      linked_account_id: null,
      compute_options_income: true,
      household_id: MOCK_HOUSEHOLD_ID,
    });
    expect(row).not.toHaveProperty('app_key');
    expect(row).not.toHaveProperty('app_secret');
    expect(row).not.toHaveProperty('account_hash');
  });

  it('updates only the matching account in the active household', async () => {
    authOk();
    const updated = { id: 5, name: 'Updated', account_type: 'IBKR' };
    const maybeSingle = vi.fn().mockResolvedValue({ data: updated, error: null });
    const selectAfterUpdate = vi.fn().mockReturnValue({ maybeSingle });
    const eqHousehold = vi.fn().mockReturnValue({ select: selectAfterUpdate });
    const eqId = vi.fn().mockReturnValue({ eq: eqHousehold });
    const update = vi.fn().mockReturnValue({ eq: eqId });
    const actionClient = {
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table !== 'trading_account_config') throw new Error(`Unexpected table: ${table}`);
        return { update };
      }),
    };

    (createClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(actionClient)
      .mockResolvedValueOnce(householdClient());

    const result = await saveTradingConfig({ id: 5, name: 'Updated', account_type: 'IBKR', compute_options_income: false });

    expect(result.ok).toBe(true);
    const [row] = update.mock.calls[0] as [Record<string, unknown>];
    expect(row.compute_options_income).toBe(false);
    expect(eqId).toHaveBeenCalledWith('id', 5);
    expect(eqHousehold).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
  });

  it('normalizes uppercase account_type to lowercase before insert', async () => {
    authOk();
    const inserted = { id: 11, name: 'Schwab', account_type: 'schwab' };
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const selectAfterInsert = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select: selectAfterInsert });
    const actionClient = {
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table !== 'trading_account_config') throw new Error(`Unexpected table: ${table}`);
        return { insert };
      }),
    };

    (createClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(actionClient)
      .mockResolvedValueOnce(householdClient());

    // Caller sends uppercase — chk_account_type only allows lowercase
    const result = await saveTradingConfig({ name: 'Schwab', account_type: 'SCHWAB' });

    expect(result.ok).toBe(true);
    const [row] = insert.mock.calls[0] as [Record<string, unknown>];
    expect(row.account_type).toBe('schwab');
  });
});

describe('getTradingSummary', () => {
  it('returns latest account summary filtered by account id', async () => {
    authOk();
    const row = {
      id: 1,
      account_config_id: 2,
      net_liquidation: '1000.000000',
      total_cash: '100.000000',
      currency: 'USD',
      timestamp: '2026-01-01T00:00:00Z',
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const limit = vi.fn().mockReturnValue({ eq, maybeSingle });
    const order = vi.fn().mockReturnValue({ limit });
    const is = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ is });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn().mockReturnValue({ select }),
    });

    const result = await getTradingSummary(2);

    expect(eq).toHaveBeenCalledWith('account_config_id', 2);
    expect(result).toEqual({
      ...row,
      net_liquidation: 1000,
      total_cash: 100,
    });
  });
});

describe('getTradingPositions', () => {
  it('returns positions filtered by account id', async () => {
    authOk();
    const rows = [{
      id: 1,
      account_config_id: 2,
      symbol: 'MSFT',
      amount: '12.5',
      sec_type: 'STK',
      avg_cost: '321.09',
      con_id: 123,
      timestamp: '2026-01-01T00:00:00Z',
    }];
    const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
    const order = vi.fn().mockReturnValue({ eq });
    const is = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ is });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn().mockReturnValue({ select }),
    });

    const result = await getTradingPositions(2);

    expect(eq).toHaveBeenCalledWith('account_config_id', 2);
    expect(result).toEqual([{
      id: 1,
      account_config_id: 2,
      symbol: 'MSFT',
      amount: 12.5,
      sec_type: 'STK',
      avg_cost: 321.09,
      con_id: 123,
      timestamp: '2026-01-01T00:00:00Z',
    }]);
  });
});

// ── getStockPositions — dedup regression tests ────────────────────────────────

/** Helper: build a minimal stock_positions DB row for mocking. */
function makeStockRow(overrides: {
  id?: string;
  account_id?: number;
  ticker: string;
  quantity?: number;
  as_of_date: string;
  source?: 'flex' | 'manual';
}) {
  return {
    id: overrides.id ?? `row-${overrides.ticker}-${overrides.as_of_date}`,
    account_id: overrides.account_id ?? 1,
    ticker: overrides.ticker,
    description: null,
    sub_category: null,
    quantity: overrides.quantity ?? 10,
    cost_basis: null,
    mark_price: null,
    market_value: null,
    unrealized_pnl: null,
    currency: 'USD',
    as_of_date: overrides.as_of_date,
    source: overrides.source ?? 'flex',
  };
}

function mockStockPositionsClient(rows: ReturnType<typeof makeStockRow>[]) {
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });

  const resolved = { data: rows, error: null };
  // The query must be awaitable directly (no accountId) OR have .eq() called on it (with accountId).
  const eq = vi.fn().mockReturnValue(Promise.resolve(resolved));
  const orderResult = Object.assign(Promise.resolve(resolved), { eq });
  const order = vi.fn().mockReturnValue(orderResult);
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: mockGetUser },
    from,
  });
}

describe('getStockPositions — dedup behavior', () => {
  it('returns only the most recent snapshot when the same ticker has multiple historical rows (ABR × 4)', async () => {
    // ABR has 4 Flex year-end snapshots; only the 2025 row must survive.
    const abrRows = [
      makeStockRow({ ticker: 'ABR', quantity: 100, as_of_date: '2022-12-31' }),
      makeStockRow({ ticker: 'ABR', quantity: 110, as_of_date: '2023-12-31' }),
      makeStockRow({ ticker: 'ABR', quantity: 120, as_of_date: '2024-12-31' }),
      makeStockRow({ ticker: 'ABR', quantity: 130, as_of_date: '2025-12-31' }),
    ];
    mockStockPositionsClient(abrRows);

    const result = await getStockPositions(1);

    const abrResults = result.filter(r => r.ticker === 'ABR');
    expect(abrResults).toHaveLength(1);
    expect(abrResults[0].as_of_date).toBe('2025-12-31');
    expect(abrResults[0].quantity).toBe(130);
  });

  it('returns total row count equal to unique (account_id, ticker) pairs', async () => {
    const rows = [
      // ABR: 4 snapshots for account 1
      makeStockRow({ ticker: 'ABR', account_id: 1, as_of_date: '2022-12-31' }),
      makeStockRow({ ticker: 'ABR', account_id: 1, as_of_date: '2023-12-31' }),
      makeStockRow({ ticker: 'ABR', account_id: 1, as_of_date: '2024-12-31' }),
      makeStockRow({ ticker: 'ABR', account_id: 1, as_of_date: '2025-12-31' }),
      // MSFT: 2 snapshots for account 1
      makeStockRow({ ticker: 'MSFT', account_id: 1, as_of_date: '2024-12-31' }),
      makeStockRow({ ticker: 'MSFT', account_id: 1, as_of_date: '2025-12-31' }),
      // DBK: 1 snapshot for account 1 (should pass through unchanged)
      makeStockRow({ ticker: 'DBK', account_id: 1, as_of_date: '2025-12-31' }),
      // ABR: 2 snapshots for a different account 2 (separate dedup key)
      makeStockRow({ ticker: 'ABR', account_id: 2, as_of_date: '2024-12-31' }),
      makeStockRow({ ticker: 'ABR', account_id: 2, as_of_date: '2025-12-31' }),
    ];
    mockStockPositionsClient(rows);

    const result = await getStockPositions();

    // Unique (account_id, ticker) pairs: ABR/1, MSFT/1, DBK/1, ABR/2 → 4
    expect(result).toHaveLength(4);
  });

  it('preserves single-snapshot tickers unchanged (DBK)', async () => {
    const rows = [
      makeStockRow({ ticker: 'DBK', account_id: 1, quantity: 50, as_of_date: '2025-12-31' }),
    ];
    mockStockPositionsClient(rows);

    const result = await getStockPositions(1);

    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('DBK');
    expect(result[0].quantity).toBe(50);
  });

  it('applies dedup to manual (Schwab/LeumiIRA) rows as well as flex', async () => {
    const rows = [
      makeStockRow({ ticker: 'VTI', account_id: 3, quantity: 200, as_of_date: '2024-06-30', source: 'manual' }),
      makeStockRow({ ticker: 'VTI', account_id: 3, quantity: 220, as_of_date: '2025-01-31', source: 'manual' }),
    ];
    mockStockPositionsClient(rows);

    const result = await getStockPositions(3);

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(220);
    expect(result[0].as_of_date).toBe('2025-01-31');
  });

  it('returns results sorted alphabetically by ticker after dedup', async () => {
    const rows = [
      makeStockRow({ ticker: 'ZZZ', account_id: 1, as_of_date: '2025-12-31' }),
      makeStockRow({ ticker: 'AAA', account_id: 1, as_of_date: '2024-12-31' }),
      makeStockRow({ ticker: 'AAA', account_id: 1, as_of_date: '2025-12-31' }),
      makeStockRow({ ticker: 'MMM', account_id: 1, as_of_date: '2025-12-31' }),
    ];
    mockStockPositionsClient(rows);

    const result = await getStockPositions(1);

    expect(result.map(r => r.ticker)).toEqual(['AAA', 'MMM', 'ZZZ']);
  });

  it('returns [] when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    await expect(getStockPositions()).resolves.toEqual([]);
  });
});
