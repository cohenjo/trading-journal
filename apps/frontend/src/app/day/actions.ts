'use server';

import { createClient } from '@/lib/supabase/server';
import type { DailySummary } from '@/app/summary/actions';

export interface Note {
  content: string;
}

export interface MatchedTrade {
  id: number;
  symbol: string;
  open_date: string;
  close_date: string;
  open_price: number;
  close_price: number;
  pnl: number;
  notes?: string | null;
}

export interface DailyBar {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DayDetails {
  summary: DailySummary | null;
  trades: [];
  note: Note | null;
  matched_trades: MatchedTrade[];
  market_data: DailyBar | null;
}

async function requireSession(): Promise<{ userId: string; householdId: string } | null> {
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
  return { userId: user.id, householdId: data.household_id as string };
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function nextDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function normalizeSummary(row: Record<string, unknown> | null): DailySummary | null {
  if (!row) return null;
  return {
    date: String(row.date),
    total_pnl: Number(row.total_pnl ?? 0),
    winning_trades: Number(row.winning_trades ?? 0),
    losing_trades: Number(row.losing_trades ?? 0),
    win_rate: Number(row.win_rate ?? 0),
    avg_win: Number(row.avg_win ?? 0),
    avg_loss: Number(row.avg_loss ?? 0),
  };
}

function normalizeMatchedTrade(row: Record<string, unknown>): MatchedTrade {
  return {
    id: Number(row.id),
    symbol: String(row.symbol ?? ''),
    open_date: String(row.open_date),
    close_date: String(row.close_date),
    open_price: Number(row.open_price ?? 0),
    close_price: Number(row.close_price ?? 0),
    pnl: Number(row.pnl ?? 0),
    notes: typeof row.notes === 'string' ? row.notes : null,
  };
}

function normalizeDailyBar(row: Record<string, unknown> | null): DailyBar | null {
  if (!row) return null;
  return {
    symbol: String(row.symbol ?? ''),
    date: String(row.date),
    open: Number(row.open ?? 0),
    high: Number(row.high ?? 0),
    low: Number(row.low ?? 0),
    close: Number(row.close ?? 0),
    volume: Number(row.volume ?? 0),
  };
}

/** Returns trades, summary, notes, and NDX daily market data for one day. */
export async function getDayDetails(date: string): Promise<DayDetails | null> {
  if (typeof date !== 'string' || !isIsoDate(date)) return null;

  const session = await requireSession();
  if (!session) return null;

  const supabase = await createClient();
  const endDate = nextDate(date);

  const [summaryResult, noteResult, matchedTradesResult, marketDataResult] = await Promise.all([
    supabase
      .from('dailysummary')
      .select('date, total_pnl, winning_trades, losing_trades, win_rate, avg_win, avg_loss')
      .eq('household_id', session.householdId)
      .is('deleted_at', null)
      .eq('date', date)
      .maybeSingle(),
    supabase
      .from('note')
      .select('content')
      .eq('owner_user_id', session.userId)
      .eq('date', date)
      .maybeSingle(),
    supabase
      .from('matchedtrade')
      .select('id, symbol, open_date, close_date, open_price, close_price, pnl, notes')
      .eq('household_id', session.householdId)
      .is('deleted_at', null)
      .or(`and(open_date.gte.${date},open_date.lt.${endDate}),and(close_date.gte.${date},close_date.lt.${endDate})`)
      .order('open_date', { ascending: true }),
    supabase
      .from('dailybar')
      .select('symbol, date, open, high, low, close, volume')
      .eq('symbol', 'NDX')
      .eq('date', date)
      .maybeSingle(),
  ]);

  if (summaryResult.error) console.error('[getDayDetails] summary error:', summaryResult.error.message);
  if (noteResult.error) console.error('[getDayDetails] note error:', noteResult.error.message);
  if (matchedTradesResult.error) console.error('[getDayDetails] matched trades error:', matchedTradesResult.error.message);
  if (marketDataResult.error) console.error('[getDayDetails] market data error:', marketDataResult.error.message);

  return {
    summary: normalizeSummary((summaryResult.data as Record<string, unknown> | null) ?? null),
    trades: [],
    note: noteResult.data ? { content: String((noteResult.data as Record<string, unknown>).content ?? '') } : null,
    matched_trades: ((matchedTradesResult.data ?? []) as Record<string, unknown>[]).map(normalizeMatchedTrade),
    market_data: normalizeDailyBar((marketDataResult.data as Record<string, unknown> | null) ?? null),
  };
}
