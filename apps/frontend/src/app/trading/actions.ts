'use server';

import { createClient } from '@/lib/supabase/server';
import { normalizeAccountType } from '@/lib/trading/account-type';

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

function normalizeConfigInput(
  input: TradingAccountConfigInput,
  householdId: string,
  validatedType: string,
) {
  return {
    name: normalizeText(input.name, 'My Trading Account'),
    // Caller must already have validated via normalizeAccountType().
    // We store the pre-validated lowercase value directly.
    account_type: validatedType,
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

  // Validate account_type — normalize case then reject unknowns before any DB write.
  const validatedType = normalizeAccountType(input.account_type);
  if (!validatedType) {
    return {
      ok: false,
      error: `Invalid account type "${input.account_type ?? ''}". Must be one of: ibkr, schwab, ira.`,
    };
  }

  const row = normalizeConfigInput(input, householdId, validatedType);

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

  // Duplicate prevention — only one config row per account_type per household.
  // RLS on trading_account_config already scopes this query to the user's household.
  const { data: existing } = await supabase
    .from('trading_account_config')
    .select('id')
    .eq('account_type', validatedType)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const labels: Record<string, string> = { ibkr: 'InteractiveBrokers', schwab: 'Schwab', ira: 'LeumiIRA' };
    return {
      ok: false,
      error: `${labels[validatedType]} account is already configured for this household.`,
    };
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
  /** Broker-stamped local-currency market value (ILS for TASE positions). Used
   *  as a fallback when the Yahoo worker has not yet populated market_value. */
  market_value_local: number | null;
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

export interface UpdateStockPositionPayload {
  ticker?: string;
  quantity?: number;
  cost_basis?: number | null;
  as_of_date?: string;
  currency?: string;
}

export type StockPositionResult =
  | { ok: true; position: StockPosition }
  | { ok: false; error: string };

export type DeleteStockPositionResult =
  | { ok: true }
  | { ok: false; error: string };

export type ImportStockPositionsResult =
  | { ok: true; imported: number }
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
    market_value_local: row.market_value_local != null ? coerceNumber(row.market_value_local as number | string) : null,
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
    .select('id, account_id, ticker, description, sub_category, quantity, cost_basis, mark_price, market_value, market_value_local, unrealized_pnl, currency, as_of_date, source')
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
    .select('id, account_id, ticker, description, sub_category, quantity, cost_basis, mark_price, market_value, market_value_local, unrealized_pnl, currency, as_of_date, source')
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
 * Updates an existing manual stock position by ID.
 * Only fields present in the payload are modified. The row must belong to the
 * authenticated user's household (enforced by Supabase RLS).
 */
export async function updateStockPosition(
  id: string,
  payload: UpdateStockPositionPayload,
): Promise<StockPositionResult> {
  if (!id) return { ok: false, error: 'Position ID is required' };

  const updates: Record<string, unknown> = {};
  if (payload.ticker !== undefined) {
    const t = payload.ticker.trim().toUpperCase();
    if (!t) return { ok: false, error: 'Ticker must not be empty' };
    updates.ticker = t;
  }
  if (payload.quantity !== undefined) {
    if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
      return { ok: false, error: 'Quantity must be greater than 0' };
    }
    updates.quantity = payload.quantity;
  }
  if ('cost_basis' in payload) updates.cost_basis = payload.cost_basis ?? null;
  if (payload.as_of_date !== undefined) updates.as_of_date = payload.as_of_date;
  if (payload.currency !== undefined) updates.currency = payload.currency;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('stock_positions')
    .update(updates)
    .eq('id', id)
    .select('id, account_id, ticker, description, sub_category, quantity, cost_basis, mark_price, market_value, market_value_local, unrealized_pnl, currency, as_of_date, source')
    .single();

  if (error) {
    console.error('[updateStockPosition] update error:', error.message);
    return { ok: false, error: 'Failed to update position' };
  }

  return { ok: true, position: coerceStockPosition(data as Record<string, unknown>) };
}

/**
 * Imports manual stock positions from a CSV file (Leumi enriched or Schwab format)
 * directly into Supabase — no FastAPI proxy required.
 *
 * Expected CSV header (enriched format produced by holdingsToCsv / parseSchwabCsv):
 *   ticker,quantity,average_cost,currency,as_of_date,description,mark_price,
 *   market_value,market_value_local,dividend_yield,cost_basis_total,unrealized_pnl
 *
 * RLS policy is satisfied by the user-scoped createClient() — the calling user
 * must be a household writer for the target account's household_id.
 */
export async function importManualPositionsCsv(
  accountId: number,
  formData: FormData,
): Promise<ImportStockPositionsResult> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) return { ok: false, error: 'Not authenticated' };

    const householdId = await resolveHouseholdId(user.id);
    if (!householdId) return { ok: false, error: 'No active household found' };

    // Get account's household_id to confirm access (RLS enforces this on write too,
    // but an early check gives a clear error message).
    const { data: acct, error: acctErr } = await supabase
      .from('trading_account_config')
      .select('id')
      .eq('id', accountId)
      .single();

    if (acctErr || !acct) return { ok: false, error: 'Account not found or access denied' };

    const fileEntry = formData.get('file');
    if (!fileEntry || typeof fileEntry === 'string') {
      return { ok: false, error: 'No file provided' };
    }

    const csvText = await (fileEntry as File).text();
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return { ok: false, error: 'CSV is empty or has no data rows' };

    const headerLine = lines[0];
    const hasEnrichedHeader = headerLine.includes('description');

    // Parse header to determine column positions dynamically.
    const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
    const col = (name: string) => headers.indexOf(name);

    const idxTicker = col('ticker');
    const idxQty = col('quantity');
    const idxAvgCost = col('average_cost');
    const idxCurrency = col('currency');
    const idxDate = col('as_of_date');
    const idxDesc = col('description');
    const idxMarkPrice = col('mark_price');
    const idxMktVal = col('market_value');
    const idxMktValLocal = col('market_value_local');
    const idxDivYld = col('dividend_yield');
    const idxCostBasis = col('cost_basis_total');
    const idxUnrealizedPnl = col('unrealized_pnl');

    if (idxTicker === -1 || idxQty === -1) {
      return { ok: false, error: 'CSV is missing required columns (ticker, quantity)' };
    }

    const ext = hasEnrichedHeader ? 'enriched CSV' : 'CSV';
    console.log('[trading-import] received', ext, 'file, size=', csvText.length, 'account=', accountId);

    /**
     * Minimal RFC-4180 field extractor — handles double-quoted fields with
     * embedded commas and escaped double-quotes.
     */
    function parseField(fields: string[], idx: number): string {
      if (idx === -1 || idx >= fields.length) return '';
      const raw = fields[idx].trim();
      if (raw.startsWith('"') && raw.endsWith('"')) {
        return raw.slice(1, -1).replace(/""/g, '"');
      }
      return raw;
    }

    /**
     * Split a CSV line respecting double-quoted fields that may contain commas.
     */
    function splitCsvLine(line: string): string[] {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
            current += ch;
          }
        } else if (ch === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current);
      return result;
    }

    function parseOptionalNumber(s: string): number | null {
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }

    const rows = lines.slice(1).map(line => {
      const fields = splitCsvLine(line);
      const ticker = parseField(fields, idxTicker);
      const quantity = parseOptionalNumber(parseField(fields, idxQty)) ?? 0;
      const average_cost = parseOptionalNumber(parseField(fields, idxAvgCost));
      const currency = parseField(fields, idxCurrency) || 'USD';
      const as_of_date = parseField(fields, idxDate) || new Date().toISOString().slice(0, 10);
      const description = idxDesc !== -1 ? parseField(fields, idxDesc) || null : null;
      const mark_price = idxMarkPrice !== -1 ? parseOptionalNumber(parseField(fields, idxMarkPrice)) : null;
      const market_value = idxMktVal !== -1 ? parseOptionalNumber(parseField(fields, idxMktVal)) : null;
      const market_value_local = idxMktValLocal !== -1 ? parseOptionalNumber(parseField(fields, idxMktValLocal)) : null;
      const dividend_yield = idxDivYld !== -1 ? parseOptionalNumber(parseField(fields, idxDivYld)) : null;
      const cost_basis_total = idxCostBasis !== -1 ? parseOptionalNumber(parseField(fields, idxCostBasis)) : null;
      const unrealized_pnl = idxUnrealizedPnl !== -1 ? parseOptionalNumber(parseField(fields, idxUnrealizedPnl)) : null;

      return {
        ticker,
        quantity,
        cost_basis: average_cost,
        currency,
        as_of_date,
        description,
        mark_price,
        market_value,
        market_value_local,
        dividend_yield,
        cost_basis_total,
        unrealized_pnl,
        account_id: accountId,
        household_id: householdId,
        source: 'manual' as const,
      };
    }).filter(r => r.ticker && r.quantity > 0);

    if (rows.length === 0) return { ok: false, error: 'No valid positions found in CSV' };

    // Delete existing manual positions for this account before re-inserting.
    const { error: deleteErr } = await supabase
      .from('stock_positions')
      .delete()
      .eq('account_id', accountId)
      .eq('household_id', householdId)
      .eq('source', 'manual');

    if (deleteErr) {
      console.error('[importManualPositionsCsv] delete error:', deleteErr.message);
      return { ok: false, error: 'Failed to clear existing positions' };
    }

    const { error: insertErr } = await supabase
      .from('stock_positions')
      .insert(rows);

    if (insertErr) {
      console.error('[importManualPositionsCsv] insert error:', insertErr.message);
      return { ok: false, error: `Import failed: ${insertErr.message}` };
    }

    return { ok: true, imported: rows.length };
  } catch (err) {
    console.error('[importManualPositionsCsv] unexpected error:', err);
    return { ok: false, error: 'Import failed unexpectedly' };
  }
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

// ── Account refresh types ─────────────────────────────────────────────────────

/** Discriminated union returned by `triggerIBKRSync`. */
export type AccountRefreshResult =
  | { ok: true; status: 'queued'; last_synced_at: string | null; next_eligible_at: null }
  | { ok: true; status: 'throttled'; last_synced_at: string | null; next_eligible_at: string }
  | { ok: false; status: 'error'; error: string };

/**
 * Triggers a manual IBKR Flex refresh for the specified account config.
 *
 * Calls `POST /api/trading/accounts/{configId}/refresh` on the FastAPI
 * backend and returns a discriminated union so callers can branch on the
 * `status` field ("queued" | "throttled" | "error").
 *
 * HTTP 200 is used for both queued and throttled responses per the backend
 * contract (Section B of the refresh-button design doc).
 */
export async function triggerIBKRSync(configId: number): Promise<AccountRefreshResult> {
  try {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { ok: false, status: 'error', error: 'Not authenticated' };
    }

    const backendUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
    const res = await fetch(`${backendUrl}/api/trading/accounts/${configId}/refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (res.status === 403) {
      return { ok: false, status: 'error', error: 'You do not have permission to refresh this account.' };
    }
    if (res.status === 404) {
      return { ok: false, status: 'error', error: 'Account not found.' };
    }
    if (!res.ok) {
      return { ok: false, status: 'error', error: `Refresh request failed (${res.status})` };
    }

    const json = await res.json() as unknown;

    if (
      typeof json === 'object' &&
      json !== null &&
      'status' in json
    ) {
      const body = json as Record<string, unknown>;

      if (body.status === 'queued') {
        return {
          ok: true,
          status: 'queued',
          last_synced_at: typeof body.last_synced_at === 'string' ? body.last_synced_at : null,
          next_eligible_at: null,
        };
      }

      if (body.status === 'throttled' && typeof body.next_eligible_at === 'string') {
        return {
          ok: true,
          status: 'throttled',
          last_synced_at: typeof body.last_synced_at === 'string' ? body.last_synced_at : null,
          next_eligible_at: body.next_eligible_at,
        };
      }
    }

    return { ok: false, status: 'error', error: 'Unexpected response from refresh endpoint' };
  } catch (err) {
    console.error('[triggerIBKRSync] fetch error:', err);
    return { ok: false, status: 'error', error: 'Unable to reach refresh endpoint' };
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
