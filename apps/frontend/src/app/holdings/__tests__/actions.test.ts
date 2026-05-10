import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUser, mockRevalidatePath } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

import {
  createBondHolding,
  deleteBondHolding,
  listBondHoldings,
  updateBondHolding,
  type BondHoldingPayload,
} from '../actions';
import { createClient } from '@/lib/supabase/server';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';
const HOUSEHOLD_ROW = { household_id: MOCK_HOUSEHOLD_ID };

const basePayload: BondHoldingPayload = {
  id: '9128285M8',
  ticker: 'T 4.5 2034',
  issuer: 'US Treasury',
  currency: 'usd',
  face_value: 10000,
  coupon_rate: 0.045,
  coupon_frequency: 'SEMI_ANNUAL',
  issue_date: '2024-01-15',
  maturity_date: '2034-01-15',
};

const dbRow = {
  ...basePayload,
  currency: 'USD',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.resetAllMocks();
});

function authOk() {
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
}

function authFail() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
}

function householdQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: HOUSEHOLD_ROW, error: null }),
  };
}

describe('listBondHoldings', () => {
  it('returns empty array when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    await expect(listBondHoldings()).resolves.toEqual([]);
  });

  it('lists active holdings scoped to the caller household', async () => {
    authOk();
    const resolvedData = { data: [{ ...dbRow, face_value: '10000.000000' }], error: null };
    const holdingsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    // The second .order() call resolves the query
    (holdingsQuery.order as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ order: vi.fn().mockResolvedValue(resolvedData) });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'bond_holdings') return holdingsQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await listBondHoldings();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: '9128285M8', issuer: 'US Treasury', face_value: 10000 });
    expect(holdingsQuery.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
    expect(holdingsQuery.is).toHaveBeenCalledWith('deleted_at', null);
  });
});

describe('createBondHolding', () => {
  it('rejects invalid date ranges before writing', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createBondHolding({ ...basePayload, maturity_date: '2020-01-15' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/maturity date must be after issue date/i);
  });

  it('creates holdings with household_id resolved from the session', async () => {
    authOk();
    const single = vi.fn().mockResolvedValue({ data: dbRow, error: null });
    const selectAfterInsert = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select: selectAfterInsert });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'bond_holdings') return { insert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createBondHolding(basePayload);

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledOnce();
    const [row] = insert.mock.calls[0] as [Record<string, unknown>];
    expect(row.household_id).toBe(MOCK_HOUSEHOLD_ID);
    expect(row.currency).toBe('USD');
    expect(row.issuer).toBe('US Treasury');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/holdings');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/ladder');
  });
});

describe('updateBondHolding', () => {
  it('updates only active holdings in the caller household', async () => {
    authOk();
    const mutation = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { ...dbRow, face_value: 12000 }, error: null }),
    };
    const update = vi.fn().mockReturnValue(mutation);

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'bond_holdings') return { update };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await updateBondHolding('9128285M8', { face_value: 12000 });

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ face_value: 12000 }));
    expect(mutation.eq).toHaveBeenCalledWith('id', '9128285M8');
    expect(mutation.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
    expect(mutation.is).toHaveBeenCalledWith('deleted_at', null);
  });
});

describe('deleteBondHolding', () => {
  it('soft-deletes only active holdings in the caller household', async () => {
    authOk();
    const mutation = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: '9128285M8' }, error: null }),
    };
    const update = vi.fn().mockReturnValue(mutation);

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'bond_holdings') return { update };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await deleteBondHolding('9128285M8');

    expect(result).toEqual({ ok: true, data: { id: '9128285M8' } });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted_at: expect.any(String) as string,
        updated_at: expect.any(String) as string,
      }),
    );
    expect(mutation.eq).toHaveBeenCalledWith('id', '9128285M8');
    expect(mutation.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
    expect(mutation.is).toHaveBeenCalledWith('deleted_at', null);
  });
});
