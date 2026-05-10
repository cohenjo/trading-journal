'use server';

import { createClient } from '@/lib/supabase/server';
import { convertCurrency } from '@/lib/currency';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImportableAccount {
  id: string;
  name: string;
  type: string;
  details?: Record<string, unknown> | null;
}

export interface DividendPositionPayload {
  account: string;
  ticker: string;
  shares: number;
}

export type DividendPositionPatch = Partial<DividendPositionPayload>;

export interface DividendPosition extends DividendPositionPayload {
  id: number;
}

export interface EnrichedDividendPosition extends DividendPosition {
  price: number;
  dividend_yield: number;
  annual_income: number;
  dgr_3y: number;
  dgr_5y: number;
  currency: string;
}

export interface DividendDashboardStats {
  portfolio_yield: number;
  annual_income: number;
  dgr_5y: number;
  currency: string;
}

export interface DividendDashboardData {
  stats: DividendDashboardStats;
  positions: EnrichedDividendPosition[];
}

export type DividendPositionResult =
  | { ok: true; position: DividendPosition }
  | { ok: false; error: string };

export type DeleteDividendPositionResult =
  | { ok: true }
  | { ok: false; error: string };

interface DividendPositionRow {
  id: number;
  account: string;
  ticker: string;
  shares: number | string;
}

interface DividendTickerDataRow {
  ticker: string;
  price: number | string | null;
  currency: string | null;
  dividend_yield: number | string | null;
  dividend_rate: number | string | null;
  dgr_3y: number | string | null;
  dgr_5y: number | string | null;
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

function emptyDashboard(currency = 'USD'): DividendDashboardData {
  return {
    stats: { portfolio_yield: 0, annual_income: 0, dgr_5y: 0, currency },
    positions: [],
  };
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizePositionPayload(
  payload: DividendPositionPayload,
): DividendPositionPayload | { error: string } {
  const account = typeof payload.account === 'string' ? payload.account.trim() : '';
  const ticker = typeof payload.ticker === 'string' ? payload.ticker.trim().toUpperCase() : '';
  const shares = Number(payload.shares);

  if (!account) return { error: 'Account must not be empty' };
  if (!ticker) return { error: 'Ticker must not be empty' };
  if (!Number.isFinite(shares) || shares < 0) {
    return { error: 'Shares must be a non-negative number' };
  }

  return { account, ticker, shares };
}

function normalizePositionPatch(
  patch: DividendPositionPatch,
): DividendPositionPatch | { error: string } {
  const updates: DividendPositionPatch = {};

  if ('account' in patch) {
    const account = typeof patch.account === 'string' ? patch.account.trim() : '';
    if (!account) return { error: 'Account must not be empty' };
    updates.account = account;
  }

  if ('ticker' in patch) {
    const ticker = typeof patch.ticker === 'string' ? patch.ticker.trim().toUpperCase() : '';
    if (!ticker) return { error: 'Ticker must not be empty' };
    updates.ticker = ticker;
  }

  if ('shares' in patch) {
    const shares = Number(patch.shares);
    if (!Number.isFinite(shares) || shares < 0) {
      return { error: 'Shares must be a non-negative number' };
    }
    updates.shares = shares;
  }

  if (Object.keys(updates).length === 0) return { error: 'No position fields to update' };
  return updates;
}

function toDividendPosition(row: DividendPositionRow): DividendPosition {
  return {
    id: Number(row.id),
    account: row.account,
    ticker: row.ticker,
    shares: toNumber(row.shares),
  };
}

async function dividendAccountExists(account: string, householdId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('dividend_accounts')
    .select('name')
    .eq('name', account)
    .eq('household_id', householdId)
    .maybeSingle();

  if (error) {
    console.error('[dividendAccountExists] query error:', error.message);
    return false;
  }

  return Boolean(data);
}

// ── Server Actions ────────────────────────────────────────────────────────────

/**
 * Returns dashboard stats and enriched dividend positions for the authenticated
 * user's household. Market data enrichment is read from dividend_ticker_data;
 * missing ticker data degrades to zero values until the cache is refreshed.
 */
export async function getDividendDashboard(
  currency = 'USD',
  account?: string,
): Promise<DividendDashboardData> {
  const targetCurrency = typeof currency === 'string' && currency.trim()
    ? currency.trim().toUpperCase()
    : 'USD';
  const accountFilter = typeof account === 'string' && account.trim() ? account.trim() : undefined;
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return emptyDashboard(targetCurrency);

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return emptyDashboard(targetCurrency);

  let positionsQuery = supabase
    .from('dividend_positions')
    .select('id, account, ticker, shares')
    .eq('household_id', householdId);

  if (accountFilter) positionsQuery = positionsQuery.eq('account', accountFilter);

  const { data: positionRows, error: positionsError } = await positionsQuery
    .order('ticker', { ascending: true });
  if (positionsError) {
    console.error('[getDividendDashboard] positions query error:', positionsError.message);
    return emptyDashboard(targetCurrency);
  }

  const positions = ((positionRows ?? []) as DividendPositionRow[]).map(toDividendPosition);
  if (!positions.length) return emptyDashboard(targetCurrency);

  const tickers = [...new Set(positions.map((p) => p.ticker))];
  const { data: tickerRows, error: tickerError } = await supabase
    .from('dividend_ticker_data')
    .select('ticker, price, currency, dividend_yield, dividend_rate, dgr_3y, dgr_5y')
    .in('ticker', tickers);

  if (tickerError) {
    console.error('[getDividendDashboard] ticker query error:', tickerError.message);
  }

  const tickerDataBySymbol = new Map<string, DividendTickerDataRow>(
    ((tickerRows ?? []) as DividendTickerDataRow[]).map((row) => [row.ticker, row]),
  );

  let totalValueTarget = 0;
  let totalAnnualIncomeTarget = 0;
  let dgr5yTotal = 0;
  let dgr5yCount = 0;

  const enrichedPositions = positions.map((position): EnrichedDividendPosition => {
    const tickerData = tickerDataBySymbol.get(position.ticker);
    const price = toNumber(tickerData?.price);
    const tickerCurrency = tickerData?.currency?.trim().toUpperCase() || 'USD';
    const dividendRate = toNumber(tickerData?.dividend_rate);
    const dividendYield = toNumber(tickerData?.dividend_yield);
    const dgr3y = toNumber(tickerData?.dgr_3y);
    const dgr5y = toNumber(tickerData?.dgr_5y);
    const annualIncome = position.shares * dividendRate;
    const positionValue = position.shares * price;

    totalValueTarget += convertCurrency(positionValue, tickerCurrency, targetCurrency);
    totalAnnualIncomeTarget += convertCurrency(annualIncome, tickerCurrency, targetCurrency);

    if (dgr5y !== 0) {
      dgr5yTotal += dgr5y;
      dgr5yCount += 1;
    }

    return {
      ...position,
      price: roundCurrency(price),
      dividend_yield: dividendYield,
      annual_income: roundCurrency(annualIncome),
      dgr_3y: dgr3y,
      dgr_5y: dgr5y,
      currency: tickerCurrency,
    };
  });

  return {
    stats: {
      portfolio_yield: totalValueTarget > 0 ? totalAnnualIncomeTarget / totalValueTarget : 0,
      annual_income: roundCurrency(totalAnnualIncomeTarget),
      dgr_5y: dgr5yCount > 0 ? dgr5yTotal / dgr5yCount : 0,
      currency: targetCurrency,
    },
    positions: enrichedPositions,
  };
}

/**
 * Creates a dividend position for the authenticated user's household.
 * Security: household_id is resolved from the session and enforced by RLS.
 */
export async function createDividendPosition(
  payload: DividendPositionPayload,
): Promise<DividendPositionResult> {
  const normalized = normalizePositionPayload(payload);
  if ('error' in normalized) return { ok: false, error: normalized.error };

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No active household found for your account' };
  }

  if (!(await dividendAccountExists(normalized.account, householdId))) {
    return { ok: false, error: 'Dividend account not found' };
  }

  const { data, error } = await supabase
    .from('dividend_positions')
    .insert({ ...normalized, household_id: householdId })
    .select('id, account, ticker, shares')
    .single();

  if (error || !data) {
    console.error('[createDividendPosition] insert error:', error?.message);
    return { ok: false, error: 'Failed to create position. Please try again.' };
  }

  return { ok: true, position: toDividendPosition(data as DividendPositionRow) };
}

/** Updates a dividend position in the authenticated user's household. */
export async function updateDividendPosition(
  id: number,
  patch: DividendPositionPatch,
): Promise<DividendPositionResult> {
  const positionId = Number(id);
  if (!Number.isInteger(positionId) || positionId <= 0) {
    return { ok: false, error: 'Invalid position id' };
  }

  const normalized = normalizePositionPatch(patch);
  if ('error' in normalized) return { ok: false, error: normalized.error };

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No active household found for your account' };
  }

  if (normalized.account && !(await dividendAccountExists(normalized.account, householdId))) {
    return { ok: false, error: 'Dividend account not found' };
  }

  const { data, error } = await supabase
    .from('dividend_positions')
    .update(normalized)
    .eq('id', positionId)
    .eq('household_id', householdId)
    .select('id, account, ticker, shares')
    .maybeSingle();

  if (error) {
    console.error('[updateDividendPosition] update error:', error.message);
    return { ok: false, error: 'Failed to update position. Please try again.' };
  }
  if (!data) return { ok: false, error: 'Position not found' };

  return { ok: true, position: toDividendPosition(data as DividendPositionRow) };
}

/** Deletes a dividend position from the authenticated user's household. */
export async function deleteDividendPosition(
  id: number,
): Promise<DeleteDividendPositionResult> {
  const positionId = Number(id);
  if (!Number.isInteger(positionId) || positionId <= 0) {
    return { ok: false, error: 'Invalid position id' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No active household found for your account' };
  }

  const { data, error } = await supabase
    .from('dividend_positions')
    .delete()
    .eq('id', positionId)
    .eq('household_id', householdId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[deleteDividendPosition] delete error:', error.message);
    return { ok: false, error: 'Failed to delete position. Please try again.' };
  }
  if (!data) return { ok: false, error: 'Position not found' };

  return { ok: true };
}

/**
 * Returns all dividend account names for the authenticated user's household.
 * Queries `dividend_accounts` first; falls back to `trading_account_config`
 * names when no dividend-specific accounts have been set up yet.
 * Returns empty array on auth failure (graceful degradation for UI).
 */
export async function getDividendAccounts(): Promise<string[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return [];

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return [];

  // Primary: explicit dividend_accounts for this household.
  const { data, error } = await supabase
    .from('dividend_accounts')
    .select('name')
    .eq('household_id', householdId)
    .is('deleted_at', null);

  if (error) {
    console.error('[getDividendAccounts] query error:', error.message);
  }

  if (data && data.length > 0) {
    return (data as Array<{ name: string }>).map((a) => a.name);
  }

  // Fallback: derive account names from trading_account_config (RLS enforces household).
  const { data: tradingConfigs, error: tradingError } = await supabase
    .from('trading_account_config')
    .select('name')
    .is('deleted_at', null)
    .order('id', { ascending: true });

  if (tradingError) {
    console.error('[getDividendAccounts] trading config fallback error:', tradingError.message);
    return [];
  }

  return (tradingConfigs ?? [])
    .map((c: { name: string | null }) => c.name ?? '')
    .filter(Boolean);
}

/**
 * Returns investment accounts from the latest finance snapshot that are
 * eligible to be linked (category=Investments, not already linked).
 */
export async function getImportableAccounts(): Promise<ImportableAccount[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return [];

  // Collect already-linked IDs (RLS filters to household automatically).
  const { data: existing } = await supabase
    .from('dividend_accounts')
    .select('linked_id')
    .not('linked_id', 'is', null);

  const linkedIds = new Set(
    (existing ?? []).map((a: { linked_id: number | null }) => String(a.linked_id)),
  );

  // Fetch the most-recent finance snapshot.
  const { data: snapRow, error: snapError } = await supabase
    .from('finance_snapshots')
    .select('data')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapError || !snapRow?.data) return [];

  const snapshotData = snapRow.data as { items?: Array<Record<string, unknown>> };
  if (!Array.isArray(snapshotData.items)) return [];

  return snapshotData.items
    .filter(
      (item) =>
        item.category === 'Investments' && !linkedIds.has(String(item.id)),
    )
    .map((item) => ({
      id: String(item.id),
      name: String(item.name ?? ''),
      type: String(item.type ?? 'Unknown'),
      details: (item.details as Record<string, unknown>) ?? null,
    }));
}

/**
 * Creates an empty dividend account for the authenticated user's household.
 *
 * Security: household_id resolved from session, never from caller input.
 */
export async function createDividendAccount(
  name: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) return { ok: false, error: 'Name must not be empty' };
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No active household found for your account' };
  }

  // Guard against duplicates within the household.
  const { data: existingRow } = await supabase
    .from('dividend_accounts')
    .select('name')
    .eq('name', trimmedName)
    .eq('household_id', householdId)
    .maybeSingle();

  if (existingRow) return { ok: false, error: 'Account already exists' };

  const { error: insertError } = await supabase
    .from('dividend_accounts')
    .insert({ name: trimmedName, household_id: householdId });

  if (insertError) {
    console.error('[createDividendAccount] insert error:', insertError.message);
    return { ok: false, error: 'Failed to create account. Please try again.' };
  }

  return { ok: true, name: trimmedName };
}

/**
 * Imports a finance-snapshot investment as a linked dividend account.
 * If the item has RSU grants with vested shares, auto-creates a position row.
 *
 * Errors (400-equivalent):
 *   - Account name already exists in household
 *   - linked_id already used in household
 */
export async function importDividendAccount(
  linkedId: string,
  name: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const validLinkedId = typeof linkedId === 'string' ? linkedId.trim() : '';
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!validLinkedId) return { ok: false, error: 'Linked ID must not be empty' };
  if (!trimmedName) return { ok: false, error: 'Name must not be empty' };

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No active household found for your account' };
  }

  // Guard: duplicate account name.
  const { data: existingName } = await supabase
    .from('dividend_accounts')
    .select('name')
    .eq('name', trimmedName)
    .eq('household_id', householdId)
    .maybeSingle();

  if (existingName) return { ok: false, error: 'Account name already exists' };

  // Guard: linked_id already in use — compare as string to handle int/string mismatch.
  const { data: existingRows } = await supabase
    .from('dividend_accounts')
    .select('linked_id')
    .eq('household_id', householdId)
    .not('linked_id', 'is', null);

  const alreadyLinked = (existingRows ?? []).some(
    (r: { linked_id: number | null }) => String(r.linked_id) === validLinkedId,
  );
  if (alreadyLinked) return { ok: false, error: 'This investment account is already linked' };

  // Fetch latest snapshot for RSU auto-position logic.
  const { data: snapRow } = await supabase
    .from('finance_snapshots')
    .select('data')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Insert the account row.
  const { error: insertError } = await supabase
    .from('dividend_accounts')
    .insert({ name: trimmedName, linked_id: validLinkedId, household_id: householdId });

  if (insertError) {
    console.error('[importDividendAccount] insert error:', insertError.message);
    return { ok: false, error: 'Failed to import account. Please try again.' };
  }

  // Auto-populate RSU positions when applicable.
  if (snapRow?.data) {
    const snapshotData = snapRow.data as { items?: Array<Record<string, unknown>> };
    if (Array.isArray(snapshotData.items)) {
      const item = snapshotData.items.find((i) => String(i.id) === validLinkedId);
      if (item?.details) {
        const details = item.details as Record<string, unknown>;
        const stockSymbol = details.stock_symbol as string | undefined;
        const grants = Array.isArray(details.rsu_grants) ? details.rsu_grants : [];

        let totalShares = 0;
        for (const g of grants as Array<Record<string, unknown>>) {
          totalShares += Number(g.vested ?? 0);
        }

        if (stockSymbol && totalShares > 0) {
          const { error: posError } = await supabase
            .from('dividend_positions')
            .insert({
              account: trimmedName,
              ticker: stockSymbol,
              shares: totalShares,
              household_id: householdId,
            });

          if (posError) {
            // Non-fatal: account was created; log for visibility.
            console.error('[importDividendAccount] position insert error:', posError.message);
          }
        }
      }
    }
  }

  return { ok: true, name: trimmedName };
}

/**
 * Deletes a dividend account and all its positions.
 * If the account was linked to a finance snapshot item, zeroes out
 * that item's `details.dividend_yield` in the latest snapshot.
 */
export async function deleteDividendAccount(
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) return { ok: false, error: 'Name must not be empty' };
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No active household found for your account' };
  }

  // Fetch the account to get its linked_id before deleting.
  const { data: account, error: fetchError } = await supabase
    .from('dividend_accounts')
    .select('name, linked_id')
    .eq('name', trimmedName)
    .eq('household_id', householdId)
    .maybeSingle();

  if (fetchError || !account) {
    return { ok: false, error: 'Account not found' };
  }

  const linkedId = (account as { linked_id: number | null }).linked_id;

  // Delete associated positions first.
  const { error: posDeleteError } = await supabase
    .from('dividend_positions')
    .delete()
    .eq('account', trimmedName)
    .eq('household_id', householdId);

  if (posDeleteError) {
    console.error('[deleteDividendAccount] positions delete error:', posDeleteError.message);
    return { ok: false, error: 'Failed to delete account positions.' };
  }

  // Delete the account row.
  const { error: deleteError } = await supabase
    .from('dividend_accounts')
    .delete()
    .eq('name', trimmedName)
    .eq('household_id', householdId);

  if (deleteError) {
    console.error('[deleteDividendAccount] delete error:', deleteError.message);
    return { ok: false, error: 'Failed to delete account. Please try again.' };
  }

  // If linked, zero out dividend_yield in the latest snapshot item.
  if (linkedId != null) {
    const { data: snapRow } = await supabase
      .from('finance_snapshots')
      .select('date, data')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapRow?.data) {
      const snapshotData = snapRow.data as { items?: Array<Record<string, unknown>> };
      if (Array.isArray(snapshotData.items)) {
        let mutated = false;
        for (const item of snapshotData.items) {
          if (String(item.id) === String(linkedId)) {
            if (!item.details || typeof item.details !== 'object') {
              item.details = {};
            }
            (item.details as Record<string, unknown>).dividend_yield = 0;
            mutated = true;
            break;
          }
        }

        if (mutated) {
          const { error: snapUpdateError } = await supabase
            .from('finance_snapshots')
            .update({ data: snapshotData })
            .eq('household_id', householdId)
            .eq('date', (snapRow as { date: string }).date);

          if (snapUpdateError) {
            // Non-fatal: account and positions were deleted successfully.
            console.error(
              '[deleteDividendAccount] snapshot update error:',
              snapUpdateError.message,
            );
          }
        }
      }
    }
  }

  return { ok: true };
}

// ── Dividend Estimations (Issue #339) ────────────────────────────────────────

export interface DividendEstimation {
  year: number;
  amount: number;
}

export type DividendEstimationsResult =
  | { ok: true; data: DividendEstimation[] }
  | { ok: false; error: string };

export type SaveDividendEstimationsResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Fetches all dividend estimations for the authenticated user's household.
 */
export async function getDividendEstimations(): Promise<DividendEstimationsResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No household found' };
  }

  const { data, error } = await supabase
    .from('dividend_estimations')
    .select('year, amount')
    .eq('household_id', householdId)
    .order('year', { ascending: true });

  if (error) {
    console.error('[getDividendEstimations] query error:', error.message);
    return { ok: false, error: error.message };
  }

  const estimations: DividendEstimation[] = (data ?? []).map(row => ({
    year: Number(row.year),
    amount: toNumber(row.amount),
  }));

  return { ok: true, data: estimations };
}

/**
 * Saves (upserts) all dividend estimations for the authenticated user's household.
 * Replaces existing data completely: deletes all current rows, then inserts the new set.
 */
export async function saveDividendEstimations(
  estimations: DividendEstimation[]
): Promise<SaveDividendEstimationsResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No household found' };
  }

  // Validate input
  for (const est of estimations) {
    if (!Number.isInteger(est.year)) {
      return { ok: false, error: `Invalid year: ${est.year}` };
    }
    const amount = Number(est.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, error: `Invalid amount for year ${est.year}` };
    }
  }

  // Delete all existing estimations for this household
  const { error: deleteError } = await supabase
    .from('dividend_estimations')
    .delete()
    .eq('household_id', householdId);

  if (deleteError) {
    console.error('[saveDividendEstimations] delete error:', deleteError.message);
    return { ok: false, error: deleteError.message };
  }

  // Insert new estimations (if any)
  if (estimations.length > 0) {
    const rows = estimations.map(est => ({
      household_id: householdId,
      year: est.year,
      amount: est.amount,
    }));

    const { error: insertError } = await supabase
      .from('dividend_estimations')
      .insert(rows);

    if (insertError) {
      console.error('[saveDividendEstimations] insert error:', insertError.message);
      return { ok: false, error: insertError.message };
    }
  }

  return { ok: true };
}
