'use server';

import { createClient } from '@/lib/supabase/server';

export interface DailySummary {
  date: string;
  total_pnl: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
}

export interface LatestMonthSummary {
  year: number;
  month: number;
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

function normalizeDailySummary(row: Record<string, unknown>): DailySummary {
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

function monthBounds(year: number, month: number): { start: string; end: string } | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));

  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
}

/** Returns the year/month containing the latest daily summary for this household. */
export async function getLatestMonthSummary(): Promise<LatestMonthSummary | null> {
  const householdId = await requireHouseholdId();
  if (!householdId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('dailysummary')
    .select('date')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.date) {
    if (error) console.error('[getLatestMonthSummary] query error:', error.message);
    return null;
  }

  const latest = new Date(`${data.date as string}T00:00:00Z`);
  return { year: latest.getUTCFullYear(), month: latest.getUTCMonth() + 1 };
}

/** Returns all daily summaries for a household month, ordered by date. */
export async function getMonthSummary(year: number, month: number): Promise<DailySummary[]> {
  const bounds = monthBounds(year, month);
  if (!bounds) return [];

  const householdId = await requireHouseholdId();
  if (!householdId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('dailysummary')
    .select('date, total_pnl, winning_trades, losing_trades, win_rate, avg_win, avg_loss')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .gte('date', bounds.start)
    .lt('date', bounds.end)
    .order('date', { ascending: true });

  if (error) {
    console.error('[getMonthSummary] query error:', error.message);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => normalizeDailySummary(row));
}
