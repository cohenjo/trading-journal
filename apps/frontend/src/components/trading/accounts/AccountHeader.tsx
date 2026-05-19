"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { TradingAccountConfig, AccountRefreshResult } from "@/app/trading/actions";
import { triggerIBKRSync } from "@/app/trading/actions";
import CSVImportButton from "@/components/trading/accounts/CSVImportButton";

export interface AccountHeaderProps {
  config: TradingAccountConfig;
  onAddPosition?: () => void;
  onRefreshComplete?: () => void;
  onImportSuccess?: (imported: number) => void;
}

// ── State machine ─────────────────────────────────────────────────────────────

type RefreshState =
  | { status: "IDLE" }
  | { status: "SUBMITTING" }
  | { status: "QUEUED"; preSyncTimestamp: string | null }
  | { status: "THROTTLED"; nextEligibleAt: string; minutesRemaining: number }
  | { status: "COMPLETED" }
  | { status: "ERROR"; message: string }
  | { status: "TIMEOUT" };

const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_ITERATIONS = 20; // 30s × 20 = 10 min

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, { label: string; badgeClass: string }> = {
  ibkr: { label: "Flex", badgeClass: "bg-blue-900/40 text-blue-300 border-blue-700/50" },
  IBKR: { label: "Flex", badgeClass: "bg-blue-900/40 text-blue-300 border-blue-700/50" },
  schwab: { label: "Manual", badgeClass: "bg-amber-900/40 text-amber-300 border-amber-700/50" },
  SCHWAB: { label: "Manual", badgeClass: "bg-amber-900/40 text-amber-300 border-amber-700/50" },
  ira: { label: "Manual", badgeClass: "bg-violet-900/40 text-violet-300 border-violet-700/50" },
};

function formatLastSync(timestamp: string | null | undefined): string {
  if (!timestamp) return "Never";
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isIBKRAccount(accountType: string): boolean {
  return accountType.toLowerCase() === "ibkr";
}

/** Minutes until `isoTimestamp` from now, minimum 0. */
function minutesUntil(isoTimestamp: string): number {
  const diff = new Date(isoTimestamp).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 60_000));
}

/** Minutes since `isoTimestamp` from now, minimum 0. */
function minutesSince(isoTimestamp: string | null): number {
  if (!isoTimestamp) return 0;
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  return Math.max(0, Math.floor(diff / 60_000));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AccountHeader({
  config,
  onAddPosition,
  onRefreshComplete,
  onImportSuccess,
}: AccountHeaderProps) {
  const router = useRouter();
  const [refreshState, setRefreshState] = useState<RefreshState>({ status: "IDLE" });

  const typeKey = config.account_type ?? "ibkr";
  const typeInfo = TYPE_LABELS[typeKey] ?? {
    label: typeKey.toUpperCase(),
    badgeClass: "bg-slate-800 text-slate-300 border-slate-700",
  };

  const isIBKR = isIBKRAccount(typeKey);
  const accountName = config.name ?? config.account_id ?? "Trading Account";
  const lastDate = config.last_synced;
  const dateLabel = isIBKR ? "Last synced" : "Last updated";

  // Refs so polling callbacks always read the latest values without stale closures
  const lastSyncedRef = useRef<string | null>(config.last_synced ?? null);
  useEffect(() => {
    lastSyncedRef.current = config.last_synced ?? null;
  });

  const preSyncTimestampRef = useRef<string | null>(null);

  const onRefreshCompleteRef = useRef(onRefreshComplete);
  useEffect(() => {
    onRefreshCompleteRef.current = onRefreshComplete;
  }, [onRefreshComplete]);

  // ── Polling interval while QUEUED ────────────────────────────────────────────
  useEffect(() => {
    if (refreshState.status !== "QUEUED") return;

    let iterations = 0;

    const interval = setInterval(() => {
      // Detect completion: last_synced changed from pre-request snapshot
      if (lastSyncedRef.current !== preSyncTimestampRef.current) {
        clearInterval(interval);
        setRefreshState({ status: "COMPLETED" });
        toast.success("Data refreshed!");
        onRefreshCompleteRef.current?.();
        return;
      }

      iterations += 1;
      if (iterations >= MAX_POLL_ITERATIONS) {
        clearInterval(interval);
        setRefreshState({ status: "TIMEOUT" });
        toast.error("Refresh may have failed. Check back later.");
        return;
      }

      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refreshState.status, router]);

  // ── Throttle countdown ───────────────────────────────────────────────────────
  const throttledNextEligibleAt =
    refreshState.status === "THROTTLED" ? refreshState.nextEligibleAt : null;

  useEffect(() => {
    if (!throttledNextEligibleAt) return;

    const interval = setInterval(() => {
      const remaining = minutesUntil(throttledNextEligibleAt);

      if (remaining <= 0) {
        clearInterval(interval);
        setRefreshState({ status: "IDLE" });
        return;
      }

      setRefreshState((prev) => {
        if (prev.status !== "THROTTLED") return prev;
        return { ...prev, minutesRemaining: remaining };
      });
    }, 60_000);

    return () => clearInterval(interval);
  }, [throttledNextEligibleAt]);

  // ── Click handler ────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    preSyncTimestampRef.current = config.last_synced ?? null;
    setRefreshState({ status: "SUBMITTING" });

    const result: AccountRefreshResult = await triggerIBKRSync(config.id);

    if (!result.ok) {
      setRefreshState({ status: "ERROR", message: result.error });
      toast.error(`Refresh failed: ${result.error}`);
      return;
    }

    if (result.status === "queued") {
      setRefreshState({ status: "QUEUED", preSyncTimestamp: preSyncTimestampRef.current });
      toast.info("Refresh queued. Data will update within 5 minutes.");
      return;
    }

    if (result.status === "throttled") {
      const minutesAgo = minutesSince(result.last_synced_at);
      const minutesLeft = minutesUntil(result.next_eligible_at);
      setRefreshState({
        status: "THROTTLED",
        nextEligibleAt: result.next_eligible_at,
        minutesRemaining: minutesLeft,
      });
      toast.warning(
        `Last sync was ${minutesAgo} min ago. Try again in ${minutesLeft} min.`,
      );
    }
  }, [config.id, config.last_synced]);

  // ── Derived button state ─────────────────────────────────────────────────────
  const isButtonDisabled =
    refreshState.status === "SUBMITTING" ||
    refreshState.status === "QUEUED" ||
    refreshState.status === "THROTTLED";

  function getButtonLabel(): string {
    switch (refreshState.status) {
      case "SUBMITTING":
        return "Syncing…";
      case "QUEUED":
        return "Queued…";
      case "THROTTLED":
        return `Try in ${refreshState.minutesRemaining}m`;
      default:
        return "↻ Refresh";
    }
  }

  const isSpinning = refreshState.status === "SUBMITTING" || refreshState.status === "QUEUED";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-900/50 rounded-lg border border-slate-800 mb-4">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-lg font-semibold text-slate-100 truncate">{accountName}</h2>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${typeInfo.badgeClass}`}
          data-testid="account-type-badge"
        >
          {typeInfo.label}
        </span>
        <span className="text-sm text-slate-500 hidden sm:inline">
          {dateLabel}:{" "}
          <span className="text-slate-400">{formatLastSync(lastDate)}</span>
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500 sm:hidden">
          {dateLabel}: <span className="text-slate-400">{formatLastSync(lastDate)}</span>
        </span>

        {isIBKR ? (
          <button
            onClick={handleRefresh}
            disabled={isButtonDisabled}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition-all text-sm disabled:opacity-50"
            data-testid="refresh-button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isSpinning ? "animate-spin" : ""}
              aria-hidden="true"
            >
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {getButtonLabel()}
          </button>
        ) : (
          <>
            <button
              onClick={onAddPosition}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:border-emerald-600 hover:bg-emerald-900/20 transition-all text-sm"
              data-testid="add-position-button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              + Add Position
            </button>
            <CSVImportButton
              accountId={config.id}
              onSuccess={(imported) => {
                onImportSuccess?.(imported);
                onRefreshComplete?.();
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
