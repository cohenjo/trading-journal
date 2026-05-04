'use server';

import Decimal from 'decimal.js';
import { createClient } from '@/lib/supabase/server';
import type {
  MonthlyMetric,
  OptionsEnabledAccount,
  OptionsFreshness,
  OptionsMarginSource,
  OptionsTradeSummary,
  RollEvent,
  StrategyGroup,
} from '@/types/options';

interface HouseholdResult {
  householdId: string | null;
}

type NumericLike = string | number | null | undefined;

function decimalString(value: NumericLike): string {
  if (value === null || value === undefined || value === '') return '0';
  return String(value);
}

function nullableDecimalString(value: NumericLike): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isoDate(value: unknown): string {
  return text(value).slice(0, 10);
}

function toInt(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function marginSource(value: unknown): OptionsMarginSource | null {
  return value === 'ib_gateway' || value === 'flex' || value === 'synthetic' ? value : null;
}

function isOlderThanOneHour(value: string | null): boolean {
  if (!value) return false;
  const ageMs = new Decimal(Date.now()).minus(new Date(value).getTime());
  return ageMs.gt(new Decimal(60 * 60 * 1000));
}

/** Resolves household scope from the authenticated session; never from caller input. */
async function getAuthenticatedHousehold(): Promise<HouseholdResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { householdId: null };

  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return { householdId: null };
  return { householdId: text((data as { household_id?: unknown }).household_id) || null };
}

function applyAccountFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  accountId?: string,
): T {
  const normalized = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
  return normalized ? query.eq('account_id', normalized) : query;
}

function normalizeTrade(row: Record<string, unknown> | null | undefined): OptionsTradeSummary | null {
  if (!row) return null;
  const leg = row.options_legs as Record<string, unknown> | null | undefined;
  return {
    id: text(row.id),
    accountId: text(row.account_id),
    strategyGroupId: row.strategy_group_id === null ? null : text(row.strategy_group_id),
    eventType: text(row.event_type),
    side: text(row.side),
    tradeTime: text(row.trade_time),
    tradeDate: isoDate(row.trade_date),
    quantity: decimalString(row.quantity as NumericLike),
    price: decimalString(row.price as NumericLike),
    grossAmount: decimalString(row.gross_amount as NumericLike),
    commission: decimalString(row.commission as NumericLike),
    fees: decimalString(row.fees as NumericLike),
    netCashFlow: decimalString(row.net_cash_flow as NumericLike),
    realizedPnl: decimalString(row.realized_pnl as NumericLike),
    currency: text(row.currency, 'USD'),
    underlyingSymbol: leg ? text(leg.underlying_symbol) : undefined,
    expiry: leg ? isoDate(leg.expiry) : undefined,
    strike: leg ? decimalString(leg.strike as NumericLike) : undefined,
    right: leg && (leg.right === 'call' || leg.right === 'put') ? leg.right : undefined,
  };
}

function normalizeRollEvent(row: Record<string, unknown>): RollEvent {
  return {
    id: text(row.id),
    accountId: text(row.account_id),
    strategyGroupId: text(row.strategy_group_id),
    detectedAt: text(row.detected_at),
    detectionStatus: text(row.detection_status),
    classification: row.classification === 'positive' || row.classification === 'neutral' ? row.classification : 'negative',
    closedLegRealizedPnl: decimalString(row.closed_leg_realized_pnl as NumericLike),
    incrementalCashFlow: decimalString(row.incremental_cash_flow as NumericLike),
    oldExpiry: row.old_expiry === null ? null : isoDate(row.old_expiry),
    newExpiry: row.new_expiry === null ? null : isoDate(row.new_expiry),
    oldStrike: nullableDecimalString(row.old_strike as NumericLike),
    newStrike: nullableDecimalString(row.new_strike as NumericLike),
    heuristicVersion: text(row.heuristic_version),
    closedTrade: normalizeTrade(row.closed_trade as Record<string, unknown> | null | undefined),
    openedTrade: normalizeTrade(row.opened_trade as Record<string, unknown> | null | undefined),
  };
}

/** Reads cooked monthly options metrics for the selected year and account. */
export async function getOptionsMonthlyMetrics(year?: number, accountId?: string): Promise<MonthlyMetric[]> {
  const targetYear = Number.isInteger(year) ? Number(year) : new Date().getFullYear();
  const { householdId } = await getAuthenticatedHousehold();
  if (!householdId) return [];

  const supabase = await createClient();
  let query = supabase
    .from('options_dashboard_monthly')
    .select([
      'account_id',
      'period_start',
      'period_end',
      'cash_flow_total',
      'realized_pnl_total',
      'cash_flow_cumulative',
      'realized_pnl_cumulative',
      'variance_gap',
      'variance_gap_cumulative',
      'trade_count',
      'roll_count',
      'roll_positive_count',
      'roll_negative_count',
      'roll_neutral_count',
      'roll_efficiency_pct',
      'last_computed_at',
    ].join(', '))
    .eq('household_id', householdId)
    .gte('period_start', `${targetYear}-01-01`)
    .lte('period_start', `${targetYear}-12-31`);

  query = applyAccountFilter(query, accountId);
  const { data, error } = await query.order('period_start', { ascending: true });

  if (error) {
    console.error('[getOptionsMonthlyMetrics] query error:', error.message);
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    accountId: text(row.account_id),
    periodStart: isoDate(row.period_start),
    periodEnd: isoDate(row.period_end),
    cashFlow: decimalString(row.cash_flow_total as NumericLike),
    realizedPnl: decimalString(row.realized_pnl_total as NumericLike),
    cumulativeCashFlow: decimalString(row.cash_flow_cumulative as NumericLike),
    cumulativeRealizedPnl: decimalString(row.realized_pnl_cumulative as NumericLike),
    varianceGap: decimalString(row.variance_gap as NumericLike),
    cumulativeVarianceGap: decimalString(row.variance_gap_cumulative as NumericLike),
    tradeCount: toInt(row.trade_count),
    rollCount: toInt(row.roll_count),
    rollPositiveCount: toInt(row.roll_positive_count),
    rollNegativeCount: toInt(row.roll_negative_count),
    rollNeutralCount: toInt(row.roll_neutral_count),
    rollEfficiencyPct: nullableDecimalString(row.roll_efficiency_pct as NumericLike),
    lastComputedAt: text(row.last_computed_at),
  }));
}

/** Reads detected roll events and joined close/open trade details for chart tooltips. */
export async function getOptionsRollEvents(
  rangeStart: Date,
  rangeEnd: Date,
  accountId?: string,
): Promise<RollEvent[]> {
  const { householdId } = await getAuthenticatedHousehold();
  if (!householdId) return [];

  const supabase = await createClient();
  let query = supabase
    .from('options_roll_events')
    .select(`
      id, account_id, strategy_group_id, detected_at, detection_status, classification,
      closed_leg_realized_pnl, incremental_cash_flow, old_expiry, new_expiry,
      old_strike, new_strike, heuristic_version,
      closed_trade:options_trades!options_roll_events_closed_trade_id_fkey(
        id, account_id, strategy_group_id, event_type, side, trade_time, trade_date,
        quantity, price, gross_amount, commission, fees, net_cash_flow, realized_pnl, currency,
        options_legs(underlying_symbol, expiry, strike, right)
      ),
      opened_trade:options_trades!options_roll_events_opened_trade_id_fkey(
        id, account_id, strategy_group_id, event_type, side, trade_time, trade_date,
        quantity, price, gross_amount, commission, fees, net_cash_flow, realized_pnl, currency,
        options_legs(underlying_symbol, expiry, strike, right)
      )
    `)
    .eq('household_id', householdId)
    .neq('detection_status', 'rejected')
    .gte('detected_at', rangeStart.toISOString())
    .lte('detected_at', rangeEnd.toISOString());

  query = applyAccountFilter(query, accountId);
  const { data, error } = await query.order('detected_at', { ascending: true });

  if (error) {
    console.error('[getOptionsRollEvents] query error:', error.message);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map(normalizeRollEvent);
}

/** Reads strategy groups, child trades, and roll markers for the selected window. */
export async function getOptionsStrategyTimeline(
  rangeStart: Date,
  rangeEnd: Date,
  accountId?: string,
): Promise<StrategyGroup[]> {
  const { householdId } = await getAuthenticatedHousehold();
  if (!householdId) return [];

  const supabase = await createClient();
  let query = supabase
    .from('options_strategy_groups')
    .select(`
      id, account_id, underlying_symbol, kind, status, opened_at, closed_at,
      net_cash_flow, realized_pnl, capital_at_risk, notes,
      options_trades(
        id, account_id, strategy_group_id, event_type, side, trade_time, trade_date,
        quantity, price, gross_amount, commission, fees, net_cash_flow, realized_pnl, currency,
        options_legs(underlying_symbol, expiry, strike, right)
      ),
      options_roll_events(
        id, account_id, strategy_group_id, detected_at, detection_status, classification,
        closed_leg_realized_pnl, incremental_cash_flow, old_expiry, new_expiry,
        old_strike, new_strike, heuristic_version
      )
    `)
    .eq('household_id', householdId)
    .lte('opened_at', rangeEnd.toISOString())
    .or(`closed_at.is.null,closed_at.gte.${rangeStart.toISOString()}`);

  query = applyAccountFilter(query, accountId);
  const { data, error } = await query.order('opened_at', { ascending: true });

  if (error) {
    console.error('[getOptionsStrategyTimeline] query error:', error.message);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: text(row.id),
    accountId: text(row.account_id),
    underlyingSymbol: text(row.underlying_symbol),
    kind: row.kind === 'csp' || row.kind === 'vertical_spread' || row.kind === 'roll_chain' ? row.kind : 'ungrouped',
    status: row.status === 'closed' || row.status === 'expired' || row.status === 'assigned' || row.status === 'mixed' ? row.status : 'open',
    openedAt: text(row.opened_at),
    closedAt: row.closed_at === null ? null : text(row.closed_at),
    netCashFlow: decimalString(row.net_cash_flow as NumericLike),
    realizedPnl: decimalString(row.realized_pnl as NumericLike),
    capitalAtRisk: nullableDecimalString(row.capital_at_risk as NumericLike),
    notes: row.notes === null ? null : text(row.notes),
    trades: ((row.options_trades ?? []) as Record<string, unknown>[]).map(normalizeTrade).filter((trade): trade is OptionsTradeSummary => trade !== null),
    rollEvents: ((row.options_roll_events ?? []) as Record<string, unknown>[])
      .filter((roll) => roll.detection_status !== 'rejected')
      .map((roll) => normalizeRollEvent(roll)),
  }));
}

/** Returns the latest options ingestion sync timestamp visible to the user. */
export async function getOptionsFreshness(): Promise<OptionsFreshness> {
  const { householdId } = await getAuthenticatedHousehold();
  if (!householdId) return { asOf: null, source: null, status: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('options_flex_sync_state')
    .select('last_sync_at, source, status')
    .eq('household_id', householdId)
    .not('last_sync_at', 'is', null)
    .order('last_sync_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getOptionsFreshness] query error:', error.message);
    return { asOf: null, source: null, status: null };
  }

  const row = data as Record<string, unknown> | null;
  return {
    asOf: row ? text(row.last_sync_at) || null : null,
    source: row ? text(row.source) || null : null,
    status: row ? text(row.status) || null : null,
  };
}

/** Lists trading accounts opted into options-income computation for filtering. */
export async function getUserAccountsWithOptionsEnabled(): Promise<OptionsEnabledAccount[]> {
  const { householdId } = await getAuthenticatedHousehold();
  if (!householdId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('trading_account_config')
    .select('id, name, account_type, account_id, linked_account_id')
    .eq('household_id', householdId)
    .eq('compute_options_income', true)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) {
    console.error('[getUserAccountsWithOptionsEnabled] query error:', error.message);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const fallbackId = String(row.id ?? '');
    const account = text(row.account_id) || text(row.linked_account_id) || fallbackId;
    const name = text(row.name, account);
    const type = text(row.account_type, 'IBKR');
    return {
      id: fallbackId,
      label: `${name}${account && account !== name ? ` (${account})` : ''}`,
      accountId: account,
      accountType: type,
    };
  }).filter((account) => account.accountId.length > 0);
}

/** Reads recent option trades for the optional drill-down table. */
export async function getOptionsTrades(
  rangeStart: Date,
  rangeEnd: Date,
  accountId?: string,
  limit = 50,
): Promise<OptionsTradeSummary[]> {
  const { householdId } = await getAuthenticatedHousehold();
  if (!householdId) return [];

  const supabase = await createClient();
  let query = supabase
    .from('options_trades')
    .select(`
      id, account_id, strategy_group_id, event_type, side, trade_time, trade_date,
      quantity, price, gross_amount, commission, fees, net_cash_flow, realized_pnl, currency,
      options_legs(underlying_symbol, expiry, strike, right)
    `)
    .eq('household_id', householdId)
    .gte('trade_date', dateKey(rangeStart))
    .lte('trade_date', dateKey(rangeEnd));

  query = applyAccountFilter(query, accountId);
  const { data, error } = await query.order('trade_date', { ascending: false }).limit(limit);

  if (error) {
    console.error('[getOptionsTrades] query error:', error.message);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map(normalizeTrade).filter((trade): trade is OptionsTradeSummary => trade !== null);
}


/** Reads live capital-efficiency gauge values for the selected options account. */
export async function getEfficiencyGaugesData(accountId?: string): Promise<import('@/types/options').EfficiencyGaugesData> {
  const { householdId } = await getAuthenticatedHousehold();
  if (!householdId) {
    return { rocaR_pct: null, marginUtilization_pct: null, marginSource: null, marginAsOf: null, marginUsed: null, marginAvailable: null, isStale: false };
  }

  const supabase = await createClient();
  const accountFilter = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
  const monthlyQuery = accountFilter
    ? supabase
      .from('options_dashboard_monthly')
      .select('return_on_capital_at_risk_pct')
      .eq('household_id', householdId)
      .eq('account_id', accountFilter)
      .not('return_on_capital_at_risk_pct', 'is', null)
      .order('period_start', { ascending: false })
      .limit(1)
    : supabase
      .from('options_dashboard_monthly')
      .select('return_on_capital_at_risk_pct')
      .eq('household_id', householdId)
      .not('return_on_capital_at_risk_pct', 'is', null)
      .order('period_start', { ascending: false })
      .limit(1);

  const marginQuery = accountFilter
    ? supabase
      .from('options_margin_snapshots')
      .select('captured_at, margin_used, margin_available, source')
      .eq('household_id', householdId)
      .eq('account_id', accountFilter)
      .order('captured_at', { ascending: false })
      .limit(1)
    : supabase
      .from('options_margin_snapshots')
      .select('captured_at, margin_used, margin_available, source')
      .eq('household_id', householdId)
      .order('captured_at', { ascending: false })
      .limit(1);

  const [monthlyResult, marginResult] = await Promise.all([monthlyQuery.maybeSingle(), marginQuery.maybeSingle()]);

  if (monthlyResult.error) console.error('[getEfficiencyGaugesData] monthly query error:', monthlyResult.error.message);
  if (marginResult.error) console.error('[getEfficiencyGaugesData] margin query error:', marginResult.error.message);

  const monthly = monthlyResult.data as Record<string, unknown> | null;
  const margin = marginResult.data as Record<string, unknown> | null;
  const marginAsOf = margin ? text(margin.captured_at) || null : null;

  return {
    rocaR_pct: monthly ? nullableDecimalString(monthly.return_on_capital_at_risk_pct as NumericLike) : null,
    marginUtilization_pct: margin && margin.margin_used !== null && margin.margin_available !== null && new Decimal(decimalString(margin.margin_available as NumericLike)).gt(0)
      ? new Decimal(decimalString(margin.margin_used as NumericLike)).div(decimalString(margin.margin_available as NumericLike)).times(100).toFixed(2)
      : null,
    marginSource: margin ? marginSource(margin.source) : null,
    marginAsOf,
    marginUsed: margin ? nullableDecimalString(margin.margin_used as NumericLike) : null,
    marginAvailable: margin ? nullableDecimalString(margin.margin_available as NumericLike) : null,
    isStale: isOlderThanOneHour(marginAsOf),
  };
}
