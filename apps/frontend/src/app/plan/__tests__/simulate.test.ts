import { describe, expect, it } from 'vitest';

import { runPlanSimulation } from '../actions';
import type { PlanData, PlanItem, PlanMilestone } from '@/components/Plan/types';

const CURRENT_YEAR = new Date().getFullYear();
const SETTINGS = { primaryUser: { birthYear: 1990 }, mainCurrency: 'ILS' };
const EMPTY_FINANCES = { data: { items: [] } };

function baseItem(overrides: Partial<PlanItem>): PlanItem {
  return {
    id: 'item',
    name: 'Item',
    category: 'Income',
    owner: 'You',
    currency: 'ILS',
    value: 0,
    growth_rate: 0,
    frequency: 'Yearly',
    ...overrides,
  };
}

function accountSettings(overrides: Partial<NonNullable<PlanItem['account_settings']>> = {}): NonNullable<PlanItem['account_settings']> {
  return {
    type: 'Broker',
    bond_allocation: 0,
    dividend_yield: 0,
    fees: 0,
    ...overrides,
  };
}

async function simulate(plan: PlanData) {
  return runPlanSimulation({ plan, finances: EMPTY_FINANCES, settings: SETTINGS });
}

describe('runPlanSimulation', () => {
  it('ports backend granular withdrawal details from an RSU account', async () => {
    const plan: PlanData = {
      items: [
        baseItem({
          id: 'exp1',
          name: 'Big Expense',
          category: 'Expense',
          value: 50_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
        baseItem({
          id: 'acc1',
          name: 'My RSU',
          category: 'Account',
          value: 100_000,
          account_settings: accountSettings({ type: 'RSU', withdrawal_priority: 1 }),
        }),
      ],
      milestones: [],
      settings: {},
    };

    const result = await simulate(plan);
    expect(result[0]).toMatchObject({
      year: CURRENT_YEAR,
      net_worth: 50_000,
      liquid_net_worth: 50_000,
      expenses: 50_000,
      withdrawals: 50_000,
      withdrawal_details: [
        { name: 'Withdrawal: My RSU', type: 'Portfolio Withdrawal', value: 50_000 },
      ],
    });
    expect(result[0].accounts[0]).toMatchObject({ name: 'My RSU', type: 'RSU', value: 50_000 });
  });

  it('ports backend unallocated-cash withdrawal behavior', async () => {
    const plan: PlanData = {
      items: [
        baseItem({
          id: 'inc1',
          name: 'Big Income',
          category: 'Income',
          value: 100_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
          end_condition: 'Date',
          end_date: `${CURRENT_YEAR}-12-31`,
        }),
        baseItem({
          id: 'exp1',
          name: 'Big Expense',
          category: 'Expense',
          value: 50_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR + 1}-01-01`,
        }),
      ],
      milestones: [],
      settings: {},
    };

    const result = await simulate(plan);
    expect(result[0]).toMatchObject({ net_worth: 100_000, income: 100_000, withdrawals: 0 });
    expect(result[0].savings_details).toEqual([
      { name: 'Unallocated Cash', type: 'Cash', value: 100_000 },
    ]);
    expect(result[1]).toMatchObject({
      net_worth: 52_000,
      expenses: 50_000,
      withdrawals: 50_000,
      withdrawal_details: [
        { name: 'Withdrawal: Unallocated Cash', type: 'Portfolio Withdrawal', value: 50_000 },
      ],
    });
  });

  it('matches backend income, tax, dividend display, and savings allocation', async () => {
    const plan: PlanData = {
      items: [
        baseItem({
          id: 'inc',
          name: 'Salary',
          category: 'Income',
          sub_category: 'Salary',
          value: 10_000,
          tax_rate: 10,
          frequency: 'Monthly',
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
        baseItem({
          id: 'exp',
          name: 'Rent',
          category: 'Expense',
          value: 5_000,
          frequency: 'Monthly',
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
        baseItem({
          id: 'acc',
          name: 'Brokerage',
          category: 'Account',
          value: 100_000,
          growth_rate: 5,
          account_settings: accountSettings({ type: 'Broker', dividend_yield: 2, dividend_policy: 'Accumulate', fees: 1 }),
          inflow_priority: 1,
        }),
      ],
      milestones: [],
      settings: {},
    };

    const result = await simulate(plan);
    expect(result[0]).toMatchObject({
      net_worth: 150_000,
      income: 122_000,
      tax_paid: 12_000,
      expenses: 60_000,
      total_dividend_income: 2_000,
    });
    expect(result[0].income_details).toContainEqual({ name: 'Salary', type: 'Salary', value: 120_000 });
    expect(result[0].income_details).toContainEqual({ name: 'Dividend: Brokerage', type: 'Dividend Income', gross: 2_000, value: 2_000 });
    expect(result[1]).toMatchObject({ net_worth: 207_000, income: 120_000, tax_paid: 12_000 });
  });

  it('handles an empty plan through the full horizon', async () => {
    const result = await simulate({ items: [], milestones: [], settings: {} });
    expect(result).toHaveLength(1990 + 95 - CURRENT_YEAR + 1);
    expect(result[0]).toMatchObject({
      year: CURRENT_YEAR,
      age: CURRENT_YEAR - 1990,
      net_worth: 0,
      income: 0,
      expenses: 0,
      withdrawals: 0,
    });
    expect(result.at(-1)).toMatchObject({ year: 2085, age: 95, net_worth: 0 });
  });

  it('handles zero contributions without changing pension principal', async () => {
    const result = await simulate({
      items: [
        baseItem({
          id: 'pension',
          name: 'Pension',
          category: 'Account',
          value: 100_000,
          account_settings: accountSettings({ type: 'Pension', monthly_contribution: 0, draw_income: false }),
        }),
      ],
      milestones: [],
      settings: {},
    });

    expect(result[0]).toMatchObject({ net_worth: 100_000, liquid_net_worth: 0 });
    expect(result[2].accounts[0]).toMatchObject({ name: 'Pension', value: 100_000 });
  });

  it('applies negative returns deterministically', async () => {
    const result = await simulate({
      items: [
        baseItem({
          id: 'bear',
          name: 'Bear Fund',
          category: 'Account',
          value: 100_000,
          growth_rate: -10,
          account_settings: accountSettings({ type: 'Broker' }),
        }),
      ],
      milestones: [],
      settings: {},
    });

    expect(result[0].net_worth).toBe(100_000);
    expect(result[1].net_worth).toBe(90_000);
    expect(result[2].net_worth).toBe(81_000);
  });

  it('supports very long horizons without overflow', async () => {
    const birthYear = CURRENT_YEAR - 1;
    const result = await runPlanSimulation({
      plan: {
        items: [baseItem({ id: 'cash', name: 'Cash', category: 'Account', value: 1_000, growth_rate: 1, account_settings: accountSettings({ type: 'Savings' }) })],
        milestones: [],
        settings: {},
      },
      finances: EMPTY_FINANCES,
      settings: { primaryUser: { birthYear }, mainCurrency: 'ILS' },
    });

    expect(result.length).toBeGreaterThan(90);
    expect(result.at(-1)?.age).toBe(95);
    expect(Number.isFinite(result.at(-1)?.net_worth ?? Number.NaN)).toBe(true);
  });

  it('keeps decimal precision within one cent', async () => {
    const result = await simulate({
      items: [
        baseItem({
          id: 'micro-income',
          name: 'Micro Income',
          category: 'Income',
          value: 0.1,
          frequency: 'Monthly',
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
      ],
      milestones: [],
      settings: {},
    });

    expect(result[0].net_worth).toBeCloseTo(1.2, 2);
  });

  it('detects a Date-type milestone and includes it in milestones_hit for the correct year', async () => {
    const retireYear = CURRENT_YEAR + 5;
    const milestone: PlanMilestone = {
      id: 'ms-retire',
      name: 'Retirement',
      type: 'Custom',
      date: `${retireYear}-01-01`,
    };
    const result = await simulate({ items: [], milestones: [milestone], settings: {} });
    const retirePoint = result.find(p => p.year === retireYear);
    expect(retirePoint).toBeDefined();
    expect(retirePoint?.milestones_hit).toContain('ms-retire');
    expect(result[0].milestones_hit).not.toContain('ms-retire');
  });

  it('starts milestone-conditioned income only from the referenced milestone year', async () => {
    const startYear = CURRENT_YEAR + 3;
    const milestone: PlanMilestone = {
      id: 'ms-event',
      name: 'Life Event',
      type: 'Custom',
      date: `${startYear}-01-01`,
    };
    const plan: PlanData = {
      items: [
        baseItem({
          id: 'conditional-income',
          name: 'Post-Event Income',
          category: 'Income',
          value: 50_000,
          start_condition: 'Milestone',
          start_reference: 'ms-event',
        }),
      ],
      milestones: [milestone],
      settings: {},
    };

    const result = await simulate(plan);
    const beforePoint = result.find(p => p.year === startYear - 1);
    expect(beforePoint?.income).toBe(0);
    const atPoint = result.find(p => p.year === startYear);
    expect(atPoint?.income).toBe(50_000);
    expect(atPoint?.income_details).toContainEqual(
      expect.objectContaining({ name: 'Post-Event Income', value: 50_000 }),
    );
  });

  it('resolves an Age-conditioned item against the primary user birth year', async () => {
    const targetAge = 40;
    const targetYear = 1990 + targetAge; // birth year from SETTINGS = 1990
    const plan: PlanData = {
      items: [
        baseItem({
          id: 'age-income',
          name: 'Age Income',
          category: 'Income',
          value: 30_000,
          start_condition: 'Age',
          start_reference: String(targetAge),
        }),
      ],
      milestones: [],
      settings: {},
    };

    const result = await simulate(plan);
    const beforePoint = result.find(p => p.year === targetYear - 1);
    if (beforePoint) expect(beforePoint.income).toBe(0);
    const atPoint = result.find(p => p.year === targetYear);
    if (atPoint) expect(atPoint.income).toBe(30_000);
  });

  it('incorporates options income for the matching year into income and income_details', async () => {
    const targetYear = CURRENT_YEAR + 2;
    const plan: PlanData = { items: [], milestones: [], settings: {} };
    const result = await runPlanSimulation({
      plan,
      finances: EMPTY_FINANCES,
      settings: SETTINGS,
      optionsProjection: [{ year: targetYear, expectedIncome: 5_000 }],
    });

    const point = result.find(p => p.year === targetYear);
    expect(point).toBeDefined();
    expect(point!.income).toBe(5_000);
    expect(point!.income_details).toContainEqual({
      name: 'Options Income',
      type: 'options',
      value: 5_000,
    });
  });

  it('does not include options income in years without a matching projection entry', async () => {
    const plan: PlanData = { items: [], milestones: [], settings: {} };
    const result = await runPlanSimulation({
      plan,
      finances: EMPTY_FINANCES,
      settings: SETTINGS,
      optionsProjection: [{ year: CURRENT_YEAR + 5, expectedIncome: 8_000 }],
    });

    const current = result.find(p => p.year === CURRENT_YEAR);
    expect(current!.income).toBe(0);
    expect(current!.income_details.some(d => d.type === 'options')).toBe(false);
  });

  it('is backward compatible — no optionsProjection produces identical results', async () => {
    const plan: PlanData = {
      items: [baseItem({ id: 'sal', name: 'Salary', category: 'Income', value: 100_000, start_condition: 'Date', start_date: `${CURRENT_YEAR}-01-01` })],
      milestones: [],
      settings: {},
    };

    const withoutOptions = await simulate(plan);
    const withEmptyOptions = await runPlanSimulation({ plan, finances: EMPTY_FINANCES, settings: SETTINGS, optionsProjection: [] });

    expect(withoutOptions[0].income).toBe(withEmptyOptions[0].income);
    expect(withoutOptions[0].net_worth).toBe(withEmptyOptions[0].net_worth);
    expect(withEmptyOptions[0].income_details.some(d => d.type === 'options')).toBe(false);
  });
});
