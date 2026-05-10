/**
 * Unit tests for getYearlyBondInterest (#357).
 *
 * Covers: empty result, single-year, multi-year, paid+received offset,
 * non-bond interest events are excluded, unauthenticated returns [].
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getYearlyBondInterest } from '../actions';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

function makeEvent(
  event_date: string,
  amount: number,
  type: string,
): { event_date: string; amount: number; raw_payload: Record<string, string> } {
  return { event_date, amount, raw_payload: { type } };
}

function chain(events: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: events, error: null }).then(resolve),
  };
}

function authSupabase(events: unknown[]) {
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'household_members') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null }),
        };
      }
      if (table === 'options_cash_events') return chain(events);
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
}

beforeEach(() => vi.resetAllMocks());

describe('getYearlyBondInterest (#357)', () => {
  it('returns empty array when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from: vi.fn() });

    await expect(getYearlyBondInterest()).resolves.toEqual([]);
  });

  it('returns empty array when there are no bond interest events', async () => {
    authSupabase([]);
    await expect(getYearlyBondInterest()).resolves.toEqual([]);
  });

  it('returns single-year result for one received event', async () => {
    authSupabase([makeEvent('2024-03-15', 250.0, 'Bond Interest Received')]);

    const result = await getYearlyBondInterest();

    expect(result).toEqual([{ year: 2024, net_amount: 250.0 }]);
  });

  it('offsets paid against received in same year', async () => {
    authSupabase([
      makeEvent('2024-03-15', 500.0, 'Bond Interest Received'),
      makeEvent('2024-06-15', -100.0, 'Bond Interest Paid'),
    ]);

    const result = await getYearlyBondInterest();

    expect(result).toHaveLength(1);
    expect(result[0].year).toBe(2024);
    expect(result[0].net_amount).toBeCloseTo(400.0, 2);
  });

  it('groups events across multiple years sorted ASC', async () => {
    authSupabase([
      makeEvent('2025-01-10', 890.0, 'Bond Interest Received'),
      makeEvent('2024-06-15', 1234.56, 'Bond Interest Received'),
      makeEvent('2026-03-01', 300.0, 'Bond Interest Received'),
    ]);

    const result = await getYearlyBondInterest();

    expect(result.map((r) => r.year)).toEqual([2024, 2025, 2026]);
    expect(result[0].net_amount).toBeCloseTo(1234.56, 2);
    expect(result[1].net_amount).toBeCloseTo(890.0, 2);
    expect(result[2].net_amount).toBeCloseTo(300.0, 2);
  });

  it('excludes non-bond interest event types', async () => {
    authSupabase([
      makeEvent('2024-05-01', 999.0, 'Credit Interest'),           // broker interest — exclude
      makeEvent('2024-05-02', 500.0, 'Bond Interest Received'),    // include
      makeEvent('2024-05-03', 12.0, 'Other Interest'),             // exclude
    ]);

    const result = await getYearlyBondInterest();

    expect(result).toHaveLength(1);
    expect(result[0].net_amount).toBeCloseTo(500.0, 2);
  });

  it('excludes years with zero net activity', async () => {
    authSupabase([
      makeEvent('2024-03-01', 100.0, 'Bond Interest Received'),
      makeEvent('2024-06-01', -100.0, 'Bond Interest Paid'),
    ]);

    const result = await getYearlyBondInterest();

    // Net is 0, should be excluded
    expect(result).toHaveLength(0);
  });

  it('rounds net_amount to 2 decimal places', async () => {
    authSupabase([
      makeEvent('2024-01-01', 333.333_33, 'Bond Interest Received'),
      makeEvent('2024-06-01', 100.1, 'Bond Interest Received'),
    ]);

    const result = await getYearlyBondInterest();

    expect(result).toHaveLength(1);
    // 333.33333 + 100.1 = 433.43333 → rounds to 433.43
    expect(result[0].net_amount).toBe(433.43);
  });

  it('handles both paid and received across multiple years correctly', async () => {
    // Matches the confirmed DB totals from the mission brief:
    // Bond Interest Paid: 46 events, sum -1321.72
    // Bond Interest Received: 57 events, sum 5590.06
    // For test purposes, two simplified years:
    authSupabase([
      makeEvent('2024-03-15', 2800.0, 'Bond Interest Received'),
      makeEvent('2024-06-15', -660.0, 'Bond Interest Paid'),
      makeEvent('2025-03-15', 2790.06, 'Bond Interest Received'),
      makeEvent('2025-06-15', -661.72, 'Bond Interest Paid'),
    ]);

    const result = await getYearlyBondInterest();

    expect(result).toHaveLength(2);
    expect(result[0].year).toBe(2024);
    expect(result[0].net_amount).toBeCloseTo(2140.0, 2);
    expect(result[1].year).toBe(2025);
    expect(result[1].net_amount).toBeCloseTo(2128.34, 2);
  });
});
