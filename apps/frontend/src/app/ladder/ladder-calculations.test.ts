import { describe, expect, it } from 'vitest';
import { buildIncome, buildOverview, generateCashflowsForBond } from './ladder-calculations';
import type { Bond, RungData } from '@/components/Ladder/types';

const testBond: Bond & { issue_date: string } = {
  id: 'TESTBOND',
  issuer: 'Test Treasury 5% 01/01/2026',
  currency: 'USD',
  face_value: 1_000,
  coupon_rate: 0.05,
  coupon_frequency: 'ANNUAL',
  issue_date: '2024-01-01',
  maturity_date: '2026-01-01',
  rung_id: '2026',
};

describe('ladder cashflow calculations', () => {
  it('ports the FastAPI coupon/principal schedule when issue_date is available', () => {
    const cashflows = generateCashflowsForBond(testBond, { fromDate: '2024-01-01', toDate: '2026-12-31' });
    expect(cashflows).toEqual([
      { id: 'TESTBOND-coupon-2025-01-01', bond_id: 'TESTBOND', date: '2025-01-01', amount: 50, currency: 'USD', type: 'COUPON', rung_id: '2026' },
      { id: 'TESTBOND-principal-2026-01-01', bond_id: 'TESTBOND', date: '2026-01-01', amount: 1_000, currency: 'USD', type: 'PRINCIPAL', rung_id: '2026' },
    ]);
  });

  it('aggregates generated cashflows by calendar year for income series', () => {
    const result = buildIncome([testBond], { fromDate: '2024-01-01', toDate: '2026-12-31' });
    expect(result.income_series).toEqual([
      { date: '2025-01-01', value: 50 },
      { date: '2026-01-01', value: 1_000 },
    ]);
    expect(result.distributions).toHaveLength(2);
  });

  it('derives persisted rung current amounts from bond aggregation totals', () => {
    const rungs: RungData[] = [{ id: '2037', year: 2037, start_date: '2037-01-01', end_date: '2037-12-31', target_amount: 20_000, current_amount: 0 }];
    const bonds: Bond[] = [{ id: 'B1', issuer: 'Bond 1', currency: 'USD', face_value: 100_000, coupon_rate: 0.04, coupon_frequency: 'SEMI_ANNUAL', maturity_date: '2037-06-30', rung_id: '2037' }];
    const overview = buildOverview(rungs, bonds, new Map([['2037', 100_000]]));
    expect(overview.rungs.find((rung) => rung.id === '2037')?.current_amount).toBe(100_000);
    expect(overview.rungs.at(-1)?.year).toBe(2041);
    expect(overview.bonds[0].rung_id).toBe('2037');
  });
});
