'use server';

import { createClient } from '@/lib/supabase/server';
import Decimal from 'decimal.js';
import {
  computeFreshnessStatus,
  secondsSince,
  REFRESH_RATE_LIMIT_SECONDS,
} from './dashboard.types';
import type {
  HouseholdRefreshState,
  DailyPerformanceRow,
  DashboardSummaryRow,
  DashboardSnapshot,
  TriggerRefreshResult,
} from './dashboard.types';

export type {
  FreshnessStatus,
  HouseholdRefreshState,
  DailyPerformanceRow,
  DashboardSummaryRow,
  DashboardSnapshot,
  TriggerRefreshResult,
} from './dashboard.types';

// ─── Row normalizers ──────────────────────────────────────────────────────────

function normalizeRefreshState(row: Record<string, unknown>): HouseholdRefreshState {
  return {
    jobType: String(row.job_type ?? ''),
    lastSucceededAt: row.last_succeeded_at != null ? String(row.last_succeeded_at) : null,
    lastFailedAt: row.last_failed_at != null ? String(row.last_failed_at) : null,
    lastError: row.last_error != null ? String(row.last_error) : null,
    lastRunId: row.last_run_id != null ? String(row.last_run_id) : null,
  };
}

function normalizeDailyPerformanceRow(row: Record<string, unknown>): DailyPerformanceRow {
  const payload =
    typeof row.performance_payload === 'object' && row.performance_payload !== null
      ? (row.performance_payload as Record<string, unknown>)
      : {};

  return {
    date: String(row.date ?? ''),
    currency: String(row.currency ?? 'USD'),
    totalPnl: new Decimal(
      String(payload.total_pnl ?? payload.totalPnl ?? '0'),
    ).toFixed(2),
    winningTrades: Number(payload.winning_trades ?? payload.winningTrades ?? 0),
    losingTrades: Number(payload.losing_trades ?? payload.losingTrades ?? 0),
    winRate: Number(payload.win_rate ?? payload.winRate ?? 0),
    computedAt: String(row._computed_at ?? ''),
  };
}

function normalizeDashboardSummaryRow(row: Record<string, unknown>): DashboardSummaryRow {
  const payload =
    typeof row.summary_payload === 'object' && row.summary_payload !== null
      ? (row.summary_payload as Record<string, unknown>)
      : {};

  return {
    period: String(row.period ?? 'day'),
    asOfDate: String(row.as_of_date ?? ''),
    currency: String(row.currency ?? 'USD'),
    netWorth: new Decimal(String(payload.net_worth ?? payload.netWorth ?? '0')).toFixed(2),
    dailyPnl: new Decimal(String(payload.daily_pnl ?? payload.dailyPnl ?? '0')).toFixed(2),
    ytdPnl: new Decimal(String(payload.ytd_pnl ?? payload.ytdPnl ?? '0')).toFixed(2),
    computedAt: String(row._computed_at ?? ''),
  };
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

// ─── Server Actions ───────────────────────────────────────────────────────────

/**
 * Fetch the dashboard snapshot for the current user's household.
 *
 * Reads from:
 *   - cooked.daily_performance   (last 90 days, DESC)
 *   - cooked.dashboard_summary   (most recent 'day' period row)
 *   - public.household_refresh_state  (pnl_daily job type)
 *   - public.compute_jobs         (pending/running count for "refreshing" state)
 *
 * If cooked tables are empty, isFirstRun = true so the UI can show a
 * friendly "Crunching your data — first refresh in progress" state.
 */
export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const supabase = await createClient();

  const householdId = await requireHouseholdId();
  if (!householdId) {
    return {
      refreshState: null,
      freshnessStatus: 'stale',
      stalenessSeconds: null,
      dailyPerformance: [],
      dashboardSummary: null,
      isFirstRun: true,
    };
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [refreshStateRes, dailyPerfRes, summaryRes, activeJobsRes] = await Promise.all([
    supabase
      .from('household_refresh_state')
      .select('job_type, last_succeeded_at, last_failed_at, last_error, last_run_id')
      .eq('household_id', householdId)
      .eq('job_type', 'pnl_daily')
      .maybeSingle(),

    supabase
      .from('daily_performance')
      .select('date, currency, performance_payload, _computed_at')
      .eq('household_id', householdId)
      .gte('date', ninetyDaysAgo)
      .order('date', { ascending: false })
      .limit(90),

    supabase
      .from('dashboard_summary')
      .select('period, as_of_date, currency, summary_payload, _computed_at')
      .eq('household_id', householdId)
      .eq('period', 'day')
      .order('as_of_date', { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from('compute_jobs')
      .select('id')
      .eq('household_id', householdId)
      .in('status', ['pending', 'running'])
      .limit(1),
  ]);

  if (refreshStateRes.error) {
    console.error('[getDashboardSnapshot] refresh_state error:', refreshStateRes.error.message);
  }
  if (dailyPerfRes.error) {
    console.error('[getDashboardSnapshot] daily_performance error:', dailyPerfRes.error.message);
  }
  if (summaryRes.error) {
    console.error('[getDashboardSnapshot] dashboard_summary error:', summaryRes.error.message);
  }

  const refreshState = refreshStateRes.data
    ? normalizeRefreshState(refreshStateRes.data as Record<string, unknown>)
    : null;

  const hasActiveJob = (activeJobsRes.data?.length ?? 0) > 0;

  const dailyPerformance = (dailyPerfRes.data ?? []).map((r) =>
    normalizeDailyPerformanceRow(r as Record<string, unknown>),
  );

  const dashboardSummary = summaryRes.data
    ? normalizeDashboardSummaryRow(summaryRes.data as Record<string, unknown>)
    : null;

  const isFirstRun = dailyPerformance.length === 0 && dashboardSummary === null;

  return {
    refreshState,
    freshnessStatus: computeFreshnessStatus(refreshState, hasActiveJob),
    stalenessSeconds: secondsSince(refreshState?.lastSucceededAt ?? null),
    dailyPerformance,
    dashboardSummary,
    isFirstRun,
  };
}

/**
 * Trigger a manual pnl_daily refresh for the current user's household.
 *
 * Rate-limited: rejects if last_succeeded_at was < 30 s ago, or if a
 * compute job is already queued/running for this household.
 */
export async function triggerHouseholdRefresh(): Promise<TriggerRefreshResult> {
  const supabase = await createClient();

  const householdId = await requireHouseholdId();
  if (!householdId) {
    return { ok: false, error: 'Authentication required.' };
  }

  // Rate-limit check
  const { data: state, error: stateError } = await supabase
    .from('household_refresh_state')
    .select('last_succeeded_at')
    .eq('household_id', householdId)
    .eq('job_type', 'pnl_daily')
    .maybeSingle();

  if (stateError) {
    console.error('[triggerHouseholdRefresh] state query error:', stateError.message);
  }

  if (state?.last_succeeded_at) {
    const elapsedSeconds =
      (Date.now() - new Date(state.last_succeeded_at as string).getTime()) / 1000;
    if (elapsedSeconds < REFRESH_RATE_LIMIT_SECONDS) {
      const wait = Math.ceil(REFRESH_RATE_LIMIT_SECONDS - elapsedSeconds);
      return { ok: false, error: `Please wait ${wait}s before triggering another refresh.` };
    }
  }

  // Block if a job is already running
  const { data: activeJobs } = await supabase
    .from('compute_jobs')
    .select('id')
    .eq('household_id', householdId)
    .in('status', ['pending', 'running'])
    .limit(1);

  if ((activeJobs?.length ?? 0) > 0) {
    return { ok: false, error: 'A refresh is already in progress.' };
  }

  const { data: job, error: insertError } = await supabase
    .from('compute_jobs')
    .insert({
      household_id: householdId,
      job_type: 'pnl_daily',
      payload: { triggered_by: 'user_manual' },
    })
    .select('id')
    .single();

  if (insertError || !job?.id) {
    const msg = insertError?.message ?? 'Failed to enqueue refresh job.';
    console.error('[triggerHouseholdRefresh] insert error:', msg);
    return { ok: false, error: msg };
  }

  return { ok: true, jobId: String(job.id) };
}
