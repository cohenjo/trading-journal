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
  createInsurancePolicy,
  deleteInsurancePolicy,
  listInsurancePolicies,
  updateInsurancePolicy,
  type InsurancePolicyPayload,
} from './actions';
import { createClient } from '@/lib/supabase/server';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';
const HOUSEHOLD_ROW = { household_id: MOCK_HOUSEHOLD_ID };

const basePayload: InsurancePolicyPayload = {
  owner: 'You',
  type: 'life',
  provider: 'Harel',
  policy_number: 'POL-123',
  sum_insured: '₪2,000,000',
  monthly_premium: 123.45,
  beneficiaries: 'Family',
  expiry_date: '2030-01-01',
  website: 'https://example.com',
  notes: 'Keep active',
};

const dbRow = {
  id: 'policy-1',
  ...basePayload,
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

describe('listInsurancePolicies', () => {
  it('returns empty array when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    await expect(listInsurancePolicies()).resolves.toEqual([]);
  });

  it('lists active policies scoped to the caller household', async () => {
    authOk();
    const insuranceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [{ ...dbRow, monthly_premium: '123.45' }], error: null }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'insurance_policies') return insuranceQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await listInsurancePolicies();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'policy-1', provider: 'Harel', monthly_premium: 123.45 });
    expect(insuranceQuery.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
    expect(insuranceQuery.is).toHaveBeenCalledWith('deleted_at', null);
  });
});

describe('createInsurancePolicy', () => {
  it('rejects invalid policy types before writing', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createInsurancePolicy({ ...basePayload, type: 'bad' as InsurancePolicyPayload['type'] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid policy type/i);
  });

  it('creates policies with household_id resolved from the session', async () => {
    authOk();
    const single = vi.fn().mockResolvedValue({ data: dbRow, error: null });
    const selectAfterInsert = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select: selectAfterInsert });

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'insurance_policies') return { insert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await createInsurancePolicy(basePayload);

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledOnce();
    const [row] = insert.mock.calls[0] as [Record<string, unknown>];
    expect(row.household_id).toBe(MOCK_HOUSEHOLD_ID);
    expect(row.provider).toBe('Harel');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/insurance');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/after-i-leave');
  });
});

describe('updateInsurancePolicy', () => {
  it('updates only policies in the caller household', async () => {
    authOk();
    const mutation = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { ...dbRow, provider: 'Migdal' }, error: null }),
    };
    const update = vi.fn().mockReturnValue(mutation);

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'insurance_policies') return { update };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await updateInsurancePolicy('policy-1', { provider: 'Migdal' });

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ provider: 'Migdal' }));
    expect(mutation.eq).toHaveBeenCalledWith('id', 'policy-1');
    expect(mutation.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
  });
});

describe('deleteInsurancePolicy', () => {
  it('deletes only policies in the caller household', async () => {
    authOk();
    const mutation = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'policy-1' }, error: null }),
    };
    const deleteFn = vi.fn().mockReturnValue(mutation);

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'insurance_policies') return { delete: deleteFn };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await deleteInsurancePolicy('policy-1');

    expect(result).toEqual({ ok: true, data: { id: 'policy-1' } });
    expect(mutation.eq).toHaveBeenCalledWith('id', 'policy-1');
    expect(mutation.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
  });
});
