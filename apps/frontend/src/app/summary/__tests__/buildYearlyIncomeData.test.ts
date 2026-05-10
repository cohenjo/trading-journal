import { describe, it, expect } from 'vitest';
import { buildYearlyIncomeData } from '../buildYearlyIncomeData';

/**
 * Regression tests for #342 — dividend estimations must override projections.
 *
 * The specific assertion: for any year that has an estimation row, the
 * `dividendsIncome` field in the chart data equals the estimation amount,
 * NOT the projection amount (and NOT their sum, and NOT 0).
 *
 * To confirm a test would fail without the fix, revert the "Pass 1" block
 * in buildYearlyIncomeData.ts (the loop that processes estimationsMap for
 * years < currentYear). Without it, 2024 → dividendsIncome === 0.
 */
describe('buildYearlyIncomeData — estimation override semantics', () => {
  const BASE_PARAMS = {
    growthRate: 0.03,
    yieldRate: 0.04,
    reinvestRate: 0.5,
    finalYear: 2030,
    optionsFinalYear: 2030,
    optionsYearly: [] as Array<{ year: number; amount: number }>,
    ladderSeries: [] as Array<{ date: string; value: number }>,
  } as const;

  // ─── Core regression: estimation year before currentYear ─────────────────

  it('(#342 regression) uses estimation amount for a past year, not the projection', () => {
    const estimationsMap = new Map([[2024, 50_000]]);

    const result = buildYearlyIncomeData({
      ...BASE_PARAMS,
      currentYear: 2026,
      estimationsMap,
      // projection base is deliberately huge to make misuse obvious
      projectedDividendAmount: 999_999,
      // ensure 2024 ends up in allYears even without options data
      optionsYearly: [{ year: 2024, amount: 1_000 }],
    });

    const point2024 = result.find(p => p.year === 2024);

    // The three wrong outcomes that prove the bug is NOT fixed:
    expect(point2024?.dividendsIncome).not.toBe(999_999); // not the raw projection
    expect(point2024?.dividendsIncome).not.toBe(999_999 + 50_000); // not a sum
    expect(point2024?.dividendsIncome).not.toBe(0); // not silently zeroed

    // The correct outcome:
    expect(point2024?.dividendsIncome).toBe(50_000);
    expect(point2024?.dividendsSource).toBe('estimation');
  });

  // ─── Estimation year >= currentYear still overrides ───────────────────────

  it('uses estimation amount for a present/future year, not the projection', () => {
    const estimationsMap = new Map([[2026, 50_000]]);

    const result = buildYearlyIncomeData({
      ...BASE_PARAMS,
      currentYear: 2026,
      estimationsMap,
      projectedDividendAmount: 999_999,
    });

    const point2026 = result.find(p => p.year === 2026);
    expect(point2026?.dividendsIncome).toBe(50_000);
    expect(point2026?.dividendsSource).toBe('estimation');
  });

  // ─── Non-estimation year still uses projection ────────────────────────────

  it('falls back to projection for a year with no estimation', () => {
    const result = buildYearlyIncomeData({
      ...BASE_PARAMS,
      currentYear: 2026,
      estimationsMap: new Map(),
      projectedDividendAmount: 100_000,
      // zero growth so projection stays flat — easy to assert
      growthRate: 0,
      yieldRate: 0,
      reinvestRate: 0,
    });

    const point2026 = result.find(p => p.year === 2026);
    expect(point2026?.dividendsIncome).toBe(100_000);
    expect(point2026?.dividendsSource).toBe('projection');
  });

  // ─── Mixed: some years estimated, others projected ────────────────────────

  it('applies estimation override only for estimated years, leaves others projected', () => {
    // estimation for 2024 (past) and 2027 (future), nothing for 2026/2028
    const estimationsMap = new Map([
      [2024, 50_000],
      [2027, 75_000],
    ]);

    const result = buildYearlyIncomeData({
      ...BASE_PARAMS,
      currentYear: 2026,
      estimationsMap,
      projectedDividendAmount: 999_999,
      growthRate: 0,
      yieldRate: 0,
      reinvestRate: 0,
      optionsYearly: [{ year: 2024, amount: 0 }], // pull 2024 into allYears
    });

    const byYear = Object.fromEntries(result.map(p => [p.year, p]));

    // estimated years
    expect(byYear[2024]?.dividendsIncome).toBe(50_000);
    expect(byYear[2024]?.dividendsSource).toBe('estimation');
    expect(byYear[2027]?.dividendsIncome).toBe(75_000);
    expect(byYear[2027]?.dividendsSource).toBe('estimation');

    // projected years (zero growth so stays at 999_999)
    expect(byYear[2026]?.dividendsSource).toBe('projection');
    expect(byYear[2026]?.dividendsIncome).toBe(999_999);
    expect(byYear[2028]?.dividendsSource).toBe('projection');
    expect(byYear[2028]?.dividendsIncome).toBe(999_999);
  });

  // ─── Estimation years appear in the chart output ─────────────────────────

  it('estimation-only years appear in result even when not in options/ladder data', () => {
    const estimationsMap = new Map([[2023, 22_000]]);

    const result = buildYearlyIncomeData({
      ...BASE_PARAMS,
      currentYear: 2026,
      estimationsMap,
      projectedDividendAmount: 999_999,
      // no options data for 2023 — would otherwise be absent from allYears
      optionsYearly: [],
    });

    const years = result.map(p => p.year);
    expect(years).toContain(2023);

    const point2023 = result.find(p => p.year === 2023);
    expect(point2023?.dividendsIncome).toBe(22_000);
    expect(point2023?.dividendsSource).toBe('estimation');
  });

  // ─── bondInterest 4th series (#357) ────────────────────────────────────────

  it('populates bondInterestIncome from the bondInterest param', () => {
    const result = buildYearlyIncomeData({
      ...BASE_PARAMS,
      currentYear: 2026,
      estimationsMap: new Map(),
      projectedDividendAmount: 10_000,
      bondInterest: [
        { year: 2026, net_amount: 1_200 },
        { year: 2027, net_amount: 900 },
      ],
    });

    const byYear = Object.fromEntries(result.map(p => [p.year, p]));
    expect(byYear[2026]?.bondInterestIncome).toBe(1_200);
    expect(byYear[2027]?.bondInterestIncome).toBe(900);
    // Years with no bond interest entry default to 0
    expect(byYear[2028]?.bondInterestIncome).toBe(0);
  });

  it('bondInterest years are included in result even when not in other data', () => {
    const result = buildYearlyIncomeData({
      ...BASE_PARAMS,
      currentYear: 2026,
      estimationsMap: new Map(),
      projectedDividendAmount: 10_000,
      bondInterest: [{ year: 2024, net_amount: 500 }],
      optionsYearly: [],          // 2024 not in options or ladder
      ladderSeries: [],
    });

    const years = result.map(p => p.year);
    expect(years).toContain(2024);
    const point2024 = result.find(p => p.year === 2024);
    expect(point2024?.bondInterestIncome).toBe(500);
  });

  it('defaults bondInterestIncome to 0 when bondInterest param is omitted', () => {
    const result = buildYearlyIncomeData({
      ...BASE_PARAMS,
      currentYear: 2026,
      estimationsMap: new Map(),
      projectedDividendAmount: 10_000,
    });
    result.forEach(p => {
      expect(p.bondInterestIncome).toBe(0);
    });
  });
});
