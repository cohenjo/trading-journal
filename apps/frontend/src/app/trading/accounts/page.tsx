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

  const phase2Configs = configs.filter((c) =>
    ["ibkr", "schwab", "ira"].includes(normalizeType(c.account_type))
  );

  const tabs = [
    ...phase2Configs.map((c) => normalizeType(c.account_type)),
    "settings",
  ];

  const isManualAccount = activeConfig
    ? ["schwab", "ira"].includes(normalizeType(activeConfig.account_type))
    : false;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8 text-slate-100">Stock Positions</h1>

      {/* Tab Bar */}
      <div className="flex flex-wrap p-1 bg-slate-900 rounded-lg border border-slate-800 gap-1 mb-6 w-fit">
        {phase2Configs.map((cfg) => {
          const typeKey = normalizeType(cfg.account_type);
          const isActive = activeTab === typeKey;
          return (
            <button
              key={cfg.id}
              onClick={() => setActiveTab(typeKey)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                isActive
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              data-testid={`tab-${typeKey}`}
            >
              {TAB_LABELS[typeKey] ?? typeKey.toUpperCase()}
            </button>
          );
        })}
        <button
          onClick={() => setActiveTab("settings")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
            activeTab === "settings"
              ? "bg-slate-800 text-white shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
          data-testid="tab-settings"
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
          />
          <StockPositionsTable
            mode={isManualAccount ? "editable" : "readonly"}
            positions={positionsByAccount.get(activeConfig.id) ?? []}
            onDelete={handleDeletePosition}
          />
        </div>
      ) : (
        <div className="text-center py-20 bg-slate-900/50 rounded-2xl border border-dashed border-slate-800">
          <p className="text-slate-400 mb-2">No accounts configured for this tab.</p>
          <p className="text-sm text-slate-500">Go to Settings to configure your accounts.</p>
        </div>
      )}

      {/* Aggregate Footer — always visible */}
      {!loading && tabs.length > 1 && (
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
    </div>
  );
}
