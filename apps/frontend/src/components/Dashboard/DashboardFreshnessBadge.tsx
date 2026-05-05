'use client';

import { useMemo } from 'react';
import type { FreshnessStatus, HouseholdRefreshState } from '@/app/dashboard/actions';

interface DashboardFreshnessBadgeProps {
  freshnessStatus: FreshnessStatus;
  refreshState: HouseholdRefreshState | null;
  /** Seconds since last successful refresh — used for tooltip copy. */
  stalenessSeconds: number | null;
}

/** Human-readable "X ago" string for the tooltip. */
function formatAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const STATUS_CONFIG = {
  fresh: {
    dot: 'bg-green-500',
    label: 'Fresh',
    labelClass: 'text-green-400',
    badgeClass: 'border-green-800/50 bg-green-900/20',
  },
  refreshing: {
    dot: 'bg-amber-400 animate-pulse',
    label: 'Refreshing…',
    labelClass: 'text-amber-400',
    badgeClass: 'border-amber-800/50 bg-amber-900/20',
  },
  stale: {
    dot: 'bg-amber-500',
    label: 'Stale',
    labelClass: 'text-amber-400',
    badgeClass: 'border-amber-800/50 bg-amber-900/20',
  },
  failed: {
    dot: 'bg-red-500',
    label: 'Failed',
    labelClass: 'text-red-400',
    badgeClass: 'border-red-800/50 bg-red-900/20',
  },
} as const satisfies Record<FreshnessStatus, {
  dot: string;
  label: string;
  labelClass: string;
  badgeClass: string;
}>;

/**
 * Small badge shown near the dashboard header indicating data freshness.
 *
 * States (issue #73):
 *   🟢 fresh      — data refreshed within the last 24 hours
 *   🔄 refreshing — a compute job is in progress
 *   🟡 stale      — data > 24 h old or never refreshed
 *   🔴 failed     — the most recent compute run failed
 */
export default function DashboardFreshnessBadge({
  freshnessStatus,
  refreshState,
  stalenessSeconds,
}: DashboardFreshnessBadgeProps) {
  const config = STATUS_CONFIG[freshnessStatus];

  const tooltipText = useMemo(() => {
    if (freshnessStatus === 'refreshing') return 'Data refresh in progress';
    if (!refreshState?.lastSucceededAt) {
      if (refreshState?.lastFailedAt) {
        const failedAgo = Math.max(
          0,
          Math.floor((Date.now() - new Date(refreshState.lastFailedAt).getTime()) / 1000),
        );
        return `Last refresh failed ${formatAgo(failedAgo)}${refreshState.lastError ? ` — ${refreshState.lastError}` : ''}`;
      }
      return 'No successful refresh yet';
    }
    const ago = stalenessSeconds != null ? formatAgo(stalenessSeconds) : 'unknown';
    if (freshnessStatus === 'failed' && refreshState?.lastError) {
      return `Last refresh failed — last success ${ago}`;
    }
    return `Last updated ${ago}`;
  }, [freshnessStatus, refreshState, stalenessSeconds]);

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${config.badgeClass}`}
      title={tooltipText}
      aria-label={`Data freshness: ${config.label}. ${tooltipText}`}
      data-testid="freshness-badge"
      data-status={freshnessStatus}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`}
        aria-hidden="true"
      />
      <span className={config.labelClass}>{config.label}</span>
      {stalenessSeconds != null && freshnessStatus !== 'refreshing' && (
        <span className="text-slate-500 ml-0.5">· {formatAgo(stalenessSeconds)}</span>
      )}
    </div>
  );
}
