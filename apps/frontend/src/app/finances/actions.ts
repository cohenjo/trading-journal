'use server';

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
