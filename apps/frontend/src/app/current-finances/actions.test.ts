/**
 * Unit tests for the finances Server Action.
 *
 * Focus: auth / household-scoping logic — the security-critical path.
 * We verify that:
 *   1. household_id is NEVER accepted from the caller; it is always resolved
 *      from the authenticated session via `household_members`.
 *   2. Unauthenticated callers receive an error, not a DB write.
 *   3. Users with no active household receive an error, not a DB write.
 *   4. A happy-path call passes the correct household_id to the upsert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase server client mock ───────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockMaybeSingleHousehold = vi.fn();
const mockUpsert = vi.fn();
const mockMaybeSingleSnapshot = vi.fn();

/**
 * Minimal mock of the fluent Supabase query builder.
 * Each `.from(table)` call selects a pre-configured chain.
 */
const makeSupabaseMock = () => ({
  auth: {
    getUser: mockGetUser,
  },
  from: vi.fn((table: string) => {
    if (table === 'household_members') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: mockMaybeSingleHousehold,
      };
    }
    if (table === 'finance_snapshots') {
      return {
        upsert: mockUpsert,
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: mockMaybeSingleSnapshot,
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  }),
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Import after mock setup
import { saveFinanceSnapshot, getLatestFinanceSnapshot } from './actions';
import { createClient } from '@/lib/supabase/server';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

const VALID_ITEMS = [
  {
    id: 'item-1',
    category: 'Assets' as const,
    name: 'Apartment',
    value: 1_000_000,
    type: 'Real Estate',
    owner: 'Jony',
    currency: 'ILS',
  },
];

const VALID_METRICS = {
  net_worth: 1_000_000,
  total_assets: 1_000_000,
  total_liabilities: 0,
  total_savings: 0,
  total_investments: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeSupabaseMock());
});

// ── saveFinanceSnapshot ───────────────────────────────────────────────────────

describe('saveFinanceSnapshot', () => {
  it('returns an error when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });

    const result = await saveFinanceSnapshot(VALID_ITEMS, VALID_METRICS);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not authenticated/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns an error when the user has no active household', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
    mockMaybeSingleHousehold.mockResolvedValue({ data: null, error: null });

    const result = await saveFinanceSnapshot(VALID_ITEMS, VALID_METRICS);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/no active household/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('passes the session-resolved household_id to the upsert — never caller-supplied', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
    mockMaybeSingleHousehold.mockResolvedValue({
      data: { household_id: MOCK_HOUSEHOLD_ID },
      error: null,
    });
    mockUpsert.mockResolvedValue({ error: null });

    const result = await saveFinanceSnapshot(VALID_ITEMS, VALID_METRICS);

    expect(result.success).toBe(true);
    expect(mockUpsert).toHaveBeenCalledOnce();
    const [row] = mockUpsert.mock.calls[0] as [Record<string, unknown>];
    expect(row.household_id).toBe(MOCK_HOUSEHOLD_ID);
    // Confirm the payload carries the items inside `data`, not as a top-level key
    expect((row.data as { items: unknown }).items).toEqual(VALID_ITEMS);
  });

  it('returns an error when the DB upsert fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
    mockMaybeSingleHousehold.mockResolvedValue({
      data: { household_id: MOCK_HOUSEHOLD_ID },
      error: null,
    });
    mockUpsert.mockResolvedValue({ error: { message: 'RLS violation' } });

    const result = await saveFinanceSnapshot(VALID_ITEMS, VALID_METRICS);

    expect(result.success).toBe(false);
  });

  it('validates that items must be an array', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
    mockMaybeSingleHousehold.mockResolvedValue({
      data: { household_id: MOCK_HOUSEHOLD_ID },
      error: null,
    });

    // @ts-expect-error intentionally passing wrong type for runtime validation test
    const result = await saveFinanceSnapshot('not-an-array', VALID_METRICS);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/items must be an array/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

// ── getLatestFinanceSnapshot ──────────────────────────────────────────────────

describe('getLatestFinanceSnapshot', () => {
  it('returns an error when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await getLatestFinanceSnapshot();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not authenticated/i);
  });

  it('returns null data when no snapshot exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
    mockMaybeSingleSnapshot.mockResolvedValue({ data: null, error: null });

    const result = await getLatestFinanceSnapshot();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it('returns the snapshot data on success', async () => {
    const snapshotData = { items: VALID_ITEMS, ...VALID_METRICS };
    mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
    mockMaybeSingleSnapshot.mockResolvedValue({ data: { data: snapshotData }, error: null });

    const result = await getLatestFinanceSnapshot();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(snapshotData);
  });
});
