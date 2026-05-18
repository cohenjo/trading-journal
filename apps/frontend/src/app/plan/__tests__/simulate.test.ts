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

// ---------------------------------------------------------------------------
// Per-account dividend + reinvestment contract tests
// Written against: squad/cashflow-dividend-redesign contract (Keaton + McManus)
// Field: PlanSimulationInput.dividendByAccount — added by McManus's PR.
// These tests are TDD-style: new dividend-path tests will be red until
// McManus lands; backward-compat test (test 6) is green immediately.
// ---------------------------------------------------------------------------

/** Forward-declared contract type — McManus adds dividendByAccount to PlanSimulationInput */
interface DividendByAccount {
  ibkr: number;
  schwab: number;
  ira: number;
}

/** Extension type used in test call-sites to avoid @ts-ignore pollution */
type SimInputWithPerAccountDividends = Parameters<typeof runPlanSimulation>[0] & {
  dividendByAccount?: DividendByAccount;
};

const USD_SETTINGS = { primaryUser: { birthYear: 1990 }, mainCurrency: 'USD' };

describe("dividendByAccount: per-account real dividends + reinvestment", () => {
  // ── helpers ────────────────────────────────────────────────────────────────

  function surplusPlan(): PlanData {
    return {
      items: [
        baseItem({
          id: 'sal',
          name: 'Salary',
          category: 'Income',
          value: 100_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
        baseItem({
          id: 'exp',
          name: 'Living',
          category: 'Expense',
          value: 30_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
      ],
      milestones: [],
      settings: {},
    };
  }

  async function sim(input: SimInputWithPerAccountDividends) {
    return runPlanSimulation(input as Parameters<typeof runPlanSimulation>[0]);
  }

  // ── test 1: surplus year — full reinvest ───────────────────────────────────

  it('surplus year: emits 3 income lines + 3 reinvest lines; sums are equal (mass conservation)', async () => {
    const result = await sim({
      plan: surplusPlan(),
      finances: EMPTY_FINANCES,
      settings: USD_SETTINGS,
      dividendByAccount: { ibkr: 12_000, schwab: 8_000, ira: 5_000 },
    });

    const yr0 = result[0];
    const divLines = yr0.income_details.filter(d => d.type === 'dividends' && d.name?.startsWith('Dividend - '));
    expect(divLines).toHaveLength(3);
    expect(yr0.income_details).toContainEqual(expect.objectContaining({ name: 'Dividend - IBKR', type: 'dividends', value: 12_000 }));
    expect(yr0.income_details).toContainEqual(expect.objectContaining({ name: 'Dividend - Schwab', type: 'dividends', value: 8_000 }));
    expect(yr0.income_details).toContainEqual(expect.objectContaining({ name: 'Dividend - IRA', type: 'dividends', value: 5_000 }));

    const reinvestLines = yr0.savings_details.filter(d => d.type === 'reinvestment');
    expect(reinvestLines).toHaveLength(3);
    expect(reinvestLines).toContainEqual(expect.objectContaining({ name: 'Dividend Reinvest - IBKR', value: 12_000 }));
    expect(reinvestLines).toContainEqual(expect.objectContaining({ name: 'Dividend Reinvest - Schwab', value: 8_000 }));
    expect(reinvestLines).toContainEqual(expect.objectContaining({ name: 'Dividend Reinvest - IRA', value: 5_000 }));

    // Mass conservation: sum(div income) === sum(reinvestment outflows)
    const divSum = divLines.reduce((s, d) => s + (d.value ?? 0), 0);
    const reinvestSum = reinvestLines.reduce((s, d) => s + (d.value ?? 0), 0);
    expect(divSum).toBe(reinvestSum); // 25_000 === 25_000

    expect(yr0.total_dividend_income).toBeGreaterThanOrEqual(25_000);
  });

  // ── test 2: deficit year — dividends fully consumed ───────────────────────

  it('deficit year (deficit > dividends): 3 income lines emitted; zero reinvestment; withdrawals reduced vs no-dividend baseline', async () => {
    const deficitPlan: PlanData = {
      items: [
        baseItem({
          id: 'exp',
          name: 'BigExp',
          category: 'Expense',
          value: 100_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
        baseItem({
          id: 'acc',
          name: 'Savings',
          category: 'Account',
          value: 500_000,
          account_settings: accountSettings({ type: 'Savings', withdrawal_priority: 1 }),
        }),
      ],
      milestones: [],
      settings: {},
    };

    const [withDiv, withoutDiv] = await Promise.all([
      sim({ plan: deficitPlan, finances: EMPTY_FINANCES, settings: USD_SETTINGS, dividendByAccount: { ibkr: 12_000, schwab: 8_000, ira: 5_000 } }),
      sim({ plan: deficitPlan, finances: EMPTY_FINANCES, settings: USD_SETTINGS }),
    ]);

    const yr0 = withDiv[0];

    // 3 income lines still emitted at full gross amounts
    expect(yr0.income_details).toContainEqual(expect.objectContaining({ name: 'Dividend - IBKR', type: 'dividends', value: 12_000 }));
    expect(yr0.income_details).toContainEqual(expect.objectContaining({ name: 'Dividend - Schwab', type: 'dividends', value: 8_000 }));
    expect(yr0.income_details).toContainEqual(expect.objectContaining({ name: 'Dividend - IRA', type: 'dividends', value: 5_000 }));

    // No reinvestment lines
    const reinvestLines = yr0.savings_details.filter(d => d.type === 'reinvestment');
    expect(reinvestLines).toHaveLength(0);

    // Withdrawals reduced by ~$25K vs no-dividend baseline
    const divTotal = 12_000 + 8_000 + 5_000;
    expect(yr0.withdrawals).toBeCloseTo(withoutDiv[0].withdrawals - divTotal, -2);
  });

  // ── test 3: deficit year — dividends partially consumed ───────────────────

  it('partial deficit: proportional reinvestment of residual ($10K out of $25K dividends)', async () => {
    // Non-dividend income = $10K salary, expenses = $25K → deficit = $15K without dividends.
    // Dividends = $25K → residual = $10K → reinvested pro-rata.
    const partialPlan: PlanData = {
      items: [
        baseItem({
          id: 'sal',
          name: 'Salary',
          category: 'Income',
          value: 10_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
          end_condition: 'Date',
          end_date: `${CURRENT_YEAR}-12-31`,
        }),
        baseItem({
          id: 'exp',
          name: 'Living',
          category: 'Expense',
          value: 25_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
        baseItem({
          id: 'acc',
          name: 'Cash',
          category: 'Account',
          value: 100_000,
          account_settings: accountSettings({ type: 'Savings', withdrawal_priority: 1 }),
        }),
      ],
      milestones: [],
      settings: {},
    };

    const result = await sim({
      plan: partialPlan,
      finances: EMPTY_FINANCES,
      settings: USD_SETTINGS,
      dividendByAccount: { ibkr: 12_000, schwab: 8_000, ira: 5_000 },
    });

    const yr0 = result[0];

    // Full gross income lines
    expect(yr0.income_details).toContainEqual(expect.objectContaining({ name: 'Dividend - IBKR', value: 12_000 }));
    expect(yr0.income_details).toContainEqual(expect.objectContaining({ name: 'Dividend - Schwab', value: 8_000 }));
    expect(yr0.income_details).toContainEqual(expect.objectContaining({ name: 'Dividend - IRA', value: 5_000 }));

    const reinvest = yr0.savings_details.filter(d => d.type === 'reinvestment');
    expect(reinvest).toHaveLength(3);

    // Proportional: IBKR 12/25×10K=4800, Schwab 8/25×10K=3200, IRA 5/25×10K=2000
    const ibkrR = reinvest.find(d => d.name === 'Dividend Reinvest - IBKR');
    const schwabR = reinvest.find(d => d.name === 'Dividend Reinvest - Schwab');
    const iraR = reinvest.find(d => d.name === 'Dividend Reinvest - IRA');

    expect(ibkrR?.value).toBeCloseTo(4_800, 0);
    expect(schwabR?.value).toBeCloseTo(3_200, 0);
    expect(iraR?.value).toBeCloseTo(2_000, 0);

    const totalReinvest = reinvest.reduce((s, d) => s + (d.value ?? 0), 0);
    expect(totalReinvest).toBeCloseTo(10_000, 0);
  });

  // ── test 4: zero account — filtered out ───────────────────────────────────

  it('zero-dividend account is omitted from income and reinvestment lines', async () => {
    const result = await sim({
      plan: surplusPlan(),
      finances: EMPTY_FINANCES,
      settings: USD_SETTINGS,
      dividendByAccount: { ibkr: 12_000, schwab: 0, ira: 5_000 },
    });

    const yr0 = result[0];
    const divLines = yr0.income_details.filter(d => d.type === 'dividends' && d.name?.startsWith('Dividend - '));
    expect(divLines).toHaveLength(2);
    expect(divLines.some(d => d.name === 'Dividend - IBKR')).toBe(true);
    expect(divLines.some(d => d.name === 'Dividend - IRA')).toBe(true);
    expect(divLines.some(d => d.name === 'Dividend - Schwab')).toBe(false);

    const reinvest = yr0.savings_details.filter(d => d.type === 'reinvestment');
    expect(reinvest).toHaveLength(2);
    expect(reinvest.some(d => d.name === 'Dividend Reinvest - Schwab')).toBe(false);
  });

  // ── test 5: multi-currency — USD dividends converted to ILS ───────────────

  it('converts USD per-account dividends to mainCurrency (ILS) — values must differ from raw USD', async () => {
    const bigSurplusPlan: PlanData = {
      items: [
        baseItem({
          id: 'sal',
          name: 'Salary',
          category: 'Income',
          value: 1_000_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
      ],
      milestones: [],
      settings: {},
    };
    const ilsSettings = { primaryUser: { birthYear: 1990 }, mainCurrency: 'ILS' };

    const result = await sim({
      plan: bigSurplusPlan,
      finances: EMPTY_FINANCES,
      settings: ilsSettings,
      dividendByAccount: { ibkr: 12_000, schwab: 8_000, ira: 5_000 },
    });

    const yr0 = result[0];
    const ibkrLine = yr0.income_details.find(d => d.name === 'Dividend - IBKR');
    expect(ibkrLine).toBeDefined();
    // ILS/USD rate is ~3.7x; value must be converted (not the raw $12K USD)
    expect(ibkrLine!.value).not.toBe(12_000);
    expect(ibkrLine!.value).toBeGreaterThan(12_000); // ILS > USD
  });

  // ── test 6: backward compat — no dividendByAccount → single aggregate line ─

  it('backward compat: dividendTotal.annualTotal without dividendByAccount yields single "Dividend Income" line (green immediately)', async () => {
    const plan: PlanData = { items: [], milestones: [], settings: {} };

    const result = await runPlanSimulation({
      plan,
      finances: EMPTY_FINANCES,
      settings: USD_SETTINGS,
      dividendTotal: { annualTotal: 5_000 },
    });

    const yr0 = result[0];
    const divLines = yr0.income_details.filter(d => d.type === 'dividends');
    expect(divLines).toHaveLength(1);
    expect(divLines[0]).toMatchObject({ name: 'Dividend Income', value: 5_000 });

    // No reinvestment outflows from legacy aggregate path
    const reinvest = yr0.savings_details.filter(d => d.type === 'reinvestment');
    expect(reinvest).toHaveLength(0);
  });

  // ── test 7: mass conservation — account value grows by reinvested amount ──

  it('IBKR account.value grows by reinvested dividend each year (growth=0, fees=0)', async () => {
    const plan: PlanData = {
      items: [
        baseItem({
          id: 'sal',
          name: 'Salary',
          category: 'Income',
          value: 500_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
        baseItem({
          id: 'ibkr-acc',
          name: 'IBKR',
          category: 'Account',
          value: 100_000,
          growth_rate: 0,
          account_settings: accountSettings({ type: 'Broker', fees: 0, dividend_yield: 0 }),
          inflow_priority: 1,
        }),
      ],
      milestones: [],
      settings: {},
    };

    const result = await sim({
      plan,
      finances: EMPTY_FINANCES,
      settings: USD_SETTINGS,
      dividendByAccount: { ibkr: 12_000, schwab: 0, ira: 0 },
    });

    const ibkrAcc0 = result[0].accounts.find(a => a.name === 'IBKR');
    const ibkrAcc1 = result[1].accounts.find(a => a.name === 'IBKR');
    const ibkrAcc2 = result[2].accounts.find(a => a.name === 'IBKR');

    expect(ibkrAcc0?.value).toBeCloseTo(100_000, -2);
    expect(ibkrAcc1?.value).toBeCloseTo(112_000, -2); // +$12K reinvested
    expect(ibkrAcc2?.value).toBeCloseTo(124_000, -2); // +$12K again
  });

  // ── test 8: first year (current year) — dividends emitted in projection[0] ─

  it('emits per-account dividend lines in the very first projection year (year === currentYear)', async () => {
    const plan: PlanData = { items: [], milestones: [], settings: {} };

    const result = await sim({
      plan,
      finances: EMPTY_FINANCES,
      settings: USD_SETTINGS,
      dividendByAccount: { ibkr: 12_000, schwab: 8_000, ira: 5_000 },
    });

    expect(result[0].year).toBe(CURRENT_YEAR);
    const divLines = result[0].income_details.filter(d => d.type === 'dividends' && d.name?.startsWith('Dividend - '));
    expect(divLines).toHaveLength(3);
    expect(divLines).toContainEqual(expect.objectContaining({ name: 'Dividend - IBKR' }));
    expect(divLines).toContainEqual(expect.objectContaining({ name: 'Dividend - Schwab' }));
    expect(divLines).toContainEqual(expect.objectContaining({ name: 'Dividend - IRA' }));
  });

  // ── test 9: tax handling — dividends in taxable income, no extra tax line ──

  it('per-account dividends reflected in total_dividend_income; no separate "dividend tax" income_detail line', async () => {
    const plan: PlanData = { items: [], milestones: [], settings: {} };

    const result = await sim({
      plan,
      finances: EMPTY_FINANCES,
      settings: USD_SETTINGS,
      dividendByAccount: { ibkr: 1_000, schwab: 0, ira: 0 },
    });

    const yr0 = result[0];

    expect(yr0.total_dividend_income).toBeGreaterThanOrEqual(1_000);
    expect(yr0.income_details).toContainEqual(
      expect.objectContaining({ name: 'Dividend - IBKR', type: 'dividends', value: 1_000 }),
    );

    // No separate "tax" type income_detail injected by the new per-account path
    const taxLines = yr0.income_details.filter(d => d.type === 'tax');
    expect(taxLines).toHaveLength(0);
  });

  // ── test 10: three-account total equals input sum ─────────────────────────

  it('sum of per-account dividend income lines equals the total input (ibkr+schwab+ira)', async () => {
    const plan: PlanData = {
      items: [
        baseItem({
          id: 'sal',
          name: 'Salary',
          category: 'Income',
          value: 500_000,
          start_condition: 'Date',
          start_date: `${CURRENT_YEAR}-01-01`,
        }),
      ],
      milestones: [],
      settings: {},
    };
    const dividendByAccount: DividendByAccount = { ibkr: 12_000, schwab: 8_000, ira: 5_000 };
    const expectedTotal = dividendByAccount.ibkr + dividendByAccount.schwab + dividendByAccount.ira;

    const result = await sim({ plan, finances: EMPTY_FINANCES, settings: USD_SETTINGS, dividendByAccount });

    const divLineTotal = result[0].income_details
      .filter(d => d.type === 'dividends' && d.name?.startsWith('Dividend - '))
      .reduce((sum, d) => sum + (d.value ?? 0), 0);

    expect(divLineTotal).toBeCloseTo(expectedTotal, 0);
  });
});
