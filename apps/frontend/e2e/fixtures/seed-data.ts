/**
 * e2e/fixtures/seed-data.ts
 *
 * Per-test data seeding helpers for E2E tests.
 *
 * All helpers use the service-role admin client (bypasses RLS) so they can
 * seed data for a household without requiring the test user to be the owner.
 *
 * Data model:
 *   - Funds and Assets are FinanceItems stored in `finance_snapshots.data.items` (JSONB).
 *     category: 'Investments' → fund-type items
 *     category: 'Assets'      → asset-type items
 *   - Trades are rows in `public.trade` (IB Flex schema + household_id).
 *
 * Teardown:
 *   - `cleanupHouseholdData(householdId)` deletes all seeded rows for the household.
 *     Because FK constraints use ON DELETE CASCADE, deleting the household row itself
 *     would cascade everything — but we don't do that here; we only clear data rows
 *     so the user can be reused across test hooks if needed.
 *
 * Usage:
 *   import { seedFund, seedAsset, seedTrade, cleanupHouseholdData } from '../fixtures/seed-data';
 *
 *   test.beforeEach(async () => {
 *     await seedFund(householdId, { name: 'S&P 500 Fund', value: 50000 });
 *     await seedTrade(householdId, { symbol: 'AAPL', side: 'BUY' });
 *   });
 *
 *   test.afterEach(async () => {
 *     await cleanupHouseholdData(householdId);
 *   });
 */

import { getAdminClient } from './admin';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FundSeedData {
  name: string;
  value: number;
  type?: string;
  owner?: string;
  currency?: string;
  details?: Record<string, unknown>;
}

export interface AssetSeedData {
  name: string;
  value: number;
  type?: string;
  owner?: string;
  currency?: string;
  details?: Record<string, unknown>;
}

export interface TradeSeedData {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity?: number;
  price?: number;
  currency?: string;
  tradeDate?: string;
  accountId?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Returns today's date as a YYYY-MM-DD string (snapshot key). */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Upserts a FinanceItem into `finance_snapshots.data.items` for the given household.
 *
 * If a snapshot row already exists for (householdId, date), the new item is
 * appended to `data.items`. If no row exists, a minimal snapshot is created.
 */
async function upsertFinanceItem(
  householdId: string,
  item: Record<string, unknown>,
): Promise<void> {
  const admin = getAdminClient();
  const date = todayKey();

  // Fetch existing snapshot for today
  const { data: existing, error: fetchError } = await admin
    .from('finance_snapshots')
    .select('data')
    .eq('household_id', householdId)
    .eq('date', date)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`[seed-data] fetch finance_snapshots failed: ${fetchError.message}`);
  }

  const currentData = (existing?.data ?? {}) as {
    items?: Record<string, unknown>[];
    total_savings?: number;
    total_investments?: number;
    total_assets?: number;
    total_liabilities?: number;
    net_worth?: number;
  };

  const items = [...(currentData.items ?? []), item];

  // Recompute simple aggregate totals (approximate — backend will recompute on real use)
  const totalInvestments = items
    .filter((i) => i['category'] === 'Investments')
    .reduce((sum, i) => sum + Number(i['value'] ?? 0), 0);
  const totalAssets = items
    .filter((i) => i['category'] === 'Assets')
    .reduce((sum, i) => sum + Number(i['value'] ?? 0), 0);
  const totalSavings = items
    .filter((i) => i['category'] === 'Savings')
    .reduce((sum, i) => sum + Number(i['value'] ?? 0), 0);
  const totalLiabilities = items
    .filter((i) => i['category'] === 'Liabilities')
    .reduce((sum, i) => sum + Number(i['value'] ?? 0), 0);
  const netWorth = totalAssets + totalSavings + totalInvestments - totalLiabilities;

  const updatedData = {
    ...currentData,
    items,
    total_investments: totalInvestments,
    total_assets: totalAssets,
    total_savings: totalSavings,
    total_liabilities: totalLiabilities,
    net_worth: netWorth,
  };

  const { error: upsertError } = await admin.from('finance_snapshots').upsert(
    {
      household_id: householdId,
      date,
      data: updatedData,
      net_worth: netWorth,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
    },
    { onConflict: 'household_id,date' },
  );

  if (upsertError) {
    throw new Error(`[seed-data] upsert finance_snapshots failed: ${upsertError.message}`);
  }
}

// ─── Public seed helpers ──────────────────────────────────────────────────────

/**
 * Seeds a fund-type FinanceItem (category: 'Investments') into `finance_snapshots`
 * for the given household.
 */
export async function seedFund(householdId: string, data: FundSeedData): Promise<void> {
  const item = {
    id: `e2e-fund-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category: 'Investments',
    type: data.type ?? 'Fund',
    name: data.name,
    value: data.value,
    owner: data.owner ?? 'e2e-test',
    currency: data.currency ?? 'ILS',
    inflow_priority: 100,
    withdrawal_priority: 100,
    details: data.details ?? {},
  };

  await upsertFinanceItem(householdId, item);
}

/**
 * Seeds an asset-type FinanceItem (category: 'Assets') into `finance_snapshots`
 * for the given household.
 */
export async function seedAsset(householdId: string, data: AssetSeedData): Promise<void> {
  const item = {
    id: `e2e-asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category: 'Assets',
    type: data.type ?? 'Property',
    name: data.name,
    value: data.value,
    owner: data.owner ?? 'e2e-test',
    currency: data.currency ?? 'ILS',
    inflow_priority: 100,
    withdrawal_priority: 100,
    details: data.details ?? {},
  };

  await upsertFinanceItem(householdId, item);
}

/**
 * Seeds a trade row into `public.trade` for the given household.
 * Uses a minimal IB Flex-compatible schema — only required fields are set.
 */
export async function seedTrade(householdId: string, data: TradeSeedData): Promise<void> {
  const admin = getAdminClient();

  const tradeRow = {
    household_id: householdId,
    // IB Flex required columns — use placeholder values for E2E tests
    tradeID: Date.now(),
    accountId: data.accountId ?? 'E2E_TEST_ACCOUNT',
    acctAlias: 'E2E Test Account',
    currency: data.currency ?? 'USD',
    symbol: data.symbol,
    description: `E2E seed trade for ${data.symbol}`,
    conid: 0,
    assetCategory: 'STK',
    tradeDate: data.tradeDate ?? todayKey(),
    settleDateTarget: data.tradeDate ?? todayKey(),
    transactionType: 'ExchTrade',
    exchange: 'NASDAQ',
    quantity: data.quantity ?? 1,
    tradePrice: data.price ?? 100,
    tradeMoney: (data.quantity ?? 1) * (data.price ?? 100),
    proceeds: -(data.quantity ?? 1) * (data.price ?? 100),
    taxes: 0,
    ibCommission: 0,
    ibCommissionCurrency: data.currency ?? 'USD',
    netCash: -(data.quantity ?? 1) * (data.price ?? 100),
    closePrice: data.price ?? 100,
    openCloseIndicator: 'O',
    cost: (data.quantity ?? 1) * (data.price ?? 100),
    fifoPnlRealized: 0,
    mtmPnl: 0,
    origTradePrice: 0,
    buySell: data.side,
  };

  const { error } = await admin.from('trade').insert(tradeRow);

  if (error) {
    throw new Error(`[seed-data] insert trade failed: ${error.message}`);
  }
}

export interface TradingAccountSeedData {
  name?: string;
  accountId?: string;
  host?: string;
  port?: number;
  clientId?: number;
  computeOptionsIncome?: boolean;
}

/** Seeds a trading account config row for account-management E2E flows. */
export async function seedTradingAccount(
  householdId: string,
  data: TradingAccountSeedData = {},
): Promise<{ accountId: string }> {
  const admin = getAdminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const accountId = data.accountId ?? `E2E_TRADING_${suffix}`;

  const { error } = await admin.from('trading_account_config').insert({
    household_id: householdId,
    name: data.name ?? 'E2E IBKR Account',
    account_type: 'IBKR',
    host: data.host ?? '127.0.0.1',
    port: data.port ?? 4001,
    client_id: data.clientId ?? 1,
    account_id: accountId,
    compute_options_income: data.computeOptionsIncome ?? true,
  });

  if (error) throw new Error(`[seed-data] insert trading_account_config failed: ${error.message}`);

  return { accountId };
}

export interface OptionsDashboardSeedResult {
  accountId: string;
  groupId: string;
}

/**
 * Seeds a minimal Phase 3 options dashboard scenario: one enabled account,
 * three monthly metric rows matching Jony's worked example, one strategy group,
 * and one negative roll event.
 */
export async function seedOptionsDashboard(householdId: string): Promise<OptionsDashboardSeedResult> {
  const admin = getAdminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const accountId = `E2E_OPTIONS_${suffix}`;

  const { error: accountError } = await admin.from('trading_account_config').insert({
    household_id: householdId,
    name: 'E2E Options Account',
    account_type: 'IBKR',
    host: '127.0.0.1',
    port: 4001,
    client_id: 1,
    account_id: accountId,
    compute_options_income: true,
  });
  if (accountError) throw new Error(`[seed-data] insert trading_account_config failed: ${accountError.message}`);

  const { error: syncError } = await admin.from('options_flex_sync_state').insert({
    household_id: householdId,
    account_id: accountId,
    query_name: 'E2E Flex Query',
    source: 'ibkr_flex',
    status: 'succeeded',
    last_sync_at: new Date().toISOString(),
    last_from_date: '2026-01-01',
    last_through_date: '2026-03-31',
    rows_seen: 3,
    rows_inserted: 3,
  });
  if (syncError) throw new Error(`[seed-data] insert options_flex_sync_state failed: ${syncError.message}`);

  const { data: leg, error: legError } = await admin.from('options_legs').insert({
    household_id: householdId,
    account_id: accountId,
    underlying_symbol: 'SPY',
    option_symbol: `SPY-E2E-${suffix}`,
    expiry: '2026-03-20',
    strike: 540,
    right: 'put',
    multiplier: 100,
    currency: 'USD',
  }).select('id').single();
  if (legError || !leg) throw new Error(`[seed-data] insert options_legs failed: ${legError?.message ?? 'no row'}`);

  const { data: group, error: groupError } = await admin.from('options_strategy_groups').insert({
    household_id: householdId,
    account_id: accountId,
    underlying_symbol: 'SPY',
    kind: 'vertical_spread',
    status: 'closed',
    opened_at: '2026-01-15T15:30:00Z',
    closed_at: '2026-03-15T15:30:00Z',
    net_cash_flow: 2700,
    realized_pnl: 1000,
    capital_at_risk: 2300,
    capital_at_risk_open: 10000,
    risk_calculation_method: 'vertical_spread_max_loss',
  }).select('id').single();
  if (groupError || !group) throw new Error(`[seed-data] insert options_strategy_groups failed: ${groupError?.message ?? 'no row'}`);

  const baseTrade = {
    household_id: householdId,
    account_id: accountId,
    strategy_group_id: group.id,
    leg_id: leg.id,
    source: 'ibkr_flex',
    side: 'sell',
    quantity: 1,
    price: 30,
    gross_amount: 3000,
    commission: 0,
    fees: 0,
    currency: 'USD',
  };

  const { data: closedTrade, error: closedTradeError } = await admin.from('options_trades').insert({
    ...baseTrade,
    source_trade_id: `e2e-closed-${suffix}`,
    event_type: 'close',
    trade_time: '2026-02-14T15:30:00Z',
    trade_date: '2026-02-14',
    net_cash_flow: 200,
    realized_pnl: -1000,
  }).select('id').single();
  if (closedTradeError || !closedTrade) throw new Error(`[seed-data] insert closed options_trades failed: ${closedTradeError?.message ?? 'no row'}`);

  const { data: openedTrade, error: openedTradeError } = await admin.from('options_trades').insert({
    ...baseTrade,
    source_trade_id: `e2e-opened-${suffix}`,
    event_type: 'open',
    trade_time: '2026-02-14T15:35:00Z',
    trade_date: '2026-02-14',
    net_cash_flow: 200,
    realized_pnl: 0,
  }).select('id').single();
  if (openedTradeError || !openedTrade) throw new Error(`[seed-data] insert opened options_trades failed: ${openedTradeError?.message ?? 'no row'}`);

  const { error: rollError } = await admin.from('options_roll_events').insert({
    household_id: householdId,
    account_id: accountId,
    strategy_group_id: group.id,
    closed_trade_id: closedTrade.id,
    opened_trade_id: openedTrade.id,
    detected_at: '2026-02-14T15:35:00Z',
    detection_status: 'detected',
    classification: 'negative',
    closed_leg_realized_pnl: -1000,
    incremental_cash_flow: 200,
    old_expiry: '2026-02-20',
    new_expiry: '2026-03-20',
    old_strike: 545,
    new_strike: 540,
    heuristic_version: 'e2e-v1',
  });
  if (rollError) throw new Error(`[seed-data] insert options_roll_events failed: ${rollError.message}`);

  const { error: metricsError } = await admin.from('options_dashboard_monthly').insert([
    { household_id: householdId, account_id: accountId, period_start: '2026-01-01', period_end: '2026-01-31', cash_flow_total: 3000, realized_pnl_total: 0, cash_flow_cumulative: 3000, realized_pnl_cumulative: 0, variance_gap: 3000, variance_gap_cumulative: 3000, trade_count: 1, roll_count: 0, roll_positive_count: 0, roll_negative_count: 0, roll_neutral_count: 0 },
    { household_id: householdId, account_id: accountId, period_start: '2026-02-01', period_end: '2026-02-28', cash_flow_total: 200, realized_pnl_total: -1000, cash_flow_cumulative: 3200, realized_pnl_cumulative: -1000, variance_gap: 1200, variance_gap_cumulative: 4200, trade_count: 2, roll_count: 1, roll_positive_count: 0, roll_negative_count: 1, roll_neutral_count: 0, roll_efficiency_pct: 0 },
    { household_id: householdId, account_id: accountId, period_start: '2026-03-01', period_end: '2026-03-31', cash_flow_total: -500, realized_pnl_total: 2000, cash_flow_cumulative: 2700, realized_pnl_cumulative: 1000, variance_gap: -2500, variance_gap_cumulative: 1700, trade_count: 1, roll_count: 0, roll_positive_count: 0, roll_negative_count: 0, roll_neutral_count: 0, avg_capital_at_risk: 10000, return_on_capital_at_risk_pct: 20.0, latest_margin_used: 5000, latest_margin_available: 15000, margin_utilization_pct: 33.33 },
  ]);
  if (metricsError) throw new Error(`[seed-data] insert options_dashboard_monthly failed: ${metricsError.message}`);

  const { error: marginError } = await admin.from('options_margin_snapshots').insert({
    household_id: householdId,
    account_id: accountId,
    captured_at: new Date().toISOString(),
    margin_used: 5000,
    margin_available: 15000,
    buying_power: 15000,
    source: 'synthetic',
  });
  if (marginError) throw new Error(`[seed-data] insert options_margin_snapshots failed: ${marginError.message}`);

  return { accountId, groupId: group.id as string };
}

/**
 * Deletes all seeded data for a household.
 *
 * Clears:
 *   - `finance_snapshots` rows for this household (funds + assets)
 *   - `trade` rows for this household
 *   - options Phase 1/2 dashboard rows for this household
 *
 * Does NOT delete the household itself or the user — that is handled by
 * the `testUser` fixture's afterAll teardown.
 */
export async function cleanupHouseholdData(householdId: string): Promise<void> {
  const admin = getAdminClient();

  const results = await Promise.allSettled([
    admin.from('options_margin_snapshots').delete().eq('household_id', householdId),
    admin.from('options_roll_events').delete().eq('household_id', householdId),
    admin.from('options_trades').delete().eq('household_id', householdId),
    admin.from('options_dashboard_monthly').delete().eq('household_id', householdId),
    admin.from('options_strategy_groups').delete().eq('household_id', householdId),
    admin.from('options_positions').delete().eq('household_id', householdId),
    admin.from('options_legs').delete().eq('household_id', householdId),
    admin.from('options_flex_sync_state').delete().eq('household_id', householdId),
    admin.from('trading_account_config').delete().eq('household_id', householdId),
    admin.from('finance_snapshots').delete().eq('household_id', householdId),
    admin.from('trade').delete().eq('household_id', householdId),
    // dividend_accounts was missing — omission caused duplicate PK failures on
    // nightly re-runs when deleteE2eUser couldn't delete due to lingering FK refs.
    // Tracked: #267, #232 (dup).
    admin.from('dividend_accounts').delete().eq('household_id', householdId),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`[seed-data] cleanup warning: ${result.reason}`);
    } else if (result.value.error) {
      console.warn(`[seed-data] cleanup warning: ${result.value.error.message}`);
    }
  }
}
