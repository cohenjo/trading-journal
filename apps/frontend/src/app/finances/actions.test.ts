/**
 * Unit tests for the finances/latest Server Action (getLatestFinanceSnapshot).
 *
 * Verifies:
 *  1. Returns the latest snapshot ordered by date desc.
 *  2. Returns null when no rows exist (not an error).
 *  3. Enriches items that have a linked dividend account with
 *     dividend_fixed_amount and dividend_mode = 'Fixed'.
 *  4. Preserves original item order.
 *  5. Never persists enrichment changes to the DB.
 *  6. Returns null when not authenticated.
 *  7. Returns null when user has no active household.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock infrastructure ──────────────────────────────────────────────

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { getLatestFinanceSnapshot } from './actions';
import { createClient } from '@/lib/supabase/server';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

// ── Helpers ───────────────────────────────────────────────────────────────────

function authOk() {
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
}

function authFail() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
}

/** Builds a minimal fluent Supabase mock for a given table config. */
function makeSupabaseMock(tableHandlers: Record<string, () => object>) {
  return {
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table];
      if (handler) return handler();
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

/** Builds a fluent chain that terminates with maybeSingle() returning `result`. */
function fluentChain(result: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Auth / access control ─────────────────────────────────────────────────────

describe('getLatestFinanceSnapshot — auth guards', () => {
  it('returns null when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    const result = await getLatestFinanceSnapshot();
    expect(result).toBeNull();
  });

  it('returns null when user has no active household', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock({
        household_members: () => fluentChain({ data: null, error: null }),
      }),
    );

    const result = await getLatestFinanceSnapshot();
    expect(result).toBeNull();
  });
});

// ── Snapshot retrieval ────────────────────────────────────────────────────────

describe('getLatestFinanceSnapshot — snapshot retrieval', () => {
  it('returns null when no snapshot exists', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock({
        household_members: () => fluentChain({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null }),
        finance_snapshots: () => fluentChain({ data: null, error: null }),
        // dividend_accounts will not be called since there's no snapshot
        dividend_accounts: () => ({
          select: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    );

    const result = await getLatestFinanceSnapshot();
    expect(result).toBeNull();
  });

  it('returns the latest snapshot (ordered by date desc)', async () => {
    authOk();
    const snapshotRow = {
      date: '2025-06-15',
      household_id: MOCK_HOUSEHOLD_ID,
      net_worth: 500000,
      total_assets: 600000,
      total_liabilities: 100000,
      data: {
        items: [
          { id: '42', name: 'Savings Account', category: 'Savings', value: 50000, type: 'Bank', owner: 'Jony', currency: 'ILS' },
        ],
        net_worth: 500000,
        total_assets: 600000,
        total_liabilities: 100000,
        total_savings: 50000,
        total_investments: 0,
      },
    };

    const snapshotsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: snapshotRow, error: null }),
    };

    const divAccountsChain = {
      select: vi.fn().mockReturnThis(),
      not: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return fluentChain({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null });
        if (table === 'finance_snapshots') return snapshotsChain;
        if (table === 'dividend_accounts') return divAccountsChain;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLatestFinanceSnapshot();
    expect(result).not.toBeNull();
    expect(result?.date).toBe('2025-06-15');
    expect(result?.net_worth).toBe(500000);
    // Verify order: descending date was requested
    expect(snapshotsChain.order).toHaveBeenCalledWith('date', { ascending: false });
    expect(snapshotsChain.limit).toHaveBeenCalledWith(1);
  });
});

// ── Dividend enrichment ───────────────────────────────────────────────────────

describe('getLatestFinanceSnapshot — dividend enrichment', () => {
  it('enriches items with a linked dividend account', async () => {
    authOk();

    const items = [
      { id: '10', name: 'Brokerage', category: 'Investments', value: 100000, type: 'Stocks', owner: 'Jony', currency: 'USD' },
    ];
    const snapshotRow = {
      date: '2025-06-15',
      household_id: MOCK_HOUSEHOLD_ID,
      net_worth: 100000,
      total_assets: 100000,
      total_liabilities: 0,
      data: { items, net_worth: 100000, total_assets: 100000, total_liabilities: 0, total_savings: 0, total_investments: 100000 },
    };

    // dividend_accounts: item id=10 is linked to account "My Broker"
    const divAccounts = [{ name: 'My Broker', linked_id: 10 }];
    // dividend_positions: 200 shares of AAPL in "My Broker"
    const divPositions = [{ account: 'My Broker', ticker: 'AAPL', shares: 200 }];
    // ticker data: AAPL pays $1.00/share USD
    const tickerData = [{ ticker: 'AAPL', dividend_rate: 1.0, currency: 'USD' }];

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return fluentChain({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null });
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: snapshotRow, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return { select: vi.fn().mockReturnThis(), not: vi.fn().mockResolvedValue({ data: divAccounts, error: null }) };
        }
        if (table === 'dividend_positions') {
          return { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: divPositions, error: null }) };
        }
        if (table === 'dividend_ticker_data') {
          return { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: tickerData, error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLatestFinanceSnapshot();
    expect(result).not.toBeNull();

    const enrichedItem = result!.data.items[0];
    // 200 shares × $1.00 = $200 USD (no conversion needed — item currency is also USD)
    expect(enrichedItem.details?.dividend_fixed_amount).toBe(200);
    expect(enrichedItem.details?.dividend_mode).toBe('Fixed');
  });

  it('does not enrich items with no linked dividend account', async () => {
    authOk();

    const items = [
      { id: '99', name: 'Unlinked Account', category: 'Savings', value: 50000, type: 'Bank', owner: 'Jony', currency: 'ILS' },
    ];
    const snapshotRow = {
      date: '2025-06-15',
      household_id: MOCK_HOUSEHOLD_ID,
      net_worth: 50000,
      total_assets: 50000,
      total_liabilities: 0,
      data: { items, net_worth: 50000, total_assets: 50000, total_liabilities: 0, total_savings: 50000, total_investments: 0 },
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return fluentChain({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null });
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: snapshotRow, error: null }),
          };
        }
        // No dividend accounts linked
        if (table === 'dividend_accounts') {
          return { select: vi.fn().mockReturnThis(), not: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLatestFinanceSnapshot();
    expect(result).not.toBeNull();
    const item = result!.data.items[0];
    expect(item.details?.dividend_fixed_amount).toBeUndefined();
    expect(item.details?.dividend_mode).toBeUndefined();
  });

  it('preserves original item order after enrichment', async () => {
    authOk();

    const items = [
      { id: '1', name: 'First', category: 'Savings' as const, value: 1000, type: 'Bank', owner: 'Jony', currency: 'ILS' },
      { id: '2', name: 'Second', category: 'Investments' as const, value: 2000, type: 'Stocks', owner: 'Jony', currency: 'USD' },
      { id: '3', name: 'Third', category: 'Assets' as const, value: 3000, type: 'Property', owner: 'Jony', currency: 'ILS' },
    ];
    const snapshotRow = {
      date: '2025-06-15',
      household_id: MOCK_HOUSEHOLD_ID,
      net_worth: 6000,
      total_assets: 6000,
      total_liabilities: 0,
      data: { items, net_worth: 6000, total_assets: 6000, total_liabilities: 0, total_savings: 1000, total_investments: 2000 },
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return fluentChain({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null });
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: snapshotRow, error: null }),
          };
        }
        if (table === 'dividend_accounts') {
          return { select: vi.fn().mockReturnThis(), not: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLatestFinanceSnapshot();
    expect(result).not.toBeNull();
    expect(result!.data.items.map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  it('never persists enrichment — does not call upsert or insert', async () => {
    authOk();

    const mockUpsert = vi.fn();
    const mockInsert = vi.fn();
    const items = [
      { id: '10', name: 'Brokerage', category: 'Investments' as const, value: 100000, type: 'Stocks', owner: 'Jony', currency: 'USD' },
    ];
    const snapshotRow = {
      date: '2025-06-15',
      household_id: MOCK_HOUSEHOLD_ID,
      net_worth: 100000,
      total_assets: 100000,
      total_liabilities: 0,
      data: { items, net_worth: 100000, total_assets: 100000, total_liabilities: 0, total_savings: 0, total_investments: 100000 },
    };
    const divAccounts = [{ name: 'My Broker', linked_id: 10 }];
    const divPositions = [{ account: 'My Broker', ticker: 'AAPL', shares: 200 }];
    const tickerData = [{ ticker: 'AAPL', dividend_rate: 1.0, currency: 'USD' }];

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return fluentChain({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null });
        if (table === 'finance_snapshots') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: snapshotRow, error: null }),
            upsert: mockUpsert,
            insert: mockInsert,
          };
        }
        if (table === 'dividend_accounts') {
          return { select: vi.fn().mockReturnThis(), not: vi.fn().mockResolvedValue({ data: divAccounts, error: null }) };
        }
        if (table === 'dividend_positions') {
          return { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: divPositions, error: null }) };
        }
        if (table === 'dividend_ticker_data') {
          return { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: tickerData, error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    await getLatestFinanceSnapshot();

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
