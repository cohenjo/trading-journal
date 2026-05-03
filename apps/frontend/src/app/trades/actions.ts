'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type CreateTradeResult =
  | { ok: true; trade: Record<string, unknown> }
  | { ok: false; error: string };

export type TradePayload = Record<string, unknown>;

interface ManualTradeRow {
  timestamp: string;
  symbol: string;
  side: string;
  size: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  notes: string | null;
}

async function requireHouseholdId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.household_id as string;
}

function isoDateFromTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function finiteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isFullTradePayload(payload: TradePayload): boolean {
  return payload.tradeID !== undefined && typeof payload.dateTime === 'string';
}

function normalizeManualTrade(payload: TradePayload): ManualTradeRow | { error: string } {
  const timestamp = typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString();
  if (!isoDateFromTimestamp(timestamp)) return { error: 'Trade timestamp is invalid' };

  const symbol = typeof payload.symbol === 'string' ? payload.symbol.trim().toUpperCase() : '';
  const side = typeof payload.side === 'string' ? payload.side.trim().toLowerCase() : '';
  const size = finiteNumber(payload.size);
  const entryPrice = finiteNumber(payload.entry_price);
  const exitPrice = finiteNumber(payload.exit_price);
  const pnl = finiteNumber(payload.pnl);

  if (!symbol) return { error: 'Symbol is required' };
  if (!['buy', 'sell'].includes(side)) return { error: 'Side must be buy or sell' };
  if (size === null || entryPrice === null || exitPrice === null || pnl === null) {
    return { error: 'Trade size, prices, and P&L must be valid numbers' };
  }

  return {
    timestamp,
    symbol,
    side,
    size,
    entry_price: entryPrice,
    exit_price: exitPrice,
    pnl,
    notes: typeof payload.notes === 'string' ? payload.notes : null,
  };
}

async function recalculateDailySummary(householdId: string, date: string): Promise<void> {
  const supabase = await createClient();
  const endDate = new Date(`${date}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString().slice(0, 10);

  const [tradeResult, manualTradeResult] = await Promise.all([
    supabase
      .from('trade')
      .select('fifoPnlRealized')
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .gte('dateTime', date)
      .lt('dateTime', end),
    supabase
      .from('manualtrade')
      .select('pnl')
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .gte('timestamp', date)
      .lt('timestamp', end),
  ]);

  if (tradeResult.error) console.error('[createTrade] trade summary query error:', tradeResult.error.message);
  if (manualTradeResult.error) console.error('[createTrade] manual summary query error:', manualTradeResult.error.message);

  const pnls = [
    ...((tradeResult.data ?? []) as Record<string, unknown>[]).map((row) => Number(row.fifoPnlRealized ?? 0)),
    ...((manualTradeResult.data ?? []) as Record<string, unknown>[]).map((row) => Number(row.pnl ?? 0)),
  ].filter(Number.isFinite);

  const totalPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);
  const winningPnls = pnls.filter((pnl) => pnl > 0);
  const losingPnls = pnls.filter((pnl) => pnl <= 0);
  const totalTrades = winningPnls.length + losingPnls.length;

  const summaryRow = {
    date,
    household_id: householdId,
    total_pnl: totalPnl,
    winning_trades: winningPnls.length,
    losing_trades: losingPnls.length,
    win_rate: totalTrades > 0 ? winningPnls.length / totalTrades : 0,
    avg_win: winningPnls.length ? winningPnls.reduce((sum, pnl) => sum + pnl, 0) / winningPnls.length : 0,
    avg_loss: losingPnls.length ? losingPnls.reduce((sum, pnl) => sum + pnl, 0) / losingPnls.length : 0,
  };

  const { error } = await supabase
    .from('dailysummary')
    .upsert(summaryRow, { onConflict: 'date' });

  if (error) console.error('[createTrade] summary upsert error:', error.message);
}

/** Creates a trade for the authenticated household and refreshes the daily summary. */
export async function createTrade(payload: TradePayload): Promise<CreateTradeResult> {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid trade payload' };

  const householdId = await requireHouseholdId();
  if (!householdId) return { ok: false, error: 'Not authenticated' };

  const supabase = await createClient();

  if (isFullTradePayload(payload)) {
    const tradeDate = isoDateFromTimestamp(payload.dateTime);
    if (!tradeDate) return { ok: false, error: 'Trade dateTime cannot be null' };

    const { data, error } = await supabase
      .from('trade')
      .insert({ ...payload, household_id: householdId })
      .select('*')
      .single();

    if (error || !data) {
      console.error('[createTrade] insert error:', error?.message);
      return { ok: false, error: 'Failed to create trade. Please try again.' };
    }

    await recalculateDailySummary(householdId, tradeDate);
    revalidatePath('/');
    revalidatePath(`/day/${tradeDate}`);
    return { ok: true, trade: data as Record<string, unknown> };
  }

  const manualTrade = normalizeManualTrade(payload);
  if ('error' in manualTrade) return { ok: false, error: manualTrade.error };

  const tradeDate = isoDateFromTimestamp(manualTrade.timestamp);
  if (!tradeDate) return { ok: false, error: 'Trade timestamp is invalid' };

  const { data, error } = await supabase
    .from('manualtrade')
    .insert({ ...manualTrade, household_id: householdId })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[createTrade] manual insert error:', error?.message);
    return { ok: false, error: 'Failed to create trade. Please try again.' };
  }

  await recalculateDailySummary(householdId, tradeDate);
  revalidatePath('/');
  revalidatePath(`/day/${tradeDate}`);
  return { ok: true, trade: data as Record<string, unknown> };
}
