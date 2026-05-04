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
        account_id: null,
        last_synced: null,
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
    expect(is).toHaveBeenCalledWith('deleted_at', null);
    expect(result).toEqual(rows);
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
      account_type: 'IBKR',
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
