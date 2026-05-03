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

import { createOptionsRecord, listOptionsRecords } from './actions';
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

function householdQuery(data: { household_id: string } | null = HOUSEHOLD_ROW) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

describe('listOptionsRecords', () => {
  it('returns empty array when not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    await expect(listOptionsRecords()).resolves.toEqual([]);
  });

  it('returns household-scoped options rows sorted by year', async () => {
    authOk();
    const order = vi.fn().mockResolvedValue({
      data: [
        { year: 2024, amount: '1234.56' },
        { year: 2025, amount: 7890 },
      ],
      error: null,
    });
    const optionsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order,
    };
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery();
      if (table === 'options_income') return optionsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from,
    });

    const records = await listOptionsRecords();

    expect(records).toEqual([
      { year: 2024, amount: 1234.56 },
      { year: 2025, amount: 7890 },
    ]);
    expect(optionsQuery.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
    expect(order).toHaveBeenCalledWith('year', { ascending: true });
  });
});

describe('createOptionsRecord', () => {
  it('returns an error when not authenticated and does not write', async () => {
    authFail();
    const upsert = vi.fn();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({ upsert })),
    });

    const result = await createOptionsRecord([{ year: 2024, amount: 1000 }]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not authenticated/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns an error when the user has no active household', async () => {
    authOk();
    const upsert = vi.fn();
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery(null);
      if (table === 'options_income') return { upsert };
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from,
    });

    const result = await createOptionsRecord([{ year: 2024, amount: 1000 }]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no active household/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts records with session-resolved household_id and composite conflict target', async () => {
    authOk();
    const not = vi.fn().mockResolvedValue({ error: null });
    const deleteQuery = {
      eq: vi.fn().mockReturnThis(),
      not,
    };
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const optionsQuery = {
      upsert,
      delete: vi.fn(() => deleteQuery),
    };
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery();
      if (table === 'options_income') return optionsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from,
    });

    const result = await createOptionsRecord([
      { year: 2025, amount: 2000 },
      { year: 2024, amount: -100.25 },
    ]);

    expect(result).toEqual({
      ok: true,
      records: [
        { year: 2024, amount: -100.25 },
        { year: 2025, amount: 2000 },
      ],
    });
    expect(upsert).toHaveBeenCalledWith(
      [
        { household_id: MOCK_HOUSEHOLD_ID, year: 2024, amount: -100.25 },
        { household_id: MOCK_HOUSEHOLD_ID, year: 2025, amount: 2000 },
      ],
      { onConflict: 'household_id,year' },
    );
    expect(deleteQuery.eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
    expect(not).toHaveBeenCalledWith('year', 'in', '(2024,2025)');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/options');
  });

  it('clears all household rows when saving an empty record set', async () => {
    authOk();
    const eq = vi.fn().mockResolvedValue({ error: null });
    const optionsQuery = {
      upsert: vi.fn(),
      delete: vi.fn(() => ({ eq })),
    };
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery();
      if (table === 'options_income') return optionsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from,
    });

    const result = await createOptionsRecord([]);

    expect(result).toEqual({ ok: true, records: [] });
    expect(optionsQuery.upsert).not.toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('household_id', MOCK_HOUSEHOLD_ID);
  });

  it('rejects duplicate years before writing', async () => {
    authOk();
    const upsert = vi.fn();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({ upsert })),
    });

    const result = await createOptionsRecord([
      { year: 2024, amount: 1000 },
      { year: 2024, amount: 2000 },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns an error when the DB upsert fails', async () => {
    authOk();
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'RLS violation' } });
    const optionsQuery = {
      upsert,
      delete: vi.fn(),
    };
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery();
      if (table === 'options_income') return optionsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from,
    });

    const result = await createOptionsRecord([{ year: 2024, amount: 1000 }]);

    expect(result.ok).toBe(false);
    expect(optionsQuery.delete).not.toHaveBeenCalled();
  });
});
