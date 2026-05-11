"use client";
export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import DividendAccountTab from "@/components/Dividends/DividendAccountTab";
import type { AccountKey } from "@/components/Dividends/DividendAccountTab";
import { getDividendSummary } from "@/app/dividends/actions";
import { formatCurrency } from "@/lib/currency";
import type { DividendSummaryResult } from "@/types/dividends";

/** Display label for each account type (single source of truth). */
const TAB_LABELS: Record<string, string> = {
  ibkr:   "InteractiveBrokers",
  schwab: "Schwab",
  ira:    "LeumiIRA",
};

const TAB_ORDER: Record<string, number> = { ibkr: 0, schwab: 1, ira: 2 };

/** 3 tabs, hardcoded — never derived from DB rows. */
const ACCOUNT_TABS = (Object.keys(TAB_ORDER) as AccountKey[]).sort(
  (a, b) => TAB_ORDER[a] - TAB_ORDER[b],
);

function fmtMoney(val: number): string {
  return formatCurrency(val, "USD");
}

// ── Summary header ─────────────────────────────────────────────────────────────

function DividendsSummaryHeader() {
  const [summary, setSummary] = useState<DividendSummaryResult | null>(null);

  useEffect(() => {
    getDividendSummary()
      .then((s) => setSummary(s))
      .catch((err) => console.error("[DividendsSummaryHeader]", err));
  }, []);

  const total = summary?.total_forward_annual ?? 0;
  const byAccount = summary?.by_account;

  return (
    <div
      className="flex flex-wrap items-center gap-4 p-4 bg-slate-900 rounded-lg border border-slate-800 mb-6"
      data-testid="dividends-summary-total"
    >
      <span className="text-slate-100 font-semibold text-base">
        Expected Annual Dividend Income:{" "}
        <span className="text-green-400 text-lg">{fmtMoney(total)}</span>
      </span>
      {byAccount && (
        <div className="flex flex-wrap gap-2 text-xs text-slate-400">
          <span className="px-2 py-1 bg-slate-800 rounded-full">
            IBKR {fmtMoney(byAccount.ibkr)}
          </span>
          <span className="px-2 py-1 bg-slate-800 rounded-full">
            Schwab {fmtMoney(byAccount.schwab)}
          </span>
          <span className="px-2 py-1 bg-slate-800 rounded-full">
            LeumiIRA {fmtMoney(byAccount.ira)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DividendsPage() {
  const [activeAccountTab, setActiveAccountTab] = useState<AccountKey>("ibkr");

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-100">Dividend Income</h1>

      {/* Summary header — total projected annual income + per-account chips */}
      <DividendsSummaryHeader />

      {/* 3-account tab bar — hardcoded: IBKR / Schwab / LeumiIRA */}
      <div className="flex flex-wrap p-1 bg-slate-900 rounded-lg border border-slate-800 gap-1 mb-6 w-fit">
        {ACCOUNT_TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeAccountTab === tab}
            onClick={() => setActiveAccountTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeAccountTab === tab
                ? "bg-slate-800 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
            data-testid={`div-tab-${tab}`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Per-tab: positions table + collapsible history. Key forces remount on tab switch. */}
      <DividendAccountTab key={activeAccountTab} accountKey={activeAccountTab} />
    </div>
  );
}
