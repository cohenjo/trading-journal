'use client';

import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { triggerHouseholdRefresh } from '@/app/dashboard/actions';

interface RefreshNowButtonProps {
  /** Called when a refresh job is successfully enqueued. */
  onRefreshTriggered?: () => void;
}

/**
 * Button that enqueues a pnl_daily compute job for the current household.
 * Rate-limited server-side (30 s minimum gap between triggers).
 */
export default function RefreshNowButton({ onRefreshTriggered }: RefreshNowButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await triggerHouseholdRefresh();
      if (result.ok) {
        onRefreshTriggered?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border
          border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:border-slate-600
          disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Trigger a data refresh"
        data-testid="refresh-now-button"
      >
        <RefreshCw
          size={12}
          className={isPending ? 'animate-spin' : ''}
          aria-hidden="true"
        />
        {isPending ? 'Queuing…' : 'Refresh Now'}
      </button>
      {error && (
        <p className="text-xs text-amber-400" role="alert" data-testid="refresh-error">
          {error}
        </p>
      )}
    </div>
  );
}
