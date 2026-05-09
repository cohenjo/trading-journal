"use client";

import React, { useState } from "react";
import type { TradingAccountConfig } from "@/app/trading/actions";
import { triggerIBKRSync } from "@/app/trading/actions";

export interface AccountHeaderProps {
  config: TradingAccountConfig;
  onAddPosition?: () => void;
  onRefreshComplete?: () => void;
}

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

export default function AccountHeader({
  config,
  onAddPosition,
  onRefreshComplete,
}: AccountHeaderProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const typeKey = config.account_type ?? "ibkr";
  const typeInfo = TYPE_LABELS[typeKey] ?? {
    label: typeKey.toUpperCase(),
    badgeClass: "bg-slate-800 text-slate-300 border-slate-700",
  };

  const isIBKR = isIBKRAccount(typeKey);
  const accountName = config.name ?? config.account_id ?? "Trading Account";
  const lastDate = config.last_synced;
  const dateLabel = isIBKR ? "Last synced" : "Last updated";

  const handleRefresh = async () => {
    setSyncing(true);
    setSyncMessage(null);
    const result = await triggerIBKRSync(config.id);
    setSyncing(false);
    if (result.ok) {
      setSyncMessage("Sync triggered — data will refresh shortly.");
      onRefreshComplete?.();
    } else {
      setSyncMessage(result.error ?? "Sync failed");
    }
  };

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
            disabled={syncing}
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
              className={syncing ? "animate-spin" : ""}
            >
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {syncing ? "Syncing…" : "↻ Refresh"}
          </button>
        ) : (
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
        )}
      </div>

      {syncMessage && (
        <p className="text-xs text-slate-400 w-full sm:w-auto" data-testid="sync-message">
          {syncMessage}
        </p>
      )}
    </div>
  );
}
