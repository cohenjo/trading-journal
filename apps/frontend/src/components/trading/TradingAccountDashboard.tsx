"use client";

import React, { useState, useEffect } from "react";
import TradingStatsRow from "./TradingStatsRow";
import TradingPositionsTable from "./TradingPositionsTable";

export default function TradingAccountDashboard() {
    const [configs, setConfigs] = useState<any[]>([]);
    const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
    const [stats, setStats] = useState<any>({ net_liquidation: 0, total_cash: 0, currency: "USD", timestamp: "" });
    const [positions, setPositions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => {
        init();
    }, []);

    const init = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/trading/configs");
            if (res.ok) {
                const data = await res.json();
                setConfigs(data || []);
                if (data && data.length > 0) {
                    setActiveAccountId(data[0].id);
                    await fetchData(data[0].id);
                } else {
                    setLoading(false);
                }
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
            const idParam = accountId ? `?account_id=${accountId}` : "";
            const [summaryRes, positionsRes] = await Promise.all([
                fetch(`/api/trading/summary${idParam}`),
                fetch(`/api/trading/positions${idParam}`)
            ]);

            if (summaryRes.ok && positionsRes.ok) {
                const summaryData = await summaryRes.json();
                const positionsData = await positionsRes.json();
                setStats(summaryData || { net_liquidation: 0, total_cash: 0, currency: "USD", timestamp: "" });
                setPositions(positionsData || []);
            } else {
                setError("Failed to fetch data from database.");
            }
        } catch (err) {
            console.error("Error fetching trading data:", err);
            setError("Connection error. Is the backend running?");
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async () => {
        if (!activeAccountId) return;
        setSyncing(true);
        setError("");
        setMessage("");

        const config = configs.find(c => c.id === activeAccountId);
        const brokerName = config?.account_type || "Broker";

        try {
            const res = await fetch(`/api/trading/sync?account_id=${activeAccountId}`, { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                setMessage(`Sync successful! Updated ${data.positions_count} positions.`);
                await fetchData(activeAccountId);
            } else {
                const errData = await res.json().catch(() => ({ detail: "Sync failed" }));
                setError(errData.detail || `Sync failed. Check ${brokerName} connection.`);
            }
        } catch (err) {
            setError("Sync error. Is the backend running?");
        } finally {
            setSyncing(false);
        }
    };

    const handlePushToDividends = async () => {
        setSyncing(true);
        setError("");
        setMessage("");
        try {
            const res = await fetch("/api/trading/sync-to-dividends", { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                setMessage(data.message || "Successfully pushed stock positions to Dividends dashboard.");
            } else {
                const errData = await res.json().catch(() => ({ detail: "Sync failed" }));
                setError(errData.detail || "Failed to push positions to Dividends dashboard.");
            }
        } catch (err) {
            setError("Connection error. Is the backend running?");
        } finally {
            setSyncing(false);
        }
    };

    const handleAccountChange = (id: number) => {
        setActiveAccountId(id);
        setLoading(true);
        fetchData(id);
    };

    if (loading && !syncing) {
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

    const lastSynced = stats?.timestamp ? new Date(stats.timestamp).toLocaleString() : "Never";
    const activeConfig = configs.find(c => c.id === activeAccountId);

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
                        onClick={() => fetchData(activeAccountId)}
                        className="p-2 text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-sm"
                        title="Refresh from Database"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                        Reload
                    </button>

                    <button
                        onClick={handlePushToDividends}
                        disabled={syncing || positions.length === 0}
                        className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20"
                        title="Update Dividend Dashboard with all synced STK positions"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h4v4"></path><path d="M20 4L12 12"></path><path d="M8 20l8-8"></path><path d="M4 16v4h4"></path></svg>
                        Push Stocks to Dividends
                    </button>

                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-blue-900/20"
                    >
                        {syncing ? (
                            <>
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                Syncing with {activeConfig?.account_type}...
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
                                Sync with {activeConfig?.account_type}
                            </>
                        )}
                    </button>
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

            {message && (
                <div className="bg-emerald-900/20 border border-emerald-900/50 text-emerald-400 p-4 rounded-lg mb-6 flex items-start gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    <p className="text-sm">{message}</p>
                </div>
            )}

            <TradingStatsRow stats={stats} />
            <TradingPositionsTable positions={positions} />
        </div>
    );
}

