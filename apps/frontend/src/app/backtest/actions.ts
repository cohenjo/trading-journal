'use server';

import { enqueueComputeJob } from '@/lib/compute-jobs';
import { createClient } from '@/lib/supabase/server';

export interface BacktestConfig { year: number; initial_capital: string; step_days: number; underlying: string; leap_underlying: string; strategy: string; }
export interface BacktestRun { id: string; household_id: string; compute_job_id: string | null; config: BacktestConfig; result: unknown | null; started_at: string | null; finished_at: string | null; created_at: string; }
interface BacktestRunRow { id: unknown; household_id: unknown; compute_job_id?: unknown; config: unknown; result?: unknown; started_at?: unknown; finished_at?: unknown; created_at: unknown; }

function normalizeConfig(config: Partial<BacktestConfig>): BacktestConfig {
  const year = Number(config.year);
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2018 || year > currentYear) throw new Error('Select a valid backtest year.');
  const stepDays = Number(config.step_days ?? 1);
  if (!Number.isInteger(stepDays) || stepDays < 1 || stepDays > 31) throw new Error('Backtest step_days must be between 1 and 31.');
  const initialCapital = String(config.initial_capital ?? '100000').trim();
  if (!initialCapital || Number(initialCapital) <= 0) throw new Error('Backtest initial_capital must be positive.');
  return { year, initial_capital: initialCapital, step_days: stepDays, underlying: normalizeSymbol(config.underlying, 'NDX'), leap_underlying: normalizeSymbol(config.leap_underlying, 'NDX'), strategy: normalizeSymbol(config.strategy, 'IRON_CONDOR') };
}
function normalizeSymbol(value: string | undefined, fallback: string): string { const symbol = (value ?? fallback).trim().toUpperCase(); if (!symbol) throw new Error('Backtest symbols must not be empty.'); return symbol; }
function normalizeRun(row: BacktestRunRow): BacktestRun { return { id: String(row.id), household_id: String(row.household_id), compute_job_id: row.compute_job_id == null ? null : String(row.compute_job_id), config: normalizeConfig((row.config ?? {}) as Partial<BacktestConfig>), result: row.result ?? null, started_at: row.started_at == null ? null : String(row.started_at), finished_at: row.finished_at == null ? null : String(row.finished_at), created_at: String(row.created_at) }; }

/** Enqueue an on-demand backtest compute job for the active household. */
export async function enqueueBacktest(config: BacktestConfig): Promise<string> { return enqueueComputeJob('backtest', { config: normalizeConfig(config) }); }
/** List recent backtest runs visible through household RLS. */
export async function listBacktestRuns(limit = 20): Promise<BacktestRun[]> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return [];
  const { data, error } = await supabase.from('backtest_runs').select('id, household_id, compute_job_id, config, result, started_at, finished_at, created_at').order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error('[listBacktestRuns] query error:', error.message); return []; }
  return ((data ?? []) as BacktestRunRow[]).map(normalizeRun);
}
/** Fetch one backtest result row visible through household RLS. */
export async function getBacktestRun(id: string): Promise<BacktestRun | null> {
  if (!id.trim()) return null;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;
  const { data, error } = await supabase.from('backtest_runs').select('id, household_id, compute_job_id, config, result, started_at, finished_at, created_at').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeRun(data as BacktestRunRow) : null;
}

/**
 * Return the list of years for which historical backtest data is available.
 *
 * Migrated from `GET /api/backtest/years` (now deprecated on the FastAPI
 * compute backend). The range is fixed at 2018–currentYear; no database
 * round-trip is needed because the boundary is a constant, not user data.
 */
export async function getBacktestYears(): Promise<number[]> {
  const START_YEAR = 2018;
  const currentYear = new Date().getUTCFullYear();
  if (currentYear < START_YEAR) return [];
  return Array.from({ length: currentYear - START_YEAR + 1 }, (_, i) => START_YEAR + i);
}
