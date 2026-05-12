import Decimal from 'decimal.js';

import type { PlanData, PlanItem, PlanMilestone } from '@/components/Plan/types';
import type { FinanceSnapshot } from '../finances/actions';

export interface OptionsIncomeProjectionPoint {
  year: number;
  expectedIncome: number;
}

/**
 * Per-year bond ladder income point, as returned by getLadderIncome() → buildIncome().
 * Shape: { date: "YYYY-01-01", value: number }
 *
 * NOTE on currency: buildIncome() sums cashflows per year without FX conversion.
 * Amounts are in each bond's native currency (often USD, sometimes ILS/GBP).
 * For plan simulation we treat them as-is in the simulation's base currency.
 * Full multi-currency normalization is tracked as future work (#441).
 * Round 8 contract: values are already in major units — do NOT divide by 100.
 */
export interface BondIncomePoint {
  year: number;
  amount: number;
}

/**
 * Total forward annual dividend income, as returned by getDividendSummary().
 * Shape: { total_forward_annual: number; ... }
 *
 * getDividendSummary() already converts all positions to USD via convertCurrency(),
 * so total_forward_annual is a single USD amount. Treated as constant across all
 * future years (forward yield projection, not per-year decay).
 * Round 8 contract: value is in major units — do NOT divide by 100.
 */
export interface DividendIncomeTotal {
  annualTotal: number; // USD, forward annual, constant across all plan years
}

export interface PlanSimulationInput {
  plan: PlanData;
  finances?: FinanceSnapshot | { data?: { items?: unknown[] } } | null;
  settings?: Record<string, unknown>;
  /** Optional options-income projection from #428. When absent, plan runs as before. */
  optionsProjection?: OptionsIncomeProjectionPoint[];
  /**
   * Optional dividend income total from getDividendSummary() (#441).
   * Applied as a constant annual income across all simulation years.
   * When absent, dividend income from /summary is not reflected in the plan.
   */
  dividendTotal?: DividendIncomeTotal;
  /**
   * Optional bond ladder income series from getLadderIncome() → buildIncome() (#441).
   * Each entry is a per-year coupon + principal sum. Applied per year.
   * When absent, bond ladder income from /summary is not reflected in the plan.
   */
  bondProjection?: BondIncomePoint[];
}

export interface PlanSimulationDetail {
  name?: string;
  type?: string;
  value?: number;
  gross?: number;
  tax?: number;
}

export interface PlanSimulationAccountSnapshot {
  id?: string;
  owner: string;
  name: string;
  value: number;
  type: string;
  growth: number;
  yield: number;
  fees: number;
  priority: number;
  withdrawal_priority: number;
  inflow_priority: number;
  monthly_contribution: number;
  starting_age: number;
  draw_income: boolean;
  divide_rate: number;
  tax_rate: number;
  max_withdrawal_rate: number | null;
  max_withdrawal_cap: number | null;
  savings_goal: number | null;
  dividend_policy: string;
  dividend_mode: string;
  dividend_fixed_amount: number | null;
  dividend_growth_rate: number;
  dividend_tax_rate: number;
  dividend_payout_start_condition?: string;
  dividend_payout_start_reference?: string | number;
}

export interface PlanSimulationResultPoint {
  year: number;
  age: number;
  net_worth: number;
  liquid_assets: number;
  real_assets: number;
  debt: number;
  income: number;
  taxable_income: number;
  tax_paid: number;
  expenses: number;
  withdrawals: number;
  accounts: PlanSimulationAccountSnapshot[];
  income_details: PlanSimulationDetail[];
  expense_details: PlanSimulationDetail[];
  savings_details: PlanSimulationDetail[];
  withdrawal_details: PlanSimulationDetail[];
  milestones_hit: string[];
  liquid_net_worth: number;
  total_dividend_income: number;
}

export type PlanSimulationResult = PlanSimulationResultPoint[];

type PlanSimulationItem = PlanItem & {
  frequency?: string;
  details?: Record<string, unknown>;
  depreciation_rate?: number;
};

interface Account {
  id?: string;
  owner: string;
  name: string;
  value: Decimal;
  type: string;
  growth: Decimal;
  yield: Decimal;
  fees: Decimal;
  priority: number;
  withdrawal_priority: number;
  inflow_priority: number;
  monthly_contribution: Decimal;
  starting_age: number;
  draw_income: boolean;
  divide_rate: Decimal;
  tax_rate: Decimal;
  max_withdrawal_rate: Decimal | null;
  max_withdrawal_cap: Decimal | null;
  savings_goal: Decimal | null;
  dividend_policy: string;
  dividend_mode: string;
  dividend_fixed_amount: Decimal | null;
  dividend_growth_rate: Decimal;
  dividend_tax_rate: Decimal;
  dividend_payout_start_condition?: string;
  dividend_payout_start_reference?: string | number;
  current_fixed_dividend?: Decimal;
}

interface RealAsset {
  name: string;
  value: Decimal;
  growth: Decimal;
  depreciation: Decimal;
  loan_balance: Decimal;
}

interface Annuity {
  name: string;
  payout: Decimal;
  tax_rate: Decimal;
}

interface DividendPayout {
  name: string;
  type: 'Dividend Income';
  gross: Decimal;
  value?: Decimal;
  tax?: Decimal;
}

const RATES: Readonly<Record<string, Decimal>> = {
  ILS: new Decimal(1),
  USD: new Decimal(3),
  EUR: new Decimal(3.5),
};

function thisYear(): number {
  return new Date().getFullYear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const nested = value[key];
  return isRecord(nested) ? nested : {};
}

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  if (value instanceof Decimal) return value.toNumber();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function intValue(value: unknown, fallback = 0): number {
  return Math.trunc(numberValue(value, fallback));
}

function decimalValue(value: unknown, fallback = 0): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Decimal(value);
  if (typeof value === 'string' && value.trim()) {
    try {
      return new Decimal(value);
    } catch {
      return new Decimal(fallback);
    }
  }
  return new Decimal(fallback);
}

function boolValue(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function roundMoney(value: Decimal): number {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function convert(amount: Decimal, fromCurrency = 'ILS', toCurrency = 'ILS'): Decimal {
  if (amount.isZero()) return new Decimal(0);
  const fromRate = RATES[fromCurrency] ?? RATES.ILS;
  const toRate = RATES[toCurrency] ?? RATES.ILS;
  return amount.mul(fromRate).div(toRate);
}

function pow(base: Decimal, years: number): Decimal {
  return years === 0 ? new Decimal(1) : Decimal.pow(base, years);
}

function dateYear(value: unknown): number | null {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const year = Number(raw.slice(0, 4));
  if (Number.isInteger(year) && year > 0) return year;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.getFullYear();
}

function items(plan: PlanData): PlanSimulationItem[] {
  return (plan.items ?? []) as PlanSimulationItem[];
}

function accountSettings(item: PlanSimulationItem): Record<string, unknown> {
  return (item.account_settings as Record<string, unknown> | undefined) ?? record(item.details, 'account_settings');
}

function details(item: PlanSimulationItem): Record<string, unknown> {
  return isRecord(item.details) ? item.details : {};
}

function settingsRecord(settings: Record<string, unknown> | undefined): Record<string, unknown> {
  return settings ?? {};
}

function primaryBirthYear(settings: Record<string, unknown>): number {
  return intValue(record(settings, 'primaryUser').birthYear, 1980);
}

function spouseBirthYear(settings: Record<string, unknown>, fallback: number): number {
  return intValue(record(settings, 'spouse').birthYear, fallback);
}

function snapshotItems(finances: PlanSimulationInput['finances']): Record<string, unknown>[] {
  if (!finances || !isRecord(finances)) return [];
  const data = record(finances, 'data');
  const rawItems = Array.isArray(data.items) ? data.items : [];
  return rawItems.filter(isRecord);
}

function inferAccountType(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes('broker')) return 'Broker';
  if (lower.includes('401k')) return '401k';
  if (lower.includes('roth')) return 'Roth';
  if (lower.includes('ira')) return 'IRA';
  if (lower.includes('hishtalmut')) return 'Hishtalmut';
  if (lower.includes('espp')) return 'ESPP';
  if (lower.includes('rsu')) return 'RSU';
  if (lower.includes('hsa')) return 'HSA';
  if (lower.includes('pension')) return 'Pension';
  if (lower.includes('savings')) return 'Savings';
  return 'Taxable';
}

function findItemConfig(planItems: PlanSimulationItem[], name: string, category: string): PlanSimulationItem | undefined {
  return planItems.find(item => item.name === name && item.category === category);
}

function accountFrom(input: {
  id?: string;
  owner: string;
  name: string;
  value: Decimal;
  type: string;
  growth: Decimal;
  yieldRate: Decimal;
  fees: Decimal;
  withdrawalPriority: number;
  inflowPriority: number;
  monthlyContribution: Decimal;
  startingAge: number;
  drawIncome: boolean;
  divideRate: Decimal;
  taxRate: Decimal;
  maxWithdrawalRate: Decimal | null;
  maxWithdrawalCap: Decimal | null;
  savingsGoal: Decimal | null;
  dividendPolicy: string;
  dividendMode: string;
  dividendFixedAmount: Decimal | null;
  dividendGrowthRate: Decimal;
  dividendTaxRate: Decimal;
  dividendPayoutStartCondition?: string;
  dividendPayoutStartReference?: string | number;
}): Account {
  return {
    id: input.id,
    owner: input.owner,
    name: input.name,
    value: input.value,
    type: input.type,
    growth: input.growth,
    yield: input.yieldRate,
    fees: input.fees,
    priority: input.withdrawalPriority,
    withdrawal_priority: input.withdrawalPriority,
    inflow_priority: input.inflowPriority,
    monthly_contribution: input.monthlyContribution,
    starting_age: input.startingAge,
    draw_income: input.drawIncome,
    divide_rate: input.divideRate,
    tax_rate: input.taxRate,
    max_withdrawal_rate: input.maxWithdrawalRate,
    max_withdrawal_cap: input.maxWithdrawalCap,
    savings_goal: input.savingsGoal,
    dividend_policy: input.dividendPolicy,
    dividend_mode: input.dividendMode,
    dividend_fixed_amount: input.dividendFixedAmount,
    dividend_growth_rate: input.dividendGrowthRate,
    dividend_tax_rate: input.dividendTaxRate,
    dividend_payout_start_condition: input.dividendPayoutStartCondition,
    dividend_payout_start_reference: input.dividendPayoutStartReference,
  };
}

function loadAccounts(plan: PlanData, finances: PlanSimulationInput['finances'], settings: Record<string, unknown>): Account[] {
  const planItems = items(plan);
  const mainCurrency = stringValue(settings.mainCurrency, 'ILS');
  const accounts: Account[] = [];

  for (const financeItem of snapshotItems(finances)) {
    const category = stringValue(financeItem.category);
    const name = stringValue(financeItem.name);
    if (!['Savings', 'Investments', 'Cash', 'Checking', 'Bank', 'Liquid'].includes(category)) continue;

    const itemCurrency = stringValue(financeItem.currency, 'ILS');
    const config = findItemConfig(planItems, name, 'Account');
    const fDetails = record(financeItem, 'details');
    const planSettings = config ? accountSettings(config) : {};
    const snapshotSettings: Record<string, unknown> = { type: inferAccountType(stringValue(financeItem.type)) };

    for (const key of ['draw_income', 'divide_rate', 'starting_age', 'monthly_contribution', 'max_withdrawal_rate', 'max_withdrawal_cap', 'dividend_policy', 'dividend_mode', 'dividend_fixed_amount', 'dividend_growth_rate', 'dividend_tax_rate', 'dividend_payout_start_condition', 'dividend_payout_start_reference']) {
      if (Object.prototype.hasOwnProperty.call(fDetails, key)) snapshotSettings[key] = fDetails[key];
    }
    snapshotSettings.withdrawal_priority = financeItem.withdrawal_priority ?? fDetails.withdrawal_priority;
    snapshotSettings.inflow_priority = financeItem.inflow_priority ?? fDetails.inflow_priority;

    const merged = { ...planSettings, ...snapshotSettings };
    const currency = stringValue(config?.currency, itemCurrency);
    accounts.push(accountFrom({
      id: typeof financeItem.id === 'string' ? financeItem.id : undefined,
      owner: stringValue(financeItem.owner, 'You'),
      name,
      value: convert(decimalValue(financeItem.value), currency, mainCurrency),
      type: stringValue(merged.type, 'Taxable'),
      growth: decimalValue(merged.growth_rate ?? config?.growth_rate, 5),
      yieldRate: decimalValue(merged.dividend_yield, 0),
      fees: decimalValue(merged.fees, 0),
      withdrawalPriority: intValue(snapshotSettings.withdrawal_priority, 50),
      inflowPriority: intValue(snapshotSettings.inflow_priority, 100),
      monthlyContribution: decimalValue(merged.monthly_contribution, 0),
      startingAge: intValue(merged.starting_age, 67),
      drawIncome: boolValue(merged.draw_income, false),
      divideRate: decimalValue(merged.divide_rate, 200),
      taxRate: decimalValue(merged.tax_rate, 0),
      maxWithdrawalRate: merged.max_withdrawal_rate == null ? null : decimalValue(merged.max_withdrawal_rate, 0),
      maxWithdrawalCap: merged.max_withdrawal_cap == null ? null : convert(decimalValue(merged.max_withdrawal_cap), currency, mainCurrency),
      savingsGoal: merged.savings_goal == null ? null : convert(decimalValue(merged.savings_goal), currency, mainCurrency),
      dividendPolicy: stringValue(merged.dividend_policy, 'Accumulate'),
      dividendMode: stringValue(merged.dividend_mode, 'Percent'),
      dividendFixedAmount: merged.dividend_fixed_amount == null ? null : convert(decimalValue(merged.dividend_fixed_amount), currency, mainCurrency),
      dividendGrowthRate: decimalValue(merged.dividend_growth_rate, 0),
      dividendTaxRate: decimalValue(merged.dividend_tax_rate, 0),
      dividendPayoutStartCondition: merged.dividend_payout_start_condition == null ? undefined : stringValue(merged.dividend_payout_start_condition),
      dividendPayoutStartReference: typeof merged.dividend_payout_start_reference === 'string' || typeof merged.dividend_payout_start_reference === 'number' ? merged.dividend_payout_start_reference : undefined,
    }));
  }

  for (const item of planItems) {
    if (item.category !== 'Account' || accounts.some(account => account.name === item.name)) continue;
    const accSettings = accountSettings(item);
    const currency = item.currency ?? 'ILS';
    accounts.push(accountFrom({
      id: item.id,
      owner: item.owner ?? 'You',
      name: item.name,
      value: convert(decimalValue(item.value), currency, mainCurrency),
      type: stringValue(accSettings.type, 'Taxable'),
      growth: decimalValue(item.growth_rate, 5),
      yieldRate: decimalValue(accSettings.dividend_yield, 0),
      fees: decimalValue(accSettings.fees, 0),
      withdrawalPriority: intValue(item.withdrawal_priority ?? accSettings.withdrawal_priority, 50),
      inflowPriority: intValue(item.inflow_priority ?? accSettings.inflow_priority, 100),
      monthlyContribution: decimalValue(accSettings.monthly_contribution, 0),
      startingAge: intValue(accSettings.starting_age, 67),
      drawIncome: boolValue(accSettings.draw_income, false),
      divideRate: decimalValue(accSettings.divide_rate, 200),
      taxRate: decimalValue(accSettings.tax_rate, 0),
      maxWithdrawalRate: accSettings.max_withdrawal_rate == null ? null : decimalValue(accSettings.max_withdrawal_rate, 0),
      maxWithdrawalCap: accSettings.max_withdrawal_cap == null ? null : convert(decimalValue(accSettings.max_withdrawal_cap), currency, mainCurrency),
      savingsGoal: accSettings.savings_goal == null ? null : convert(decimalValue(accSettings.savings_goal), currency, mainCurrency),
      dividendPolicy: stringValue(accSettings.dividend_policy, 'Accumulate'),
      dividendMode: stringValue(accSettings.dividend_mode, 'Percent'),
      dividendFixedAmount: accSettings.dividend_fixed_amount == null ? null : convert(decimalValue(accSettings.dividend_fixed_amount), currency, mainCurrency),
      dividendGrowthRate: decimalValue(accSettings.dividend_growth_rate, 0),
      dividendTaxRate: decimalValue(accSettings.dividend_tax_rate, 0),
      dividendPayoutStartCondition: accSettings.dividend_payout_start_condition == null ? undefined : stringValue(accSettings.dividend_payout_start_condition),
      dividendPayoutStartReference: typeof accSettings.dividend_payout_start_reference === 'string' || typeof accSettings.dividend_payout_start_reference === 'number' ? accSettings.dividend_payout_start_reference : undefined,
    }));
  }

  return accounts;
}

class Milestones {
  readonly resolved = new Map<string, number>();
  private readonly currentYear = thisYear();

  constructor(
    private readonly milestones: PlanMilestone[],
    private readonly birthYear: number,
    private readonly settings: Record<string, unknown>,
    private readonly accounts: Account[],
  ) {
    this.resolveStatic();
  }

  private resolveStatic(): void {
    for (const milestone of this.milestones) {
      if (milestone.type === 'Custom' || milestone.type === 'Retirement') {
        const parsedYear = dateYear(milestone.date);
        if (parsedYear !== null) this.resolved.set(milestone.id, parsedYear);
        else if (milestone.year_offset !== undefined) this.resolved.set(milestone.id, this.currentYear + intValue(milestone.year_offset));
        else if (milestone.details?.age !== undefined) {
          const by = milestone.owner === 'Spouse' ? spouseBirthYear(this.settings, this.birthYear) : this.birthYear;
          this.resolved.set(milestone.id, by + intValue(milestone.details.age));
        } else this.resolved.set(milestone.id, this.currentYear);
      } else if (milestone.type === 'Life Expectancy') {
        const by = milestone.owner === 'Spouse' ? spouseBirthYear(this.settings, this.birthYear) : this.birthYear;
        this.resolved.set(milestone.id, by + intValue(milestone.details?.age, 95));
      }
    }

    for (const account of this.accounts) {
      if (account.type === 'Pension' && account.id) {
        const by = account.owner === 'Spouse' ? spouseBirthYear(this.settings, this.birthYear) : this.birthYear;
        this.resolved.set(`pension_ms_${account.id}`, by + account.starting_age);
      }
    }
  }

  yearFromCondition(item: PlanSimulationItem, conditionField: 'start_condition' | 'end_condition', refField: 'start_reference' | 'end_reference', dateField: 'start_date' | 'end_date'): number {
    const condition = item[conditionField];
    const reference = item[refField];
    if (condition === 'Date' && item[dateField]) return dateYear(item[dateField]) ?? this.currentYear;
    if (condition === 'Age' && reference) return this.birthYear + intValue(reference);
    if (condition === 'Milestone' && reference) {
      const ref = String(reference);
      const year = this.resolved.get(ref);
      if (year !== undefined) return year;
      if (ref.startsWith('pension_ms_')) {
        const pension = this.accounts.find(account => account.type === 'Pension');
        if (pension) {
          const by = pension.owner === 'Spouse' ? spouseBirthYear(this.settings, this.birthYear) : this.birthYear;
          return by + pension.starting_age;
        }
      }
      return conditionField === 'end_condition' ? this.currentYear : 9999;
    }
    return conditionField === 'end_condition' ? this.currentYear + 100 : this.currentYear;
  }

  checkDynamic(year: number, liquidNetWorth: Decimal, annualExpenses: Decimal): void {
    const fi = this.milestones.find(milestone => milestone.type === 'Financial Independence');
    if (!fi || this.resolved.has(fi.id)) return;
    if (liquidNetWorth.gt(decimalValue(fi.details?.expense_multiplier, 25).mul(annualExpenses))) this.resolved.set(fi.id, year);
  }

  hits(year: number): string[] {
    return [...this.resolved.entries()].filter(([, hitYear]) => hitYear === year).map(([id]) => id);
  }
}

class Accounts {
  readonly activeAnnuities: Annuity[] = [];
  private readonly currentYear = thisYear();

  constructor(readonly accounts: Account[], private readonly settings: Record<string, unknown>, private readonly birthYear: number) {}

  currentDividendPayouts(): DividendPayout[] {
    return this.accounts.flatMap(account => {
      const gross = account.dividend_mode === 'Fixed' && account.dividend_fixed_amount
        ? account.dividend_fixed_amount
        : account.value.mul(account.yield.div(100));
      return gross.gt(0) ? [{ name: `Dividend: ${account.name}`, type: 'Dividend Income' as const, gross }] : [];
    });
  }

  processGrowthAndIncome(year: number, unallocatedCash: Decimal, resolved: Map<string, number>): { unallocatedCash: Decimal; dividends: DividendPayout[] } {
    let cash = unallocatedCash;
    const dividends: DividendPayout[] = [];
    const age = year - this.birthYear;

    for (const account of this.accounts) {
      if (account.type === 'Pension' && account.draw_income && account.value.gt(0)) {
        const effectiveAge = account.owner === 'Spouse' ? year - spouseBirthYear(this.settings, this.birthYear) : age;
        if (effectiveAge >= account.starting_age && account.divide_rate.gt(0)) {
          this.activeAnnuities.push({ name: account.name, payout: account.value.div(account.divide_rate).mul(12), tax_rate: account.tax_rate });
          account.value = new Decimal(0);
          continue;
        }
      }

      if (account.monthly_contribution.gt(0)) {
        const checkAge = account.owner === 'Spouse' ? year - spouseBirthYear(this.settings, this.birthYear) : age;
        if (!(account.type === 'Pension' && checkAge >= account.starting_age)) {
          const annualContribution = account.monthly_contribution.mul(12);
          account.value = account.value.plus(annualContribution);
          cash = cash.minus(annualContribution);
        }
      }

      const gross = this.grossDividend(account);
      const net = gross.mul(new Decimal(1).minus(account.dividend_tax_rate.div(100)));
      account.value = account.value.plus(account.value.mul(account.growth.div(100))).minus(account.value.mul(account.fees.div(100)));

      let policy = account.dividend_policy;
      const start = account.dividend_payout_start_condition;
      if (policy === 'Payout' && start && start !== 'Immediate') {
        let triggerYear = this.currentYear;
        const ref = account.dividend_payout_start_reference;
        if (start === 'Age') triggerYear = this.birthYear + intValue(ref, 67);
        if (start === 'Date') triggerYear = intValue(ref, this.currentYear);
        if (start === 'Milestone') triggerYear = resolved.get(String(ref)) ?? 9999;
        if (year < triggerYear) policy = 'Accumulate';
      }

      if (policy === 'Payout') {
        if (account.value.gt(0)) dividends.push({ name: `Dividend: ${account.name}`, type: 'Dividend Income', value: net, gross, tax: gross.minus(net) });
      } else {
        account.value = account.value.plus(net);
      }
    }

    return { unallocatedCash: cash.mul(1.02), dividends };
  }

  private grossDividend(account: Account): Decimal {
    if (account.dividend_mode === 'Fixed' && account.dividend_fixed_amount) {
      if (!account.current_fixed_dividend) account.current_fixed_dividend = account.dividend_fixed_amount;
      else account.current_fixed_dividend = account.current_fixed_dividend.mul(new Decimal(1).plus(account.dividend_growth_rate.div(100)));
      return account.current_fixed_dividend;
    }
    return account.value.mul(account.yield.div(100));
  }

  processSavings(netFlow: Decimal, unallocatedCash: Decimal): { unallocatedCash: Decimal; details: PlanSimulationDetail[] } {
    const savings: PlanSimulationDetail[] = [];
    if (netFlow.lte(0)) return { unallocatedCash, details: savings };
    let remaining = netFlow;

    for (const account of [...this.accounts].sort((a, b) => a.inflow_priority - b.inflow_priority)) {
      if (remaining.lte(0)) break;
      if (account.type === 'Pension' && account.draw_income) continue;
      let amount = remaining;
      if (account.savings_goal && account.savings_goal.gt(0)) {
        if (account.value.gte(account.savings_goal)) continue;
        amount = Decimal.min(amount, account.savings_goal.minus(account.value));
      }
      if (amount.gt(0)) {
        account.value = account.value.plus(amount);
        remaining = remaining.minus(amount);
        savings.push({ name: account.name, value: roundMoney(amount), type: account.name.toLowerCase().includes('savings') ? 'Cash' : 'Investment' });
      }
    }

    let cash = unallocatedCash;
    if (remaining.gt(0)) {
      cash = cash.plus(remaining);
      savings.push({ name: 'Unallocated Cash', value: roundMoney(remaining), type: 'Cash' });
    }
    return { unallocatedCash: cash, details: savings };
  }

  processDeficit(deficit: Decimal, unallocatedCash: Decimal): { unallocatedCash: Decimal; withdrawals: Decimal; details: PlanSimulationDetail[] } {
    const withdrawals = deficit;
    const details: PlanSimulationDetail[] = [];
    let remaining = deficit;
    let cash = unallocatedCash;

    if (cash.gte(remaining)) {
      details.push({ name: 'Withdrawal: Unallocated Cash', type: 'Portfolio Withdrawal', value: roundMoney(remaining) });
      return { unallocatedCash: cash.minus(remaining), withdrawals, details };
    }

    if (cash.gt(0)) {
      details.push({ name: 'Withdrawal: Unallocated Cash', type: 'Portfolio Withdrawal', value: roundMoney(cash) });
      remaining = remaining.minus(cash);
      cash = new Decimal(0);
    }

    let rsuWithdrawn = new Decimal(0);
    const rsuLimit = new Decimal(200000);
    for (const account of [...this.accounts].sort((a, b) => a.withdrawal_priority - b.withdrawal_priority)) {
      if (remaining.lte(0)) break;
      if (account.value.lte(0)) continue;
      let allowed = account.value;
      if (account.max_withdrawal_cap) allowed = Decimal.min(allowed, account.max_withdrawal_cap);
      if (account.max_withdrawal_rate) allowed = Decimal.min(allowed, account.value.mul(account.max_withdrawal_rate.div(100)));
      if (account.type.trim() === 'RSU') allowed = Decimal.min(allowed, Decimal.max(0, rsuLimit.minus(rsuWithdrawn)));
      const amount = Decimal.min(remaining, allowed);
      if (amount.gt(0)) {
        account.value = account.value.minus(amount);
        remaining = remaining.minus(amount);
        if (account.type.trim() === 'RSU') rsuWithdrawn = rsuWithdrawn.plus(amount);
        details.push({ name: `Withdrawal: ${account.name}`, type: 'Portfolio Withdrawal', value: roundMoney(amount) });
      }
    }

    if (remaining.gt(0)) cash = cash.minus(remaining);
    return { unallocatedCash: cash, withdrawals, details };
  }

  liquidValue(): Decimal {
    return this.accounts.reduce((sum, account) => {
      const type = account.type.toLowerCase();
      const name = account.name.toLowerCase();
      return type.includes('pension') || name.includes('pension') ? sum : sum.plus(account.value);
    }, new Decimal(0));
  }
}

class RealAssets {
  constructor(readonly assets: RealAsset[]) {}

  processGrowth(): void {
    for (const asset of this.assets) asset.value = asset.value.mul(new Decimal(1).plus(asset.growth.minus(asset.depreciation).div(100)));
  }

  add(item: PlanSimulationItem, cost: Decimal): void {
    this.assets.push({ name: item.name, value: cost, growth: decimalValue(item.growth_rate, 0), depreciation: decimalValue(item.depreciation_rate, 0), loan_balance: new Decimal(0) });
  }

  liquidValue(planItems: PlanSimulationItem[]): { liquid: Decimal; debt: Decimal } {
    return this.assets.reduce((total, asset) => {
      const item = planItems.find(candidate => candidate.name === asset.name && candidate.category === 'Asset');
      if (!item) return total;
      const sub = (item.sub_category ?? '').toLowerCase();
      const name = asset.name.toLowerCase();
      return sub === 'house' || name.includes('house') || name.includes('home')
        ? total
        : { liquid: total.liquid.plus(asset.value), debt: total.debt.plus(asset.loan_balance) };
    }, { liquid: new Decimal(0), debt: new Decimal(0) });
  }
}

function loadRealAssets(plan: PlanData, finances: PlanSimulationInput['finances'], settings: Record<string, unknown>): { assets: RealAsset[]; cashDiff: Decimal } {
  const planItems = items(plan);
  const mainCurrency = stringValue(settings.mainCurrency, 'ILS');
  const assets: RealAsset[] = [];
  let cashDiff = new Decimal(0);

  for (const financeItem of snapshotItems(finances)) {
    const category = stringValue(financeItem.category);
    const itemCurrency = stringValue(financeItem.currency, 'ILS');
    const name = stringValue(financeItem.name);
    if (category === 'Real Estate' || category === 'Vehicle') {
      const config = findItemConfig(planItems, name, 'Asset');
      const currency = stringValue(config?.currency, itemCurrency);
      assets.push({ name, value: convert(decimalValue(financeItem.value), currency, mainCurrency), growth: decimalValue(config?.growth_rate, 0), depreciation: decimalValue(config?.depreciation_rate, 0), loan_balance: new Decimal(0) });
    } else if (category === 'Debt' || category === 'Liability') {
      cashDiff = cashDiff.minus(convert(decimalValue(financeItem.value), itemCurrency, mainCurrency));
    }
  }
  return { assets, cashDiff };
}

function multiplier(frequency?: string): Decimal {
  if (frequency === 'Monthly') return new Decimal(12);
  if (frequency === 'Weekly') return new Decimal(52);
  if (frequency === 'Bi-Weekly') return new Decimal(26);
  if (frequency === 'Daily') return new Decimal(365);
  return new Decimal(1);
}

function snapshot(account: Account): PlanSimulationAccountSnapshot {
  return {
    id: account.id,
    owner: account.owner,
    name: account.name,
    value: account.value.toNumber(),
    type: account.type,
    growth: account.growth.toNumber(),
    yield: account.yield.toNumber(),
    fees: account.fees.toNumber(),
    priority: account.priority,
    withdrawal_priority: account.withdrawal_priority,
    inflow_priority: account.inflow_priority,
    monthly_contribution: account.monthly_contribution.toNumber(),
    starting_age: account.starting_age,
    draw_income: account.draw_income,
    divide_rate: account.divide_rate.toNumber(),
    tax_rate: account.tax_rate.toNumber(),
    max_withdrawal_rate: account.max_withdrawal_rate?.toNumber() ?? null,
    max_withdrawal_cap: account.max_withdrawal_cap?.toNumber() ?? null,
    savings_goal: account.savings_goal?.toNumber() ?? null,
    dividend_policy: account.dividend_policy,
    dividend_mode: account.dividend_mode,
    dividend_fixed_amount: account.dividend_fixed_amount?.toNumber() ?? null,
    dividend_growth_rate: account.dividend_growth_rate.toNumber(),
    dividend_tax_rate: account.dividend_tax_rate.toNumber(),
    dividend_payout_start_condition: account.dividend_payout_start_condition,
    dividend_payout_start_reference: account.dividend_payout_start_reference,
  };
}

/**
 * Runs the TJ-020 in-process plan projection previously served by the legacy
 * FastAPI plan-simulation route. All monetary arithmetic is Decimal-based and
 * the returned fields match the legacy response shape consumed by the UI.
 */
export function calculatePlanSimulation(planInput: PlanSimulationInput): PlanSimulationResult {
  const plan = planInput.plan ?? { items: [], milestones: [], settings: {} };
  const settings = settingsRecord(planInput.settings);
  const currentYear = thisYear();
  const birthYear = primaryBirthYear(settings);
  const endYear = birthYear + 95;
  const planItems = items(plan);
  const accounts = loadAccounts(plan, planInput.finances ?? null, settings);
  const loadedAssets = loadRealAssets(plan, planInput.finances ?? null, settings);
  const accountManager = new Accounts(accounts, settings, birthYear);
  const realAssetManager = new RealAssets(loadedAssets.assets);
  const milestoneManager = new Milestones(plan.milestones ?? [], birthYear, settings, accounts);
  let unallocatedCash = loadedAssets.cashDiff;
  const projection: PlanSimulationResult = [];

  const optionsMap = new Map<number, number>(
    (planInput.optionsProjection ?? []).map(p => [p.year, p.expectedIncome]),
  );

  // --- Virtual income maps: dividends + bonds (#441) ---
  // Dividend income: constant annual total in USD across all years.
  // Source: getDividendSummary().total_forward_annual (already FX-converted to USD).
  const dividendAnnualTotal = planInput.dividendTotal?.annualTotal ?? 0;

  // Bond ladder income: per-year coupon + principal from getLadderIncome() → buildIncome().
  // Source: income_series[].{ date: "YYYY-01-01", value: number }.
  // Currency note: amounts may be in mixed bond currencies (see BondIncomePoint JSDoc).
  // TODO: McManus to cover virtual-income merge in simulation unit tests.
  const bondMap = new Map<number, number>(
    (planInput.bondProjection ?? []).map(p => [p.year, p.amount]),
  );

  for (let year = currentYear; year <= endYear; year += 1) {
    const age = year - birthYear;
    milestoneManager.checkDynamic(year, accountManager.liquidValue().plus(unallocatedCash), new Decimal(0));
    let dividends: DividendPayout[] = [];

    if (year > currentYear) {
      const growth = accountManager.processGrowthAndIncome(year, unallocatedCash, milestoneManager.resolved);
      unallocatedCash = growth.unallocatedCash;
      dividends = growth.dividends;
      realAssetManager.processGrowth();
    } else {
      dividends = accountManager.currentDividendPayouts();
    }

    let grossIncome = new Decimal(0);
    let taxableIncome = new Decimal(0);
    let taxPaid = new Decimal(0);
    let expenses = new Decimal(0);
    const incomeDetails: PlanSimulationDetail[] = [];
    const expenseDetails: PlanSimulationDetail[] = [];

    for (const item of planItems) {
      if (!['Income', 'Expense', 'Asset'].includes(item.category)) continue;
      const start = milestoneManager.yearFromCondition(item, 'start_condition', 'start_reference', 'start_date');
      const end = milestoneManager.yearFromCondition(item, 'end_condition', 'end_reference', 'end_date');
      if (year < start || year > end) continue;

      const baseRaw = decimalValue(item.value);
      const base = convert(baseRaw, item.currency ?? 'ILS', stringValue(settings.mainCurrency, 'ILS')).mul(multiplier(item.frequency));
      const yearsPassed = year - currentYear;

      if (item.category === 'Asset') {
        let purchase = year === start;
        if (item.recurrence?.rule === 'Replace') {
          const period = intValue(item.recurrence.period_years, 10);
          if (period > 0 && year > start && (year - start) % period === 0) purchase = true;
        }
        if (!purchase) continue;
        const cost = base.mul(pow(new Decimal(1.03), yearsPassed));
        const financing = record(details(item), 'financing');
        if (Object.keys(financing).length > 0) {
          const down = baseRaw.isZero() ? new Decimal(0) : cost.mul(decimalValue(financing.down_payment).div(baseRaw));
          expenses = expenses.plus(down);
          expenseDetails.push({ name: `Down Payment: ${item.name}`, value: roundMoney(down), type: 'Asset Purchase' });
        } else {
          expenses = expenses.plus(cost);
          expenseDetails.push({ name: `Purchase: ${item.name}`, value: roundMoney(cost), type: 'Asset Purchase' });
        }
        realAssetManager.add(item, cost);
      } else {
        const currentValue = base.mul(pow(new Decimal(1).plus(decimalValue(item.growth_rate).div(100)), yearsPassed));
        if (item.category === 'Income') {
          grossIncome = grossIncome.plus(currentValue);
          const tax = currentValue.mul(decimalValue(item.tax_rate).div(100));
          taxPaid = taxPaid.plus(tax);
          taxableIncome = taxableIncome.plus(currentValue);
          incomeDetails.push({ name: item.name, type: item.sub_category ?? 'Earned Income', value: roundMoney(currentValue) });
        } else {
          expenses = expenses.plus(currentValue);
          expenseDetails.push({ name: item.name, type: item.sub_category ?? 'General', value: roundMoney(currentValue) });
        }
      }
    }

    for (const dividend of dividends) {
      grossIncome = grossIncome.plus(dividend.gross);
      taxPaid = taxPaid.plus(dividend.tax ?? 0);
      taxableIncome = taxableIncome.plus(dividend.gross);
      incomeDetails.push({ name: dividend.name, type: dividend.type, gross: roundMoney(dividend.gross), tax: dividend.tax ? roundMoney(dividend.tax) : undefined, value: roundMoney(dividend.gross) });
    }

    for (const annuity of accountManager.activeAnnuities) {
      grossIncome = grossIncome.plus(annuity.payout);
      taxPaid = taxPaid.plus(annuity.payout.mul(annuity.tax_rate.div(100)));
      taxableIncome = taxableIncome.plus(annuity.payout);
      incomeDetails.push({ name: `Pension: ${annuity.name}`, type: 'Pension Income', value: roundMoney(annuity.payout) });
    }

    const optionsIncome = new Decimal(optionsMap.get(year) ?? 0);
    if (optionsIncome.gt(0)) {
      grossIncome = grossIncome.plus(optionsIncome);
      taxableIncome = taxableIncome.plus(optionsIncome);
      incomeDetails.push({ name: 'Options Income', type: 'options', value: roundMoney(optionsIncome) });
    }

    // Virtual dividend income — forward annual total, constant every year (#441)
    const dividendIncome = new Decimal(dividendAnnualTotal);
    if (dividendIncome.gt(0)) {
      grossIncome = grossIncome.plus(dividendIncome);
      taxableIncome = taxableIncome.plus(dividendIncome);
      incomeDetails.push({ name: 'Dividend Income', type: 'dividends', value: roundMoney(dividendIncome) });
    }

    // Virtual bond ladder income — per-year coupon + principal amounts (#441)
    const bondIncome = new Decimal(bondMap.get(year) ?? 0);
    if (bondIncome.gt(0)) {
      grossIncome = grossIncome.plus(bondIncome);
      taxableIncome = taxableIncome.plus(bondIncome);
      incomeDetails.push({ name: 'Bond Ladder Income', type: 'bonds', value: roundMoney(bondIncome) });
    }

    const netFlow = grossIncome.minus(taxPaid).minus(expenses);
    let savingsDetails: PlanSimulationDetail[] = [];
    let withdrawals = new Decimal(0);
    let withdrawalDetails: PlanSimulationDetail[] = [];
    if (netFlow.gt(0)) {
      const saved = accountManager.processSavings(netFlow, unallocatedCash);
      unallocatedCash = saved.unallocatedCash;
      savingsDetails = saved.details;
    } else {
      const withdrawn = accountManager.processDeficit(netFlow.abs(), unallocatedCash);
      unallocatedCash = withdrawn.unallocatedCash;
      withdrawals = withdrawn.withdrawals;
      withdrawalDetails = withdrawn.details;
    }

    const liquidAssets = realAssetManager.liquidValue(planItems);
    const liquidNetWorth = liquidAssets.liquid.plus(accountManager.liquidValue()).plus(unallocatedCash);
    const totalRealAssets = realAssetManager.assets.reduce((sum, asset) => sum.plus(asset.value), new Decimal(0));
    const totalAccounts = accountManager.accounts.reduce((sum, account) => sum.plus(account.value), new Decimal(0));
    const netWorth = totalAccounts.plus(unallocatedCash).plus(totalRealAssets).minus(liquidAssets.debt);
    const totalDividendIncome = dividends.reduce((sum, dividend) => sum.plus(dividend.gross), new Decimal(0));

    projection.push({
      year,
      age,
      net_worth: roundMoney(netWorth),
      liquid_net_worth: roundMoney(liquidNetWorth),
      liquid_assets: roundMoney(liquidNetWorth),
      real_assets: roundMoney(totalRealAssets),
      debt: 0,
      income: roundMoney(grossIncome),
      taxable_income: roundMoney(taxableIncome),
      tax_paid: roundMoney(taxPaid),
      expenses: roundMoney(expenses),
      withdrawals: roundMoney(withdrawals),
      accounts: accountManager.accounts.map(snapshot),
      withdrawal_details: withdrawalDetails,
      income_details: incomeDetails,
      expense_details: expenseDetails,
      savings_details: savingsDetails,
      milestones_hit: milestoneManager.hits(year),
      total_dividend_income: roundMoney(totalDividendIncome),
    });
  }

  return projection;
}
