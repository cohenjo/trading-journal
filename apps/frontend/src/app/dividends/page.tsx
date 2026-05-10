"use client";
export const dynamic = 'force-dynamic';

import { useState } from "react";
import DividendDashboard from "../../components/Dividends/DividendDashboard";

/** Maps internal account type key → display label (mirrors Trading Accounts page). */
const TAB_LABELS: Record<string, string> = {
  ibkr:  "InteractiveBrokers",
  schwab: "Schwab",
  ira:   "LeumiIRA",
};

const TAB_ORDER: Record<string, number> = { ibkr: 0, schwab: 1, ira: 2 };

const ACCOUNT_TABS = (Object.keys(TAB_ORDER) as Array<keyof typeof TAB_ORDER>).sort(
  (a, b) => TAB_ORDER[a] - TAB_ORDER[b],
);

export default function DividendsPage() {
  const [activeAccountTab, setActiveAccountTab] = useState<string>("ibkr");

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-100">Dividend Dashboard</h1>

      {/* 3-account tab bar — IBKR / Schwab / LeumiIRA */}
      <div className="flex flex-wrap p-1 bg-slate-900 rounded-lg border border-slate-800 gap-1 mb-6 w-fit">
        {ACCOUNT_TABS.map((tab) => (
          <button
            key={tab}
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

      <DividendDashboard accountNameFilter={TAB_LABELS[activeAccountTab]} />
    </div>
  );
}
