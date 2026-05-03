import type { Bond, DistributionRow, IncomePoint, RungData } from '@/components/Ladder/types';

export type LadderBondInput = Bond & { issue_date?: string };
export type Cashflow = {
  id: string;
  bond_id: string;
  date: string;
  amount: number;
  currency: string;
  type: 'COUPON' | 'PRINCIPAL';
  rung_id: string;
};

const DEFAULT_RUNG_TARGET = 20_000;
const BASE_YEAR = 2034;
const SHOULDER_YEARS = 4;

export function rungIdForYear(year: number): string {
  return String(year);
}

export function rungDateRange(year: number): { startDate: string; endDate: string } {
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

export function buildOverview(
  rungs: RungData[],
  bonds: LadderBondInput[],
  currentAmountByRung: ReadonlyMap<string, number> = new Map(),
): { rungs: RungData[]; bonds: Bond[] } {
  if (rungs.length === 0 && bonds.length === 0) return { rungs: [], bonds: [] };

  const maturityYears = bonds.map((bond) => parseIsoDate(bond.maturity_date).getUTCFullYear());
  const allYears = [...maturityYears, ...rungs.map((rung) => rung.year)];
  const startYear = Math.min(BASE_YEAR, ...allYears);
  const endYear = Math.max(...allYears, ...maturityYears.map((year) => year + SHOULDER_YEARS));
  const byId = new Map<string, RungData>();

  for (const rung of rungs) {
    byId.set(rung.id, {
      ...rung,
      target_amount: toFiniteNumber(rung.target_amount, DEFAULT_RUNG_TARGET),
      current_amount: toFiniteNumber(currentAmountByRung.get(rung.id), 0),
    });
  }

  for (let year = startYear; year <= endYear; year += 1) {
    const id = String(year);
    if (!byId.has(id)) {
      const { startDate, endDate } = rungDateRange(year);
      byId.set(id, {
        id,
        year,
        start_date: startDate,
        end_date: endDate,
        target_amount: DEFAULT_RUNG_TARGET,
        current_amount: toFiniteNumber(currentAmountByRung.get(id), 0),
      });
    }
  }

  const normalizedBonds = bonds.map((bond) => ({
    id: bond.id,
    ticker: bond.ticker ?? null,
    issuer: bond.issuer,
    currency: bond.currency,
    face_value: toFiniteNumber(bond.face_value, 0),
    coupon_rate: toFiniteNumber(bond.coupon_rate, 0),
    coupon_frequency: bond.coupon_frequency,
    maturity_date: bond.maturity_date,
    rung_id: bond.rung_id || rungIdForYear(parseIsoDate(bond.maturity_date).getUTCFullYear()),
  }));

  return {
    rungs: [...byId.values()].sort((a, b) => a.year - b.year),
    bonds: normalizedBonds,
  };
}

export function generateCashflowsForBond(
  bond: LadderBondInput,
  range: { fromDate: string; toDate: string },
): Cashflow[] {
  if (bond.currency !== 'USD') return [];

  const perYear = frequencyPerYear(bond.coupon_frequency);
  const monthsStep = 12 / perYear;
  const couponAmount = toFiniteNumber(bond.face_value, 0) * toFiniteNumber(bond.coupon_rate, 0) / perYear;
  const maturityDate = parseIsoDate(bond.maturity_date);
  const fromDate = parseIsoDate(range.fromDate);
  const toDate = parseIsoDate(range.toDate);
  const rungId = bond.rung_id || rungIdForYear(maturityDate.getUTCFullYear());
  const cashflows: Cashflow[] = [];

  if (bond.issue_date) {
    let paymentDate = addMonths(parseIsoDate(bond.issue_date), monthsStep);
    while (compareDates(paymentDate, maturityDate) < 0) {
      maybePushCoupon(cashflows, bond, paymentDate, couponAmount, fromDate, toDate, rungId);
      paymentDate = addMonths(paymentDate, monthsStep);
    }
  } else {
    let paymentDate = addMonths(maturityDate, -monthsStep);
    while (compareDates(paymentDate, fromDate) >= 0) {
      maybePushCoupon(cashflows, bond, paymentDate, couponAmount, fromDate, toDate, rungId);
      paymentDate = addMonths(paymentDate, -monthsStep);
    }
  }

  if (compareDates(maturityDate, fromDate) >= 0 && compareDates(maturityDate, toDate) <= 0) {
    cashflows.push({
      id: `${bond.id}-principal-${formatIsoDate(maturityDate)}`,
      bond_id: bond.id,
      date: formatIsoDate(maturityDate),
      amount: toFiniteNumber(bond.face_value, 0),
      currency: bond.currency,
      type: 'PRINCIPAL',
      rung_id: rungId,
    });
  }

  return cashflows.sort((a, b) => a.date.localeCompare(b.date));
}

export function buildIncome(
  bonds: LadderBondInput[],
  range: { fromDate: string; toDate: string },
): { income_series: IncomePoint[]; distributions: DistributionRow[] } {
  const bondById = new Map(bonds.map((bond) => [bond.id, bond]));
  const cashflows = bonds.flatMap((bond) => generateCashflowsForBond(bond, range));
  const distributions = cashflows.map((cashflow) => {
    const bond = bondById.get(cashflow.bond_id);
    return {
      id: cashflow.id,
      date: cashflow.date,
      amount: cashflow.amount,
      currency: cashflow.currency,
      type: cashflow.type,
      bond_id: cashflow.bond_id,
      ticker: bond?.ticker ?? null,
      issuer: bond?.issuer ?? '',
      maturity_date: bond?.maturity_date ?? cashflow.date,
      rung_id: cashflow.rung_id,
    } satisfies DistributionRow;
  }).sort((a, b) => a.date.localeCompare(b.date));

  const byYear = new Map<number, number>();
  for (const cashflow of cashflows) {
    const year = parseIsoDate(cashflow.date).getUTCFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + cashflow.amount);
  }

  const income_series = [...byYear.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, value]) => ({ date: `${year}-01-01`, value }));

  return { income_series, distributions };
}

export function defaultIncomeRange(today = new Date()): { fromDate: string; toDate: string } {
  return { fromDate: formatIsoDate(today), toDate: formatIsoDate(addDays(today, 365 * 30)) };
}

function maybePushCoupon(
  cashflows: Cashflow[],
  bond: LadderBondInput,
  paymentDate: Date,
  couponAmount: number,
  fromDate: Date,
  toDate: Date,
  rungId: string,
): void {
  if (compareDates(paymentDate, fromDate) < 0 || compareDates(paymentDate, toDate) > 0) return;
  cashflows.push({
    id: `${bond.id}-coupon-${formatIsoDate(paymentDate)}`,
    bond_id: bond.id,
    date: formatIsoDate(paymentDate),
    amount: couponAmount,
    currency: bond.currency,
    type: 'COUPON',
    rung_id: rungId,
  });
}

function frequencyPerYear(frequency: string): number {
  switch (frequency.toUpperCase()) {
    case 'ANNUAL': return 1;
    case 'SEMI_ANNUAL': return 2;
    case 'QUARTERLY': return 4;
    default: throw new Error(`Unsupported coupon_frequency: ${frequency}`);
  }
}

function addMonths(date: Date, months: number): Date {
  const monthIndex = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), 28)));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function compareDates(left: Date, right: Date): number {
  return formatIsoDate(left).localeCompare(formatIsoDate(right));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
