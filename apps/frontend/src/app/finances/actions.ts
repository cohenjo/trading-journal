'use server';

import Decimal from 'decimal.js';
import { createClient } from '@/lib/supabase/server';
import { convertCurrency } from '@/lib/currency';
import type { FinanceItem } from '@/components/CurrentFinances/FinanceTabs';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Full shape returned by the latest-snapshot endpoint. */
export interface FinanceSnapshot {
  date: string;
  household_id: string;
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  data: FinanceSnapshotData;
}

/** Shape of the `data` jsonb column. */
export interface FinanceSnapshotData {
  items: FinanceItem[];
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  total_savings: number;
  total_investments: number;
}

export type SaveFinanceSnapshotPayload = FinanceSnapshotData;

export type SaveFinanceSnapshotResult =
  | { success: true }
  | { success: false; error: string };

export type DeleteFinanceSnapshotResult =
  | { success: true }
  | { success: false; error: string };

export interface PriceCacheResult {
  price: string;
  as_of: string;
  refreshed_at: string;
  isStale: boolean;
}

interface PriceCacheRow {
  price: string | number;
  as_of: string;
  refreshed_at: string;
}

const PRICE_CACHE_STALE_MS = 4 * 60 * 60 * 1000;

// Raw rows from dividend tables — typed narrowly to avoid over-fetching
interface DividendAccountRow {
  name: string;
  linked_id: number | null;
}

interface DividendPositionRow {
  ticker: string;
  shares: number;
}

interface DividendTickerDataRow {
  ticker: string;
  dividend_rate: number;
  currency: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Looks up the calling user's primary active household_id.
 * household_id must NEVER come from user input — always from the session.
 */
async function resolveHouseholdId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.household_id as string;
}

/**
 * Normalises a dividend ticker's raw amount+currency pair for use with
 * `convertCurrency`.
 *
 * yfinance returns amounts for Israeli TA stocks in Agorot (ILA) where
 * 1 ILA = 0.01 ILS. Since `convertCurrency` only knows ILS/USD/EUR,
 * we normalise ILA → ILS by dividing the raw amount by 100.
 */
function normaliseAmount(rawAmount: number, currency: string): { amount: number; currency: string } {
  if (currency.toUpperCase() === 'ILA') {
    return { amount: rawAmount * 0.01, currency: 'ILS' };
  }
  return { amount: rawAmount, currency };
}

/**
 * Enriches snapshot items in-place with dividend data from linked dividend
 * accounts. Mirrors the Python implementation in `finances.py:79-120`.
 *
 * For each item whose `id` matches a `dividend_accounts.linked_id`, we sum
 * `dividend_positions.shares * dividend_ticker_data.dividend_rate` for all
 * positions in that account, convert to the item's native currency, and write:
 *   - `item.details.dividend_fixed_amount`
 *   - `item.details.dividend_mode = 'Fixed'`
 *
 * This is an **in-memory enrichment only** — no DB writes.
 */
async function enrichWithDividends(items: FinanceItem[]): Promise<void> {
  const supabase = await createClient();

  // Fetch all dividend accounts for the household (RLS handles scoping).
  const { data: divAccounts, error: divAccError } = await supabase
    .from('dividend_accounts')
    .select('name, linked_id')
    .not('linked_id', 'is', null);

  if (divAccError || !divAccounts?.length) return;

  // Build map: linked_id → account name for O(1) lookup
  const linkedIdToAccount = new Map<number, string>(
    (divAccounts as DividendAccountRow[])
      .filter((a): a is DividendAccountRow & { linked_id: number } => a.linked_id !== null)
      .map((a) => [a.linked_id, a.name]),
  );

  // Collect the account names we actually need positions for
  const accountNames = Array.from(linkedIdToAccount.values());
  if (!accountNames.length) return;

  // Batch-fetch all relevant positions and ticker data in two queries
  const { data: positions } = await supabase
    .from('dividend_positions')
    .select('account, ticker, shares')
    .in('account', accountNames);

  if (!positions?.length) return;

  const tickers = [...new Set((positions as Array<DividendPositionRow & { account: string }>).map((p) => p.ticker))];

  const { data: tickerData } = await supabase
    .from('dividend_ticker_data')
    .select('ticker, dividend_rate, currency')
    .in('ticker', tickers);

  const tdMap = new Map<string, DividendTickerDataRow>(
    (tickerData ?? []).map((t: DividendTickerDataRow) => [t.ticker, t]),
  );

  // Group positions by account name
  const positionsByAccount = new Map<string, Array<DividendPositionRow & { account: string }>>();
  for (const p of positions as Array<DividendPositionRow & { account: string }>) {
    const list = positionsByAccount.get(p.account) ?? [];
    list.push(p);
    positionsByAccount.set(p.account, list);
  }

  // Enrich each item that has a linked dividend account
  for (const item of items) {
    const itemId = typeof item.id === 'string' ? Number(item.id) : (item.id as number);
    if (!itemId) continue;

    const accountName = linkedIdToAccount.get(itemId);
    if (!accountName) continue;

    const acctPositions = positionsByAccount.get(accountName);
    if (!acctPositions?.length) continue;

    const itemCurrency = item.currency ?? 'USD';
    let totalIncome = 0;

    for (const p of acctPositions) {
      const td = tdMap.get(p.ticker);
      if (!td) continue;

      const rawAmount = Number(p.shares) * Number(td.dividend_rate);
      const { amount, currency } = normaliseAmount(rawAmount, td.currency);
      totalIncome += convertCurrency(amount, currency, itemCurrency);
    }

    if (totalIncome > 0) {
      if (!item.details) item.details = {};
      item.details.dividend_fixed_amount = Math.round(totalIncome * 100) / 100;
      item.details.dividend_mode = 'Fixed';
    }
  }
}

// ── Server Action ─────────────────────────────────────────────────────────────

/**
 * Reads the latest scheduled price-cache row for an authenticated user.
 *
 * Prices remain strings to preserve Postgres numeric precision; callers that
 * need arithmetic should construct a Decimal from the returned value.
 */
export async function getPrice(symbol: string, currency = 'USD'): Promise<PriceCacheResult | null> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedCurrency = currency.trim().toUpperCase() || 'USD';
  if (!normalizedSymbol) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const { data, error } = await supabase
    .from('price_cache')
    .select('price, as_of, refreshed_at')
    .eq('symbol', normalizedSymbol)
    .eq('currency', normalizedCurrency)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('[getPrice] query error:', error.message);
    return null;
  }

  const row = data as PriceCacheRow;
  const price = new Decimal(String(row.price));
  if (!price.isFinite() || price.lte(0)) return null;

  const refreshedAtMs = new Date(row.refreshed_at).getTime();
  const isStale = !Number.isFinite(refreshedAtMs) || Date.now() - refreshedAtMs > PRICE_CACHE_STALE_MS;

  return {
    price: price.toString(),
    as_of: row.as_of,
    refreshed_at: row.refreshed_at,
    isStale,
  };
}

/**
 * Returns the most-recent finance snapshot for the authenticated user's
 * household, enriched in-memory with dividend data for linked accounts.
 *
 * Security guarantees:
 * - `household_id` is resolved from the authenticated session; never from
 *   caller input.
 * - Supabase RLS enforces read isolation at the DB layer.
 *
 * Enrichment is best-effort: if any dividend query fails, the raw snapshot
 * is returned without enrichment (matching the Python behaviour).
 *
 * @returns The enriched snapshot, or `null` when none exists yet.
 */
export async function getLatestFinanceSnapshot(): Promise<FinanceSnapshot | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return null;

  const { data, error } = await supabase
    .from('finance_snapshots')
    .select('date, household_id, net_worth, total_assets, total_liabilities, data')
    .eq('household_id', householdId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getLatestFinanceSnapshot] query error:', error.message);
    return null;
  }
  if (!data) return null;

  const snapshot = data as unknown as FinanceSnapshot;
  const items: FinanceItem[] = Array.isArray(snapshot.data?.items) ? snapshot.data.items : [];

  try {
    await enrichWithDividends(items);
  } catch (err) {
    console.error('[getLatestFinanceSnapshot] dividend enrichment failed:', err);
    // Continue with non-enriched snapshot — matches Python behaviour
  }

  return snapshot;
}

/**
 * Returns finance snapshots for the authenticated user's household, newest first.
 * `household_id` is resolved from the session and RLS enforces read isolation.
 */
export async function getFinanceHistory(limit = 100): Promise<FinanceSnapshot[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return [];

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return [];

  const boundedLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), 500)
    : 100;

  const { data, error } = await supabase
    .from('finance_snapshots')
    .select('date, household_id, net_worth, total_assets, total_liabilities, data')
    .eq('household_id', householdId)
    .order('date', { ascending: false })
    .limit(boundedLimit);

  if (error) {
    console.error('[getFinanceHistory] query error:', error.message);
    return [];
  }

  return (data ?? []) as unknown as FinanceSnapshot[];
}

/**
 * Upserts a finance snapshot for the authenticated user's household.
 * The household scope is session-derived; callers can only choose date/payload.
 */
export async function saveFinanceSnapshot(
  date: string,
  payload: SaveFinanceSnapshotPayload,
): Promise<SaveFinanceSnapshotResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  const snapshotDate = typeof date === 'string' ? date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    return { success: false, error: 'Invalid date' };
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    return { success: false, error: 'Invalid payload: items must be an array' };
  }
  if (
    typeof payload.net_worth !== 'number' ||
    typeof payload.total_assets !== 'number' ||
    typeof payload.total_liabilities !== 'number' ||
    typeof payload.total_savings !== 'number' ||
    typeof payload.total_investments !== 'number'
  ) {
    return { success: false, error: 'Invalid payload: all metric fields must be numbers' };
  }

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { success: false, error: 'No active household found for your account' };
  }

  const { error: upsertError } = await supabase.from('finance_snapshots').upsert(
    {
      date: snapshotDate,
      household_id: householdId,
      data: payload,
      net_worth: payload.net_worth,
      total_assets: payload.total_assets,
      total_liabilities: payload.total_liabilities,
    },
    { onConflict: 'household_id,date' },
  );

  if (upsertError) {
    console.error('[saveFinanceSnapshot] upsert error:', upsertError.message);
    return { success: false, error: 'Failed to save snapshot. Please try again.' };
  }

  return { success: true };
}

/** Deletes one finance snapshot by date for the authenticated user's household. */
export async function deleteFinanceSnapshot(dateStr: string): Promise<DeleteFinanceSnapshotResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  const snapshotDate = typeof dateStr === 'string' ? dateStr.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    return { success: false, error: 'Invalid date' };
  }

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { success: false, error: 'No active household found for your account' };
  }

  const { error: deleteError } = await supabase
    .from('finance_snapshots')
    .delete()
    .eq('household_id', householdId)
    .eq('date', snapshotDate);

  if (deleteError) {
    console.error('[deleteFinanceSnapshot] delete error:', deleteError.message);
    return { success: false, error: 'Failed to delete snapshot. Please try again.' };
  }

  return { success: true };
}
