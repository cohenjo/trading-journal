import type { YearlyIncomeData } from '@/components/Summary/StackedIncomeBarChart';
import type { IncomePoint } from '@/components/Ladder/types';

export interface BuildYearlyIncomeParams {
  /** The current calendar year (used as the boundary between past actuals and forward projections). */
  currentYear: number;
  /** Map of year → user-entered estimation amount. May contain years before OR after currentYear. */
  estimationsMap: Map<number, number>;
  /** Base annual dividend income used as the starting point for the projection formula. */
  projectedDividendAmount: number;
  growthRate: number;
  yieldRate: number;
  reinvestRate: number;
  finalYear: number;
  optionsFinalYear: number;
  optionsYearly: Array<{ year: number; amount: number; isProjected?: boolean }>;
  ladderSeries: IncomePoint[];
  /** Optional realized bond interest per year. Comes from getYearlyBondInterest(). */
  bondInterest?: Array<{ year: number; net_amount: number }>;
}

/**
 * Pure function that merges options, dividend, and bond income into a
 * per-year array ready for `StackedIncomeBarChart`.
 *
 * Key override rule: for ANY year that has an estimation row, the
 * `dividendsIncome` value is the estimation amount — the projection is
 * completely ignored for that year. This applies to years both before
 * and after `currentYear`.
 */
export function buildYearlyIncomeData(params: BuildYearlyIncomeParams): YearlyIncomeData[] {
  const {
    currentYear,
    estimationsMap,
    projectedDividendAmount: baseDividendAmount,
    growthRate,
    yieldRate,
    reinvestRate,
    finalYear,
    optionsFinalYear,
    optionsYearly,
    ladderSeries,
    bondInterest = [],
  } = params;

  const optionsMap = new Map(optionsYearly.map(o => [o.year, o.amount]));
  const optionsSourceMap = new Map(
    optionsYearly.map(o => [o.year, o.isProjected ? 'projection' as const : 'actual' as const]),
  );

  const ladderMap = new Map<number, number>();
  for (const point of ladderSeries) {
    const year = new Date(point.date).getFullYear();
    ladderMap.set(year, (ladderMap.get(year) ?? 0) + point.value);
  }

  const bondInterestMap = new Map<number, number>(bondInterest.map(b => [b.year, b.net_amount]));

  const divMap = new Map<number, number>();
  const divSourceMap = new Map<number, 'estimation' | 'projection'>();

  // Pass 1: honour estimations for years BEFORE currentYear.
  // The projection loop below only starts at currentYear, so without this
  // pass those years would silently fall through to `divMap.get(year) || 0`
  // and show as $0 in the chart — the exact bug reported in #342.
  for (const [year, amount] of estimationsMap) {
    if (year < currentYear) {
      divMap.set(year, amount);
      divSourceMap.set(year, 'estimation');
    }
  }

  // Pass 2: project forward from currentYear, overriding with estimations
  // wherever the user has entered one.
  let runningProjection = baseDividendAmount;
  for (let year = currentYear; year <= finalYear; year += 1) {
    if (estimationsMap.has(year)) {
      divMap.set(year, estimationsMap.get(year)!);
      divSourceMap.set(year, 'estimation');
    } else {
      if (year > currentYear) {
        runningProjection *= 1 + growthRate + yieldRate * reinvestRate;
      }
      divMap.set(year, Math.round(runningProjection * 100) / 100);
      divSourceMap.set(year, 'projection');
    }
  }

  // Build the union of all years to render.
  const allYears = new Set<number>();
  optionsYearly.forEach(o => allYears.add(o.year));
  ladderSeries.forEach(l => allYears.add(new Date(l.date).getFullYear()));
  bondInterest.forEach(b => allYears.add(b.year));
  for (let year = currentYear; year <= Math.min(finalYear, optionsFinalYear); year++) {
    allYears.add(year);
  }
  // Include estimation years explicitly — they may pre-date currentYear and
  // would otherwise only appear in the chart if options/ladder data happened
  // to share the same year.
  estimationsMap.forEach((_, year) => allYears.add(year));

  const maxYear = Math.min(finalYear, optionsFinalYear);
  const sortedYears = Array.from(allYears)
    .filter(y => y <= maxYear)
    .sort((a, b) => a - b);

  return sortedYears.map(year => ({
    year,
    optionsIncome: optionsMap.get(year) ?? 0,
    optionsSource: optionsSourceMap.get(year),
    dividendsIncome: divMap.get(year) ?? 0,
    dividendsSource: divSourceMap.get(year),
    bondsIncome: ladderMap.get(year) ?? 0,
    bondInterestIncome: bondInterestMap.get(year) ?? 0,
    isProjected: year > currentYear,
  }));
}
