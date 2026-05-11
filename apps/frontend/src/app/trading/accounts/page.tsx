"use client";
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback } from "react";
import TradingAccountSettings from "@/components/trading/TradingAccountSettings";
import StockPositionsTable from "@/components/trading/accounts/StockPositionsTable";
import AccountHeader from "@/components/trading/accounts/AccountHeader";
import AggregatePortfolioFooter, { AccountBalance } from "@/components/trading/accounts/AggregatePortfolioFooter";
import AddPositionModal from "@/components/trading/accounts/AddPositionModal";
import {
  getTradingConfigs,
  getStockPositions,
  deleteStockPosition,
  type TradingAccountConfig,
  type StockPosition,
} from "@/app/trading/actions";

/** Normalise account_type to lowercase for tab logic. */
function normalizeType(t: string): string {
  return t.toLowerCase();
}

/** Display label for each account type. */
const TAB_LABELS: Record<string, string> = {
  ibkr: "InteractiveBrokers",
  schwab: "Schwab",
  ira: "LeumiIRA",
};

const TAB_ORDER: Record<string, number> = { ibkr: 0, schwab: 1, ira: 2 };

/** 3 tabs, always rendered unconditionally — mirrors dividends/page.tsx pattern. */
const ACCOUNT_TABS = (Object.keys(TAB_ORDER) as Array<keyof typeof TAB_ORDER>).sort(
  (a, b) => TAB_ORDER[a] - TAB_ORDER[b],
);

function sortConfigs(configs: TradingAccountConfig[]): TradingAccountConfig[] {
  return [...configs].sort((a, b) => {
    const aKey = normalizeType(a.account_type);
    const bKey = normalizeType(b.account_type);
    const aOrder = TAB_ORDER[aKey] ?? 99;
    const bOrder = TAB_ORDER[bKey] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

export default function TradingAccountsPage() {
  const [configs, setConfigs] = useState<TradingAccountConfig[]>([]);
  const [activeTab, setActiveTab] = useState<string>("ibkr");
  const [positionsByAccount, setPositionsByAccount] = useState<Map<number, StockPosition[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPosition, setEditingPosition] = useState<StockPosition | null>(null);

  const loadConfigs = useCallback(async () => {
    const data = await getTradingConfigs();
    const sorted = sortConfigs(data);
    setConfigs(sorted);
    return sorted;
  }, []);

  const loadPositions = useCallback(async (cfgs: TradingAccountConfig[]) => {
    const map = new Map<number, StockPosition[]>();
    await Promise.all(
      cfgs.map(async (cfg) => {
        const positions = await getStockPositions(cfg.id);
        map.set(cfg.id, positions);
      })
    );
    setPositionsByAccount(new Map(map));
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const cfgs = await loadConfigs();
      await loadPositions(cfgs);
      setLoading(false);
    };
    init();
  }, [loadConfigs, loadPositions]);

  const handleDeletePosition = async (id: string) => {
    await deleteStockPosition(id);
    // Reload just positions
    await loadPositions(configs);
  };

  const handleEditPosition = (position: StockPosition) => {
    setEditingPosition(position);
  };

  const handleEditSuccess = async () => {
    setEditingPosition(null);
    await loadPositions(configs);
  };

  const handleAddSuccess = async () => {
    await loadPositions(configs);
  };

  const activeConfig = configs.find(
    (c) => normalizeType(c.account_type) === activeTab
  );

  const accountBalances: AccountBalance[] = configs.map((cfg) => ({
    config: cfg,
    positions: positionsByAccount.get(cfg.id) ?? [],
  }));



  const isManualAccount = activeConfig
    ? ["schwab", "ira"].includes(normalizeType(activeConfig.account_type))
    : false;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8 text-slate-100">Stock Positions</h1>

      {/* Tab Bar */}
      <div className="flex flex-wrap p-1 bg-slate-900 rounded-lg border border-slate-800 gap-1 mb-6 w-fit">
        {ACCOUNT_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === tab
                ? "bg-slate-800 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
            data-testid={`account-tab-${tab}`}
          >
            {TAB_LABELS[tab] ?? tab.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() => setActiveTab("settings")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
            activeTab === "settings"
              ? "bg-slate-800 text-white shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
          data-testid="account-tab-settings"
        >
          Settings
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "settings" ? (
        <TradingAccountSettings />
      ) : loading ? (
        <div className="text-center py-12 text-slate-500 animate-pulse">
          Loading account data…
        </div>
      ) : activeConfig ? (
        <div>
          <AccountHeader
            config={activeConfig}
            onAddPosition={() => setShowAddModal(true)}
            onRefreshComplete={() => loadPositions(configs)}
            onImportSuccess={() => loadPositions(configs)}
          />
          {isManualAccount && (positionsByAccount.get(activeConfig.id) ?? []).length === 0 && (
            <div
              className="mb-4 flex items-start gap-3 p-4 bg-blue-950/40 border border-blue-800/60 rounded-lg text-blue-300 text-sm"
              data-testid="manual-empty-banner"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <span>
                No positions yet — add one below using the{" "}
                <strong className="font-semibold text-blue-200">+ Add Position</strong> button above.
              </span>
            </div>
          )}
          <StockPositionsTable
            mode={isManualAccount ? "editable" : "readonly"}
            positions={positionsByAccount.get(activeConfig.id) ?? []}
            onDelete={handleDeletePosition}
            onEdit={handleEditPosition}
          />
        </div>
      ) : (
        <div
          className="text-center py-20 bg-slate-900/50 rounded-2xl border border-dashed border-slate-800"
          data-testid="account-not-configured"
        >
          <p className="text-slate-300 mb-3 text-base font-medium">
            Account not configured — visit Settings to set up your{" "}
            {TAB_LABELS[activeTab] ?? activeTab.toUpperCase()} broker.
          </p>
          <button
            onClick={() => setActiveTab("settings")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Go to Settings
          </button>
        </div>
      )}

      {/* Aggregate Footer — visible when at least one account is configured */}
      {!loading && configs.length > 0 && (
        <AggregatePortfolioFooter accounts={accountBalances} />
      )}

      {/* Add Position Modal */}
      {showAddModal && activeConfig && (
        <AddPositionModal
          account={activeConfig}
          onClose={() => setShowAddModal(false)}
          onSuccess={handleAddSuccess}
        />
      )}

      {/* Edit Position Modal */}
      {editingPosition && activeConfig && (
        <AddPositionModal
          account={activeConfig}
          onClose={() => setEditingPosition(null)}
          onSuccess={handleEditSuccess}
          initialPosition={editingPosition}
        />
      )}
    </div>
  );
}
