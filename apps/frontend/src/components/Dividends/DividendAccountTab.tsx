"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import DividendDashboard from "@/components/Dividends/DividendDashboard";
import DividendPositionsTable from "@/components/Dividends/DividendPositionsTable";
import { getDividendPositions } from "@/app/dividends/actions";
import type { DividendPosition } from "@/types/dividends";

/** Maps account type key → display label (mirrors dividends/page.tsx). */
const TAB_LABELS: Record<string, string> = {
  ibkr: "InteractiveBrokers",
  schwab: "Schwab",
  ira: "LeumiIRA",
};

export type AccountKey = "ibkr" | "schwab" | "ira";

export interface DividendAccountTabProps {
  accountKey: AccountKey;
}

/**
 * Per-account tab content for the Dividends page.
 *
 * - Fetches enriched positions from getDividendPositions(accountKey).
 * - Renders positions table (non-empty) or empty-state CTA (empty).
 * - Includes collapsible Payment History section backed by DividendDashboard.
 */
export default function DividendAccountTab({ accountKey }: DividendAccountTabProps) {
  const [rows, setRows] = useState<DividendPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDividendPositions(accountKey);
      setRows(data);
    } catch (err) {
      console.error(`[DividendAccountTab] load failed for ${accountKey}:`, err);
      setError("Failed to load dividend positions. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse py-8">
        <div className="h-8 bg-slate-800 rounded w-full" />
        <div className="h-8 bg-slate-800 rounded w-5/6" />
        <div className="h-8 bg-slate-800 rounded w-4/6" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-950/40 border border-red-800/60 rounded-lg text-red-300 text-sm">
        <span>{error}</span>
        <button
          onClick={() => void load()}
          className="ml-auto px-3 py-1 bg-red-800 hover:bg-red-700 rounded text-xs font-medium transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const accountsPageLink = `/trading/accounts?account=${accountKey}`;

  return (
    <div className="space-y-4">
      {/* Positions table or empty state */}
      {rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-4 py-16 text-center bg-slate-900/50 rounded-2xl border border-dashed border-slate-800"
          data-testid="dividends-account-empty"
        >
          <p className="text-slate-300 text-base">
            No dividend-bearing positions in this account. Import positions or add manually on the
            Accounts page.
          </p>
          <Link
            href={accountsPageLink}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Go to Accounts page
          </Link>
        </div>
      ) : (
        <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
          <DividendPositionsTable rows={rows} />
        </div>
      )}

      {/* Collapsible Payment History (preserves legacy DividendDashboard view) */}
      <div className="bg-slate-900 rounded-lg border border-slate-800">
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-300 hover:text-slate-100 transition-colors"
          aria-expanded={historyOpen}
          data-testid="dividends-history-toggle"
        >
          <span>Payment History</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${historyOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {historyOpen && (
          <div
            className="border-t border-slate-800"
            data-testid="dividends-history-section"
          >
            <DividendDashboard accountNameFilter={TAB_LABELS[accountKey]} />
          </div>
        )}
      </div>
    </div>
  );
}
