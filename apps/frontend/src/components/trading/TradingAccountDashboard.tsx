"use client";

import React, { useState, useEffect } from "react";
import {
    getTradingConfigs,
    getTradingPositions,
    getTradingSummary,
    type TradingAccountConfig,
    type TradingAccountSummary,
    type TradingPosition,
} from '@/app/trading/actions';
import TradingStatsRow from "./TradingStatsRow";
import TradingPositionsTable from "./TradingPositionsTable";

export default function TradingAccountDashboard() {
    const [configs, setConfigs] = useState<TradingAccountConfig[]>([]);
    const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
    const [stats, setStats] = useState<TradingAccountSummary | { net_liquidation: number; total_cash: number; currency: string; timestamp: string }>({ net_liquidation: 0, total_cash: 0, currency: "USD", timestamp: "" });
    const [positions, setPositions] = useState<TradingPosition[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        init();
    }, []);

    const init = async () => {
        setLoading(true);
        try {
            const data = await getTradingConfigs();
            setConfigs(data);
            if (data.length > 0) {
                setActiveAccountId(data[0].id);
                await fetchData(data[0].id);
            } else {
                setLoading(false);
            }
        } catch (err) {
            console.error("Error initializing dashboard:", err);
            setLoading(false);
        }
    };

    const fetchData = async (accountId: number | null) => {
        setError("");
        try {
            const [summaryData, positionsData] = await Promise.all([
                getTradingSummary(accountId),
                getTradingPositions(accountId)
            ]);

            setStats(summaryData || { net_liquidation: 0, total_cash: 0, currency: "USD", timestamp: "" });
            setPositions(positionsData);
        } catch (err) {
            console.error("Error fetching trading data:", err);
            setError("Unable to load trading data from Supabase.");
        } finally {
            setLoading(false);
        }
    };

    const reloadAccountData = async () => {
        await fetchData(activeAccountId);
        const latestConfigs = await getTradingConfigs();
        setConfigs(latestConfigs);
    };

    const handleAccountChange = (id: number) => {
        setActiveAccountId(id);
        setLoading(true);
        fetchData(id);
    };

    if (loading) {
        return <div className="text-center py-12 text-slate-500 animate-pulse">Loading trading data...</div>;
    }

    if (configs.length === 0) {
        return (
            <div className="text-center py-20 bg-slate-900/50 rounded-2xl border border-dashed border-slate-800">
                <p className="text-slate-400 mb-4">No trading accounts configured.</p>
                <p className="text-sm text-slate-500">Go to Settings to add an IBKR or Schwab account.</p>
            </div>
        );
    }

    const activeConfig = configs.find(c => c.id === activeAccountId);
    const freshnessTimestamp = activeConfig?.last_synced_at || activeConfig?.last_synced || stats?.timestamp;
    const lastSynced = freshnessTimestamp ? new Date(freshnessTimestamp).toLocaleString() : "Never";

    return (
        <div className="space-y-6">
            {/* Account Selector */}
            <div className="flex flex-wrap gap-4 items-center">
                {configs.map(c => (
                    <button
                        key={c.id}
                        onClick={() => handleAccountChange(c.id)}
                        className={`px-4 py-2 rounded-lg border transition-all ${activeAccountId === c.id
                            ? "bg-blue-600/20 border-blue-500 text-blue-100 ring-1 ring-blue-500/50"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                            }`}
                    >
                        {c.name}
                    </button>
                ))}
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="text-slate-400 text-sm">
                    {activeConfig?.account_type} Account: <span className="text-slate-200 font-medium">{activeConfig?.name}</span>
                    <span className="mx-2 opacity-30">|</span>
                    Last Synced: <span className="text-slate-200 font-medium">{lastSynced}</span>
                </div>
                <div className="flex flex-wrap gap-4">
                    <button
                        onClick={reloadAccountData}
                        className="p-2 text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-sm"
                        title="Reload latest synced data from Supabase"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                        Reload
                    </button>

                    <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-400">
                        Sync runs in the background every 15 minutes when IB Gateway is online.
                    </div>
                </div>
            </div>

            {error && (
                <div className="bg-red-900/20 border border-red-900/50 text-red-400 p-4 rounded-lg mb-6 flex items-start gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <div>
                        <p className="font-semibold">Issue</p>
                        <p className="text-sm opacity-90">{error}</p>
                    </div>
                </div>
            )}


            <TradingStatsRow stats={stats} />
            <TradingPositionsTable positions={positions} />
        </div>
    );
}
