import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetUser } = vi.hoisted(() => ({ mockGetUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getOptionsMonthlyMetrics, getUserAccountsWithOptionsEnabled, getOptionsIncomeEstimation } from './actions';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_HOUSEHOLD_ID = 'household-uuid-5678';

function householdQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { household_id: MOCK_HOUSEHOLD_ID }, error: null }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null });
});

describe('options dashboard actions', () => {
  it('returns empty monthly metrics when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from: vi.fn() });

    await expect(getOptionsMonthlyMetrics(2026)).resolves.toEqual([]);
  });

  it('reads cooked monthly metrics without touching legacy options_income', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{
        account_id: 'DU123',
        period_start: '2026-03-01',
        period_end: '2026-03-31',
        cash_flow_total: '2700.00',
        realized_pnl_total: '1000.00',
        cash_flow_cumulative: '2700.00',
        realized_pnl_cumulative: '1000.00',
        variance_gap: '1700.00',
        variance_gap_cumulative: '1700.00',
        trade_count: 4,
        roll_count: 1,
        roll_positive_count: 0,
        roll_negative_count: 1,
        roll_neutral_count: 0,
        roll_efficiency_pct: '0.00',
        last_computed_at: '2026-03-31T00:00:00Z',
      }],
      error: null,
    });
    const metricsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order,
    };
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery();
      if (table === 'options_dashboard_monthly') return metricsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from });

    const result = await getOptionsMonthlyMetrics(2026, 'DU123');

    expect(result).toEqual([{ accountId: 'DU123', periodStart: '2026-03-01', periodEnd: '2026-03-31', cashFlow: '2700.00', realizedPnl: '1000.00', cumulativeCashFlow: '2700.00', cumulativeRealizedPnl: '1000.00', varianceGap: '1700.00', cumulativeVarianceGap: '1700.00', tradeCount: 4, rollCount: 1, rollPositiveCount: 0, rollNegativeCount: 1, rollNeutralCount: 0, rollEfficiencyPct: '0.00', lastComputedAt: '2026-03-31T00:00:00Z' }]);
    expect(from).not.toHaveBeenCalledWith('options_income');
    expect(metricsQuery.eq).toHaveBeenCalledWith('account_id', 'DU123');
  });

  it('lists options-enabled trading accounts for the filter', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 7, account_id: 'DU777', linked_account_id: null }],
      error: null,
    });
    const accountsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order,
    };
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdQuery();
      if (table === 'trading_account_config') return accountsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from });

    await expect(getUserAccountsWithOptionsEnabled()).resolves.toEqual([{ id: '7', label: 'DU777', accountId: 'DU777', accountType: 'IBKR' }]);
    expect(accountsQuery.eq).toHaveBeenCalledWith('compute_options_income', true);
  });
});

// ── getOptionsIncomeEstimation ─────────────────────────────────────────────────

/**
 * Helper: build a mock supabase client whose `options_dashboard_monthly` query
 * returns the supplied rows, and whose `household_members` query resolves normally.
 */
function makeEstimationClient(
  rows: Array<{ period_start: string; cash_flow_total: string | number }>,
  queryError: null | { message: string } = null,
) {
  const order = vi.fn().mockResolvedValue({ data: queryError ? null : rows, error: queryError });
  const estimationQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order,
  };
  const from = vi.fn((table: string) => {
    if (table === 'household_members') return householdQuery();
    if (table === 'options_dashboard_monthly') return estimationQuery;
    throw new Error(`Unexpected table: ${table}`);
  });
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from });
}

describe('getOptionsIncomeEstimation', () => {
  it('computes 3-year average baseline and projects forward with default 2% growth', async () => {
    // 3 full years: 2022 = 12000, 2023 = 15000, 2024 = 18000 → avg = 15000
    makeEstimationClient([
      { period_start: '2022-01-01', cash_flow_total: '6000' },
      { period_start: '2022-07-01', cash_flow_total: '6000' },
      { period_start: '2023-01-01', cash_flow_total: '7500' },
      { period_start: '2023-07-01', cash_flow_total: '7500' },
      { period_start: '2024-01-01', cash_flow_total: '9000' },
      { period_start: '2024-07-01', cash_flow_total: '9000' },
    ]);

    const currentYear = new Date().getFullYear();
    const result = await getOptionsIncomeEstimation({ growthRate: 0.02, finalYear: currentYear + 2 });

    expect(result.baselineAverage).toBeCloseTo(15000, 5);
    expect(result.growthRate).toBe(0.02);
    expect(result.projections).toHaveLength(2);

    // Year 1: 15000 × 1.02^1 = 15300
    expect(result.projections[0].year).toBe(currentYear + 1);
    expect(result.projections[0].expectedIncome).toBeCloseTo(15300, 4);
    expect(result.projections[0].isProjected).toBe(true);

    // Year 2: 15000 × 1.02^2 = 15606
    expect(result.projections[1].year).toBe(currentYear + 2);
    expect(result.projections[1].expectedIncome).toBeCloseTo(15606, 4);
  });

  it('falls back to <3 years of history (2-year average)', async () => {
    // Only 2 years available: 2023 = 10000, 2024 = 20000 → avg = 15000
    makeEstimationClient([
      { period_start: '2023-06-01', cash_flow_total: '10000' },
      { period_start: '2024-06-01', cash_flow_total: '20000' },
    ]);

    const currentYear = new Date().getFullYear();
    const result = await getOptionsIncomeEstimation({ growthRate: 0, finalYear: currentYear + 1 });

    expect(result.baselineAverage).toBeCloseTo(15000, 5);
  });

  it('falls back to 1-year history when only one year exists', async () => {
    makeEstimationClient([
      { period_start: '2024-03-01', cash_flow_total: '8000' },
      { period_start: '2024-09-01', cash_flow_total: '4000' },
    ]);

    const result = await getOptionsIncomeEstimation({ growthRate: 0, finalYear: new Date().getFullYear() + 1 });

    expect(result.baselineAverage).toBeCloseTo(12000, 5);
  });

  it('projects 0% growth — every year equals baseline exactly', async () => {
    makeEstimationClient([
      { period_start: '2022-01-01', cash_flow_total: '5000' },
      { period_start: '2023-01-01', cash_flow_total: '5000' },
      { period_start: '2024-01-01', cash_flow_total: '5000' },
    ]);

    const currentYear = new Date().getFullYear();
    const result = await getOptionsIncomeEstimation({ growthRate: 0, finalYear: currentYear + 3 });

    expect(result.projections).toHaveLength(3);
    for (const p of result.projections) {
      expect(p.expectedIncome).toBeCloseTo(5000, 5);
    }
  });

  it('projects negative baseline forward without flooring at zero', async () => {
    // 3 years of net losses → avg = -3000
    makeEstimationClient([
      { period_start: '2022-01-01', cash_flow_total: '-3000' },
      { period_start: '2023-01-01', cash_flow_total: '-3000' },
      { period_start: '2024-01-01', cash_flow_total: '-3000' },
    ]);

    const currentYear = new Date().getFullYear();
    const result = await getOptionsIncomeEstimation({ growthRate: 0.02, finalYear: currentYear + 1 });

    expect(result.baselineAverage).toBeCloseTo(-3000, 5);
    // -3000 × 1.02^1 = -3060
    expect(result.projections[0].expectedIncome).toBeCloseTo(-3060, 4);
    expect(result.projections[0].expectedIncome).toBeLessThan(0);
  });

  it('returns empty projections for empty history', async () => {
    makeEstimationClient([]);

    const result = await getOptionsIncomeEstimation({ growthRate: 0.02, finalYear: 2064 });

    expect(result.baselineAverage).toBe(0);
    expect(result.projections).toHaveLength(0);
  });

  it('returns empty projections when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from: vi.fn() });

    const result = await getOptionsIncomeEstimation({ growthRate: 0.02, finalYear: 2064 });

    expect(result.baselineAverage).toBe(0);
    expect(result.projections).toHaveLength(0);
  });

  it('uses default growthRate 0.02 and finalYear 2064 when no params are passed', async () => {
    makeEstimationClient([
      { period_start: '2024-01-01', cash_flow_total: '10000' },
    ]);

    const result = await getOptionsIncomeEstimation();

    expect(result.growthRate).toBe(0.02);
    // finalYear defaults to 2064 — projections span from currentYear+1 to 2064
    const currentYear = new Date().getFullYear();
    expect(result.projections.length).toBe(2064 - currentYear);
    expect(result.projections[0].year).toBe(currentYear + 1);
    expect(result.projections[result.projections.length - 1].year).toBe(2064);
  });

  // ── Growth rate edge cases ────────────────────────────────────────────────

  it('100% growth rate: each projection year doubles the previous year income', async () => {
    // 3 equal years → baseline = 10 000
    makeEstimationClient([
      { period_start: '2022-01-01', cash_flow_total: '10000' },
      { period_start: '2023-01-01', cash_flow_total: '10000' },
      { period_start: '2024-01-01', cash_flow_total: '10000' },
    ]);

    const currentYear = new Date().getFullYear();
    const result = await getOptionsIncomeEstimation({ growthRate: 1.0, finalYear: currentYear + 3 });

    expect(result.baselineAverage).toBeCloseTo(10_000, 5);
    expect(result.growthRate).toBe(1.0);

    // baseline × 2^1 = 20 000
    expect(result.projections[0].expectedIncome).toBeCloseTo(20_000, 4);
    // baseline × 2^2 = 40 000
    expect(result.projections[1].expectedIncome).toBeCloseTo(40_000, 4);
    // baseline × 2^3 = 80 000
    expect(result.projections[2].expectedIncome).toBeCloseTo(80_000, 4);
    expect(result.projections[0].isProjected).toBe(true);
  });

  it('0.001% growth rate: compound effect is negligible over one year', async () => {
    // 0.001% = 0.00001 as a decimal fraction
    makeEstimationClient([
      { period_start: '2022-01-01', cash_flow_total: '10000' },
      { period_start: '2023-01-01', cash_flow_total: '10000' },
      { period_start: '2024-01-01', cash_flow_total: '10000' },
    ]);

    const currentYear = new Date().getFullYear();
    const result = await getOptionsIncomeEstimation({ growthRate: 0.00001, finalYear: currentYear + 2 });

    expect(result.baselineAverage).toBeCloseTo(10_000, 5);
    // 10 000 × 1.00001^1 = 10 000.1 — only a 10-cent difference from baseline
    expect(result.projections[0].expectedIncome).toBeCloseTo(10_000.1, 3);
    // 10 000 × 1.00001^2 ≈ 10 000.2 — still nearly identical to baseline
    expect(result.projections[1].expectedIncome).toBeGreaterThan(10_000);
    expect(result.projections[1].expectedIncome).toBeLessThan(10_001);
  });
});
