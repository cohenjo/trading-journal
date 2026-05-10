'use server';

import { createClient } from '@/lib/supabase/server';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TradingAccountType = 'IBKR' | 'SCHWAB' | 'ibkr' | 'schwab' | 'ira';

/** Canonical lowercase type used for Phase 2 3-account UI. */
export type Phase2AccountType = 'ibkr' | 'schwab' | 'ira';

export interface TradingAccountConfig {
  id: number;
  name: string | null;
  account_type: TradingAccountType;
  host: string;
  port: number;
  client_id: number;
  linked_account_id: string | null;
  account_id: string | null;
  last_synced: string | null;
  compute_options_income: boolean;
}

export interface TradingAccountConfigInput {
  id?: number | null;
  name: string;
  account_type: string;
  host?: string | null;
  port?: number | string | null;
  client_id?: number | string | null;
  linked_account_id?: string | null;
  account_id?: string | null;
  compute_options_income?: boolean | null;
  // Legacy Schwab credential fields may still be present in callers, but the
  // Supabase schema intentionally does not persist broker secrets.
  app_key?: string | null;
  app_secret?: string | null;
  account_hash?: string | null;
  tokens_path?: string | null;
}

export interface TradingAccountSummary {
  id: number;
  account_config_id: number | null;
  net_liquidation: number;
  total_cash: number;
  currency: string;
  timestamp: string;
}

export interface TradingPosition {
  id: number;
  account_config_id: number | null;
  symbol: string;
  amount: number;
  sec_type: string;
  avg_cost: number;
  con_id: number | null;
  timestamp: string;
}

export type TradingConfigResult =
  | { ok: true; config: TradingAccountConfig }
  | { ok: false; error: string };

const CONFIG_SELECT = [
  'id',
  'name',
  'account_type',
  'host',
  'port',
  'client_id',
  'linked_account_id',
  'account_id',
  'last_synced',
  'compute_options_income',
].join(', ');

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

function normalizeAccountType(value: string): TradingAccountType {
  return value === 'SCHWAB' ? 'SCHWAB' : 'IBKR';
}

function normalizeText(value: string | null | undefined, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function normalizeNumber(value: number | string | null | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeConfigInput(input: TradingAccountConfigInput, householdId: string) {
  return {
    name: normalizeText(input.name, 'My Trading Account'),
    account_type: normalizeAccountType(input.account_type),
    host: normalizeText(input.host, '127.0.0.1'),
    port: normalizeNumber(input.port, 4001),
    client_id: normalizeNumber(input.client_id, 1),
    linked_account_id: normalizeOptionalText(input.linked_account_id),
    compute_options_income: input.compute_options_income ?? true,
    household_id: householdId,
  };
}

function coerceNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function coerceSummary(row: Record<string, unknown>): TradingAccountSummary {
  return {
    id: coerceNumber(row.id as number | string),
    account_config_id: row.account_config_id == null ? null : coerceNumber(row.account_config_id as number | string),
    net_liquidation: coerceNumber(row.net_liquidation as number | string),
    total_cash: coerceNumber(row.total_cash as number | string),
    currency: String(row.currency ?? 'USD'),
    timestamp: String(row.timestamp ?? ''),
  };
}

function coercePosition(row: Record<string, unknown>): TradingPosition {
  return {
    id: coerceNumber(row.id as number | string),
    account_config_id: row.account_config_id == null ? null : coerceNumber(row.account_config_id as number | string),
    symbol: String(row.symbol ?? ''),
    amount: coerceNumber(row.amount as number | string),
    sec_type: String(row.sec_type ?? ''),
    avg_cost: coerceNumber(row.avg_cost as number | string),
    con_id: row.con_id == null ? null : coerceNumber(row.con_id as number | string),
    timestamp: String(row.timestamp ?? ''),
  };
}

// ── Server Actions ────────────────────────────────────────────────────────────

/**
 * Returns all trading account configurations visible to the authenticated user's
 * household. Supabase RLS enforces household isolation.
 */
export async function getTradingConfigs(): Promise<TradingAccountConfig[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return [];

  const { data, error } = await supabase
    .from('trading_account_config')
    .select(CONFIG_SELECT)
    .is('deleted_at', null)
    .order('id', { ascending: true });

  if (error) {
    console.error('[getTradingConfigs] query error:', error.message);
    return [];
  }

  return (data ?? []) as unknown as TradingAccountConfig[];
}

/**
 * Returns a single trading account configuration by ID, or the first available
 * configuration when no ID is provided.
 */
export async function getTradingConfig(id?: number | null): Promise<TradingAccountConfig | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  let query = supabase
    .from('trading_account_config')
    .select(CONFIG_SELECT)
    .is('deleted_at', null)
    .limit(1);

  if (id) query = query.eq('id', id);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('[getTradingConfig] query error:', error.message);
    return null;
  }

  return data as unknown as TradingAccountConfig | null;
}

/**
 * Creates or updates a trading account configuration for the authenticated
 * user's household. Caller-provided household IDs and broker secrets are ignored.
 */
export async function saveTradingConfig(input: TradingAccountConfigInput): Promise<TradingConfigResult> {
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

  const row = normalizeConfigInput(input, householdId);

  if (input.id) {
    const { data, error } = await supabase
      .from('trading_account_config')
      .update(row)
      .eq('id', input.id)
      .eq('household_id', householdId)
      .select(CONFIG_SELECT)
      .maybeSingle();

    if (error) {
      console.error('[saveTradingConfig] update error:', error.message);
      return { ok: false, error: 'Failed to update trading account settings.' };
    }
    if (!data) return { ok: false, error: 'Trading account not found' };

    return { ok: true, config: data as unknown as TradingAccountConfig };
  }

  const { data, error } = await supabase
    .from('trading_account_config')
    .insert(row)
    .select(CONFIG_SELECT)
    .single();

  if (error) {
    console.error('[saveTradingConfig] insert error:', error.message);
    return { ok: false, error: 'Failed to create trading account settings.' };
  }

  return { ok: true, config: data as unknown as TradingAccountConfig };
}

/**
 * Returns the latest trading account summary for the authenticated user's
 * household, optionally scoped to one trading account config.
 */
export async function getTradingSummary(accountId?: number | null): Promise<TradingAccountSummary | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  let query = supabase
    .from('trading_account_summary')
    .select('id, account_config_id, net_liquidation, total_cash, currency, timestamp')
    .is('deleted_at', null)
    .order('timestamp', { ascending: false })
    .limit(1);

  if (accountId) query = query.eq('account_config_id', accountId);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('[getTradingSummary] query error:', error.message);
    return null;
  }

  return data ? coerceSummary(data as Record<string, unknown>) : null;
}

// ── Stock Positions (Phase 2) ─────────────────────────────────────────────────

/** A single stock position row from `stock_positions`. */
export interface StockPosition {
  id: string;
  account_id: number;
  ticker: string;
  description: string | null;
  sub_category: string | null;
  quantity: number;
  cost_basis: number | null;
  mark_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  currency: string;
  as_of_date: string;
  source: 'flex' | 'manual';
}

export interface CreateStockPositionPayload {
  account_id: number;
  ticker: string;
  quantity: number;
  cost_basis?: number | null;
  as_of_date: string;
  currency?: string;
}

export type StockPositionResult =
  | { ok: true; position: StockPosition }
  | { ok: false; error: string };

export type DeleteStockPositionResult =
  | { ok: true }
  | { ok: false; error: string };

export interface DividendProjectionResult {
  total_annual: number;
  by_ticker: Array<{ ticker: string; annual_income: number }>;
  by_account: Array<{ account_id: number; annual_income: number }>;
}

function coerceStockPosition(row: Record<string, unknown>): StockPosition {
  return {
    id: String(row.id ?? ''),
    account_id: coerceNumber(row.account_id as number | string),
    ticker: String(row.ticker ?? ''),
    description: row.description != null ? String(row.description) : null,
    sub_category: row.sub_category != null ? String(row.sub_category) : null,
    quantity: coerceNumber(row.quantity as number | string),
    cost_basis: row.cost_basis != null ? coerceNumber(row.cost_basis as number | string) : null,
    mark_price: row.mark_price != null ? coerceNumber(row.mark_price as number | string) : null,
    market_value: row.market_value != null ? coerceNumber(row.market_value as number | string) : null,
    unrealized_pnl: row.unrealized_pnl != null ? coerceNumber(row.unrealized_pnl as number | string) : null,
    currency: String(row.currency ?? 'USD'),
    as_of_date: String(row.as_of_date ?? ''),
    source: row.source === 'manual' ? 'manual' : 'flex',
  };
}

/**
 * Deduplicates stock positions by source-aware snapshot semantics.
 *
 * Flex positions: only tickers present in the *latest* Flex snapshot date for
 * each account are returned.  Tickers absent from the latest snapshot (e.g.
 * stocks the user has sold) are excluded — not surfaced as "latest for that
 * ticker" from an older snapshot.  This matches the max_flex_snap CTE in the
 * backend's list_positions endpoint.
 *
 * Manual positions (Schwab / LeumiIRA): keep the latest entry per
 * (account_id, ticker), since manual rows are edited in-place without
 * snapshot semantics.
 *
 * Previously used latest-per-ticker for all sources, which caused stale
 * holdings (AMZN, ARCC, ARDC, CVS etc.) to appear after Jony sold them.
 * Fixed per Bug-1 report, 2026-05-10.
 */
function dedupeLatestSnapshot(rows: StockPosition[]): StockPosition[] {
  // Step 1: find the latest flex snapshot date per account.
  const latestFlexDateByAccount = new Map<number, string>();
  for (const row of rows) {
    if (row.source === 'flex') {
      const existing = latestFlexDateByAccount.get(row.account_id);
      if (!existing || (row.as_of_date && row.as_of_date > existing)) {
        latestFlexDateByAccount.set(row.account_id, row.as_of_date);
      }
    }
  }

  const map = new Map<string, StockPosition>();
  for (const row of rows) {
    const key = `${row.account_id}:${row.ticker}`;
    if (row.source === 'flex') {
      const latestDate = latestFlexDateByAccount.get(row.account_id);
      // Exclude flex rows that don't belong to the latest snapshot for this account.
      if (row.as_of_date !== latestDate) continue;
      map.set(key, row);
    } else {
      // Manual: keep latest per (account_id, ticker).
      const existing = map.get(key);
      if (!existing || (row.as_of_date && row.as_of_date > existing.as_of_date)) {
        map.set(key, row);
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * Returns stock positions for the authenticated user's household,
 * optionally scoped to one account. Only the latest snapshot per
 * (account_id, ticker) is returned — historical year-end snapshots
 * from Flex imports are deduplicated here to prevent duplicate rows
 * from appearing in the UI. Returns [] gracefully if the
 * stock_positions table doesn't exist yet (pre-migration).
 */
export async function getStockPositions(accountId?: number | null): Promise<StockPosition[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return [];

  let query = supabase
    .from('stock_positions')
    .select('id, account_id, ticker, description, sub_category, quantity, cost_basis, mark_price, market_value, unrealized_pnl, currency, as_of_date, source')
    .order('ticker', { ascending: true });

  if (accountId) query = query.eq('account_id', accountId);

  const { data, error } = await query;

  if (error) {
    // Table may not exist yet — degrade gracefully
    console.warn('[getStockPositions] query error (table may be pre-migration):', error.message);
    return [];
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(coerceStockPosition);
  return dedupeLatestSnapshot(rows);
}

/**
 * Creates a manual stock position (Schwab/IRA).
 * Security: household_id is resolved from session; source is always 'manual'.
 */
export async function createStockPosition(
  payload: CreateStockPositionPayload,
): Promise<StockPositionResult> {
  if (!payload.ticker?.trim()) return { ok: false, error: 'Ticker must not be empty' };
  if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
    return { ok: false, error: 'Quantity must be greater than 0' };
  }
  if (!payload.as_of_date) return { ok: false, error: 'As-of date is required' };

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return { ok: false, error: 'No active household found' };

  const { data, error } = await supabase
    .from('stock_positions')
    .insert({
      household_id: householdId,
      account_id: payload.account_id,
      ticker: payload.ticker.trim().toUpperCase(),
      quantity: payload.quantity,
      cost_basis: payload.cost_basis ?? null,
      as_of_date: payload.as_of_date,
      currency: payload.currency ?? 'USD',
      source: 'manual',
    })
    .select('id, account_id, ticker, description, sub_category, quantity, cost_basis, mark_price, market_value, unrealized_pnl, currency, as_of_date, source')
    .single();

  if (error) {
    console.error('[createStockPosition] insert error:', error.message);
    return { ok: false, error: 'Failed to create position' };
  }

  return { ok: true, position: coerceStockPosition(data as Record<string, unknown>) };
}

/**
 * Deletes a manual stock position by ID.
 */
export async function deleteStockPosition(id: string): Promise<DeleteStockPositionResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('stock_positions')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[deleteStockPosition] delete error:', error.message);
    return { ok: false, error: 'Failed to delete position' };
  }

  return { ok: true };
}

/**
 * Returns distinct ticker symbols from dividend_ticker_data for autocomplete.
 */
export async function getTickerSymbols(): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('dividend_ticker_data')
    .select('ticker')
    .order('ticker', { ascending: true });

  if (error) {
    console.warn('[getTickerSymbols] query error:', error.message);
    return [];
  }

  const tickers = [...new Set(((data ?? []) as Array<{ ticker: string }>).map(r => r.ticker))];
  return tickers;
}

/**
 * Triggers an IBKR Flex re-sync for the specified account.
 * Returns ok:true if the sync was accepted; errors degrade gracefully.
 */
export async function triggerIBKRSync(accountId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/accounts/${accountId}/sync`, { method: 'POST' });
    if (!res.ok) return { ok: false, error: `Sync request failed (${res.status})` };
    return { ok: true };
  } catch (err) {
    console.error('[triggerIBKRSync] fetch error:', err);
    return { ok: false, error: 'Unable to reach sync endpoint' };
  }
}

/**
 * Fetches the dividend projection from Hockney's new endpoint.
 * Returns null on any network/parse error so callers can fall back gracefully.
 */
export async function getDividendProjection(): Promise<DividendProjectionResult | null> {
  try {
    const res = await fetch('/api/dividends/projection');
    if (!res.ok) return null;
    const json = await res.json() as unknown;
    if (
      typeof json === 'object' && json !== null &&
      'total_annual' in json && typeof (json as Record<string, unknown>).total_annual === 'number'
    ) {
      return json as DividendProjectionResult;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getTradingPositions(accountId?: number | null): Promise<TradingPosition[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return [];

  let query = supabase
    .from('trading_positions')
    .select('id, account_config_id, symbol, amount, sec_type, avg_cost, con_id, timestamp')
    .is('deleted_at', null)
    .order('symbol', { ascending: true });

  if (accountId) query = query.eq('account_config_id', accountId);

  const { data, error } = await query;

  if (error) {
    console.error('[getTradingPositions] query error:', error.message);
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map(coercePosition);
}
