'use server';

import { createClient } from '@/lib/supabase/server';

const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export interface AnalysisTickerRow {
  ticker: string;
  household_id: string | null;
  data: AnalysisTickerPayload;
  refreshed_at: string;
  isStale: boolean;
}

export interface AnalysisTickerPayload {
  ticker?: string;
  generated_at?: string;
  sections?: Record<string, unknown>;
  errors?: Record<string, string>;
  source?: string;
}

export interface AnalysisGrowthStoryRow {
  id: string;
  ticker: string;
  household_id: string | null;
  story: Record<string, unknown>;
  refreshed_at: string;
  isStale: boolean;
}

export interface GrowthStoryFilters {
  ticker?: string;
  limit?: number;
}

export type AnalysisActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function isValidTicker(ticker: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker);
}

function isStale(refreshedAt: string): boolean {
  const refreshedMs = Date.parse(refreshedAt);
  return Number.isNaN(refreshedMs) || Date.now() - refreshedMs > STALE_AFTER_MS;
}

function normalizeTickerRow(row: Record<string, unknown>): AnalysisTickerRow {
  const refreshedAt = String(row.refreshed_at ?? '');
  return {
    ticker: String(row.ticker ?? ''),
    household_id: typeof row.household_id === 'string' ? row.household_id : null,
    data: (row.data ?? {}) as AnalysisTickerPayload,
    refreshed_at: refreshedAt,
    isStale: isStale(refreshedAt),
  };
}

function normalizeGrowthStoryRow(row: Record<string, unknown>): AnalysisGrowthStoryRow {
  const refreshedAt = String(row.refreshed_at ?? '');
  return {
    id: String(row.id ?? ''),
    ticker: String(row.ticker ?? ''),
    household_id: typeof row.household_id === 'string' ? row.household_id : null,
    story: (row.story ?? {}) as Record<string, unknown>,
    refreshed_at: refreshedAt,
    isStale: isStale(refreshedAt),
  };
}

function preferHouseholdThenFreshest<T extends { household_id: string | null; refreshed_at: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    if (left.household_id && !right.household_id) return -1;
    if (!left.household_id && right.household_id) return 1;
    return Date.parse(right.refreshed_at) - Date.parse(left.refreshed_at);
  });
}

export async function getTickerAnalysis(ticker: string): Promise<AnalysisActionResult<AnalysisTickerRow | null>> {
  const normalized = normalizeTicker(ticker);
  if (!isValidTicker(normalized)) return { ok: false, error: 'Invalid ticker symbol' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('analysis_tickers')
    .select('ticker, household_id, data, refreshed_at')
    .eq('ticker', normalized);

  if (error) {
    console.error('[getTickerAnalysis] query error:', error.message);
    return { ok: false, error: 'Failed to load ticker analysis' };
  }

  const rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeTickerRow);
  return { ok: true, data: preferHouseholdThenFreshest(rows)[0] ?? null };
}

export async function listGrowthStories(
  filters: GrowthStoryFilters = {},
): Promise<AnalysisActionResult<AnalysisGrowthStoryRow[]>> {
  const normalizedTicker = filters.ticker ? normalizeTicker(filters.ticker) : null;
  if (normalizedTicker && !isValidTicker(normalizedTicker)) return { ok: false, error: 'Invalid ticker symbol' };

  const supabase = await createClient();
  let query = supabase
    .from('analysis_growth_stories')
    .select('id, ticker, household_id, story, refreshed_at')
    .order('refreshed_at', { ascending: false })
    .limit(Math.max(1, Math.min(filters.limit ?? 20, 100)));

  if (normalizedTicker) query = query.eq('ticker', normalizedTicker);

  const { data, error } = await query;
  if (error) {
    console.error('[listGrowthStories] query error:', error.message);
    return { ok: false, error: 'Failed to load growth stories' };
  }

  const rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeGrowthStoryRow);
  return { ok: true, data: preferHouseholdThenFreshest(rows) };
}
