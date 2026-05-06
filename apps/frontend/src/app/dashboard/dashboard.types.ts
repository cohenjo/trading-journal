// ─── Types & pure helpers for the dashboard feature ──────────────────────────
// No 'use server' directive — safe to import from client components and tests.

export type FreshnessStatus = 'fresh' | 'refreshing' | 'stale' | 'failed';

/** 24-hour stale threshold (issue #73 default). */
export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Minimum seconds between user-triggered refreshes (rate-limit guard). */
export const REFRESH_RATE_LIMIT_SECONDS = 30;

export interface HouseholdRefreshState {
  jobType: string;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  lastRunId: string | null;
}

export interface DailyPerformanceRow {
  date: string;
  currency: string;
  /** Stored as string for decimal safety — use Decimal(row.totalPnl) on the client. */
  totalPnl: string;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  computedAt: string;
}

export interface DashboardSummaryRow {
  period: string;
  asOfDate: string;
  currency: string;
  netWorth: string;
  dailyPnl: string;
  ytdPnl: string;
  computedAt: string;
}

export interface DashboardSnapshot {
  refreshState: HouseholdRefreshState | null;
  freshnessStatus: FreshnessStatus;
  /** Seconds since last successful refresh, or null if never run. */
  stalenessSeconds: number | null;
  dailyPerformance: DailyPerformanceRow[];
  dashboardSummary: DashboardSummaryRow | null;
  /** True when cooked tables have no rows for this household (first run pending). */
  isFirstRun: boolean;
}

export type TriggerRefreshResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string };

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

/**
 * Compute the UI freshness status from refresh-state metadata.
 *
 * States (per issue #73 acceptance criteria):
 *   fresh      — last_succeeded_at within 24 h, no active job
 *   refreshing — active compute job (pending | running)
 *   stale      — last_succeeded_at > 24 h ago (or never), no active job
 *   failed     — last_failed_at > last_succeeded_at (most recent run failed)
 */
export function computeFreshnessStatus(
  refreshState: HouseholdRefreshState | null,
  hasActiveJob: boolean,
): FreshnessStatus {
  if (hasActiveJob) return 'refreshing';

  if (!refreshState?.lastSucceededAt) {
    if (refreshState?.lastFailedAt) return 'failed';
    return 'stale'; // never successfully run
  }

  const lastSucceeded = new Date(refreshState.lastSucceededAt).getTime();
  const lastFailed = refreshState.lastFailedAt
    ? new Date(refreshState.lastFailedAt).getTime()
    : null;

  if (lastFailed !== null && lastFailed > lastSucceeded) return 'failed';

  const ageMs = Date.now() - lastSucceeded;
  return ageMs <= STALE_THRESHOLD_MS ? 'fresh' : 'stale';
}

/** Seconds elapsed since the given ISO timestamp, or null. */
export function secondsSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}
