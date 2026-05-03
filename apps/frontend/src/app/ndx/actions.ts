'use server';

import { createClient } from '@/lib/supabase/server';

export interface NdxChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function nextDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Returns stored NDX 1-minute OHLC rows for the given day.
 *
 * NDX sync is performed by the private backend worker's scheduled batch;
 * this action is intentionally read-only over Supabase RLS-protected data.
 */
export async function getNdxChartData(date: string): Promise<NdxChartData[]> {
  if (typeof date !== 'string' || !isIsoDate(date)) return [];

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return [];

  const { data, error } = await supabase
    .from('ndx1m')
    .select('timestamp, open, high, low, close')
    .gte('timestamp', date)
    .lt('timestamp', nextDate(date))
    .order('timestamp', { ascending: true });

  if (error) {
    console.error('[getNdxChartData] query error:', error.message);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    time: Math.floor(new Date(String(row.timestamp)).getTime() / 1000),
    open: Number(row.open ?? 0),
    high: Number(row.high ?? 0),
    low: Number(row.low ?? 0),
    close: Number(row.close ?? 0),
  }));
}
