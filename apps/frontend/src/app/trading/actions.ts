'use server';

import { createClient } from '@/lib/supabase/server';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TradingAccountType = 'IBKR' | 'SCHWAB';

export interface TradingAccountConfig {
  id: number;
  name: string;
  account_type: TradingAccountType;
  host: string;
  port: number;
  client_id: number;
  linked_account_id: string | null;
  account_id: string | null;
  last_synced: string | null;
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

/**
 * Lists current trading positions for the authenticated user's household,
 * optionally scoped to one trading account config.
 */
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
