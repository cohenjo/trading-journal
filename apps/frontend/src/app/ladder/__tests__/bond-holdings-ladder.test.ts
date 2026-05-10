/**
 * Regression tests for #356 — getLadderOverview / getLadderIncome must read from
 * bond_holdings (IBKR live positions) and render all 18 rungs.
 *
 * Key invariants tested:
 * - 18 bond_holdings bonds → 18 bonds in overview (one per rung where maturities differ)
 * - coupon_rate is stored in % units in bond_holdings (4.25) and must arrive in
 *   Bond as a decimal (0.0425) — tested via income projection amounts
 * - Bonds are sorted by maturity_date ASC
 * - Manual ladder_bonds are merged and deduped by id
 * - bond_holdings query error degrades gracefully (returns [] for holding bonds)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getLadderOverview, getLadderIncome } from '../actions';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

/** 18 representative bond_holdings rows (percentage coupon_rate). */
const MOCK_HOLDING_ROWS = Array.from({ length: 18 }, (_, i) => ({
  id: `flex_U2515365_${600_000_000 + i}_2026-05-08`,
  ticker: `BOND${i + 1}`,
  issuer: null, // NULL for IBKR flex bonds — issuer should fall back to ticker
  currency: 'USD',
  face_value: 10_000,
  coupon_rate: 4.25, // percentage units — must be divided by 100 in mapping
  coupon_frequency: null, // NULL → defaults to SEMI_ANNUAL
  maturity_date: `20${30 + i}-06-${15 + (i % 15)}`,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
});

function householdQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null }),
  };
}

function makeSupabase(overrides: Record<string, unknown> = {}) {
  return {
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery();
      if (table === 'ladder_rungs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'ladder_bonds') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'bond_holdings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: MOCK_HOLDING_ROWS, error: null }),
        };
      }
      if (table in overrides) return overrides[table];
      throw new Error(`Unexpected table: ${table}`);
    }),
    ...overrides,
  };
}

describe('getLadderOverview — bond_holdings integration (#356)', () => {
  it('18 bond_holdings bonds yield 18 bonds in overview (regression)', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeSupabase());

    const result = await getLadderOverview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bonds).toHaveLength(18);
  });

  it('bonds are sorted by maturity_date ASC', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeSupabase());

    const result = await getLadderOverview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dates = result.data.bonds.map((b) => b.maturity_date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it('coupon_rate is stored as % in bond_holdings and converted to decimal in Bond', async () => {
    // bond_holdings.coupon_rate = 4.25 → Bond.coupon_rate should be 0.0425
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeSupabase());

    const result = await getLadderOverview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const bond of result.data.bonds) {
      // coupon_rate 4.25 / 100 = 0.0425; all mock rows have 4.25
      expect(bond.coupon_rate).toBeCloseTo(0.0425, 4);
    }
  });

  it('issuer falls back to ticker when bond_holdings.issuer is NULL', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeSupabase());

    const result = await getLadderOverview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // All mock rows have issuer=null and ticker='BONDn'
    expect(result.data.bonds.every((b) => b.issuer.startsWith('BOND'))).toBe(true);
  });

  it('coupon_frequency defaults to SEMI_ANNUAL when NULL in bond_holdings', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeSupabase());

    const result = await getLadderOverview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bonds.every((b) => b.coupon_frequency === 'SEMI_ANNUAL')).toBe(true);
  });

  it('manually added ladder_bonds are merged with holding bonds (no duplicates)', async () => {
    const manualBond = {
      id: 'bond-2050-my-manual-bond',
      ticker: 'MANUAL',
      issuer: 'Manual Bond Inc',
      currency: 'USD',
      face_value: 5_000,
      coupon_rate: 0.05,
      coupon_frequency: 'ANNUAL',
      maturity_date: '2050-01-01',
      rung_id: '2050',
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'ladder_rungs') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === 'ladder_bonds') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [manualBond], error: null }) };
        }
        if (table === 'bond_holdings') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: MOCK_HOLDING_ROWS, error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLadderOverview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 18 from bond_holdings + 1 manual = 19 total (no duplicates)
    expect(result.data.bonds).toHaveLength(19);
    expect(result.data.bonds.find((b) => b.id === 'bond-2050-my-manual-bond')).toBeDefined();
  });

  it('bond_holdings query error degrades gracefully — returns ladder_bonds only', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'ladder_rungs') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === 'ladder_bonds') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === 'bond_holdings') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLadderOverview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Degraded: no bonds (holding bonds failed, ladder_bonds empty)
    expect(result.data.bonds).toHaveLength(0);
  });
});

describe('getLadderIncome — bond_holdings integration (#356)', () => {
  it('projects income for 18 bond_holdings bonds', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'ladder_bonds') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === 'bond_holdings') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: MOCK_HOLDING_ROWS, error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLadderIncome({ fromDate: '2026-01-01', toDate: '2060-12-31' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Income series should have at least one entry (bonds in range)
    expect(result.data.income_series.length).toBeGreaterThan(0);
    // Distributions should include both COUPON and PRINCIPAL cashflows
    const types = new Set(result.data.distributions.map((d) => d.type));
    expect(types.has('COUPON')).toBe(true);
    expect(types.has('PRINCIPAL')).toBe(true);
  });

  it('annual coupon amount = face_value * (coupon_rate_pct / 100) for SEMI_ANNUAL bonds', async () => {
    // One bond: face=10_000, coupon_rate in DB=4.25 (%), SEMI_ANNUAL
    // Expected semi-annual coupon: 10_000 * 0.0425 / 2 = 212.50
    const singleBond = [{
      id: 'flex_test_coupon',
      ticker: 'T 4 1/4',
      issuer: null,
      currency: 'USD',
      face_value: 10_000,
      coupon_rate: 4.25,
      coupon_frequency: null, // defaults to SEMI_ANNUAL
      maturity_date: '2030-02-15',
    }];

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members') return householdQuery();
        if (table === 'ladder_bonds') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === 'bond_holdings') {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: singleBond, error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getLadderIncome({ fromDate: '2026-01-01', toDate: '2030-12-31' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const coupons = result.data.distributions.filter((d) => d.type === 'COUPON');
    expect(coupons.length).toBeGreaterThan(0);
    // Each coupon should be ~212.50 (10_000 * 0.0425 / 2)
    for (const coupon of coupons) {
      expect(coupon.amount).toBeCloseTo(212.5, 1);
    }
  });
});
