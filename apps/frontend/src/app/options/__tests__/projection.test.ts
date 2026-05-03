import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { getOptionsProjection, type OptionsRecord } from '../actions';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
});

function mockProjectionRows(records: ReadonlyArray<OptionsRecord | { year: number; amount: string }>): void {
  const householdQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null }),
  };
  const optionsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: records, error: null }),
  };
  const from = vi.fn((table: string) => {
    if (table === 'household_members') return householdQuery;
    if (table === 'options_income') return optionsQuery;
    throw new Error(`Unexpected table: ${table}`);
  });

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: mockGetUser },
    from,
  });
}

describe('getOptionsProjection', () => {
  it('returns an empty response for zero positions', async () => {
    mockProjectionRows([]);

    await expect(getOptionsProjection({ growth_rate: 0.05, cutoff_year: 2030, final_year: 2035 })).resolves.toEqual({
      data: [],
    });
  });

  it('returns only historical rows when final year is before the latest historical year', async () => {
    mockProjectionRows([{ year: 2023, amount: 5000 }]);

    const result = await getOptionsProjection({ growth_rate: 0.05, cutoff_year: 2030, final_year: 2020 });

    expect(result.data).toEqual([{ year: 2023, amount: 5000, type: 'historical' }]);
  });

  it('returns only historical rows when average income is zero or negative', async () => {
    mockProjectionRows([
      { year: 2022, amount: 100 },
      { year: 2023, amount: -100 },
    ]);

    const result = await getOptionsProjection({ growth_rate: 0.05, cutoff_year: 2030, final_year: 2035 });

    expect(result.data).toHaveLength(2);
    expect(result.data.every((point) => point.type === 'historical')).toBe(true);
  });

  it('projects one year of growth from the historical average', async () => {
    mockProjectionRows([{ year: 2023, amount: 5000 }]);

    const result = await getOptionsProjection({ growth_rate: 0.1, cutoff_year: 2030, final_year: 2024 });
    const projected = result.data.filter((point) => point.type === 'projected');

    expect(projected).toHaveLength(1);
    expect(projected[0]?.amount).toBeCloseTo(5500, 10);
  });

  it('compounds through deep in-the-money style high-income projections without float drift', async () => {
    mockProjectionRows([{ year: 2023, amount: 5000 }]);

    const result = await getOptionsProjection({ growth_rate: 0.1, cutoff_year: 2030, final_year: 2026 });
    const projected = result.data.filter((point) => point.type === 'projected');

    expect(projected).toHaveLength(3);
    expect(projected[2]?.amount).toBeCloseTo(6655, 10);
  });

  it('uses the average of all historical years as the projection base', async () => {
    mockProjectionRows([
      { year: 2021, amount: '2000.00' },
      { year: 2022, amount: '4000.00' },
      { year: 2023, amount: '6000.00' },
    ]);

    const result = await getOptionsProjection({ growth_rate: 0.1, cutoff_year: 2030, final_year: 2024 });
    const projected = result.data.filter((point) => point.type === 'projected');

    expect(projected[0]?.amount).toBeCloseTo(4400, 10);
  });

  it('holds projection flat after the cutoff year', async () => {
    mockProjectionRows([{ year: 2023, amount: 1000 }]);

    const result = await getOptionsProjection({ growth_rate: 0.1, cutoff_year: 2025, final_year: 2027 });
    const projected = result.data.filter((point) => point.type === 'projected');

    expect(projected.map((point) => point.amount)).toEqual([1100, 1210, 1210, 1210]);
  });

  it('treats already-expired cutoff years as flat at the base amount', async () => {
    mockProjectionRows([{ year: 2023, amount: 1000 }]);

    const result = await getOptionsProjection({ growth_rate: 0.1, cutoff_year: 2022, final_year: 2025 });
    const projected = result.data.filter((point) => point.type === 'projected');

    expect(projected.map((point) => point.amount)).toEqual([1000, 1000]);
  });

  it('keeps projections at the base amount when growth is zero', async () => {
    mockProjectionRows([{ year: 2023, amount: 3000 }]);

    const result = await getOptionsProjection({ growth_rate: 0, cutoff_year: 2030, final_year: 2025 });
    const projected = result.data.filter((point) => point.type === 'projected');

    expect(projected.map((point) => point.amount)).toEqual([3000, 3000]);
  });

  it('rejects an excessive projection horizon before allocating result rows', async () => {
    mockProjectionRows([{ year: 1999, amount: 3000 }]);

    await expect(getOptionsProjection({ growth_rate: 0.05, cutoff_year: 2199, final_year: 2200 })).rejects.toThrow(
      /horizon/i,
    );
  });

  it('rejects nonsensical deep out-of-the-money negative growth rates', async () => {
    mockProjectionRows([{ year: 2023, amount: 3000 }]);

    await expect(getOptionsProjection({ growth_rate: -1.01, cutoff_year: 2030, final_year: 2035 })).rejects.toThrow(
      /growth_rate/i,
    );
  });
});
