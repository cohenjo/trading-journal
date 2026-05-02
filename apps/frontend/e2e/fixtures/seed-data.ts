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

/**
 * Deletes all seeded data for a household.
 *
 * Clears:
 *   - `finance_snapshots` rows for this household (funds + assets)
 *   - `trade` rows for this household
 *
 * Does NOT delete the household itself or the user — that is handled by
 * the `testUser` fixture's afterAll teardown.
 */
export async function cleanupHouseholdData(householdId: string): Promise<void> {
  const admin = getAdminClient();

  const results = await Promise.allSettled([
    admin.from('finance_snapshots').delete().eq('household_id', householdId),
    admin.from('trade').delete().eq('household_id', householdId),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`[seed-data] cleanup warning: ${result.reason}`);
    } else if (result.value.error) {
      console.warn(`[seed-data] cleanup warning: ${result.value.error.message}`);
    }
  }
}
