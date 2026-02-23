"use client";

import React, { useState, useEffect, useMemo } from "react";
import StatsRow from "./StatsRow";
import PositionsTable, { Position } from "./PositionsTable";
import AddPositionModal from "./AddPositionModal";
import AccountSettings from "./AccountSettings";
import DeleteConfirmationModal from "./DeleteConfirmationModal";
import { useSettings } from "../../app/settings/SettingsContext";
import { convertCurrency, formatCurrency } from "@/lib/currency";

export default function DividendDashboard() {
    const { settings } = useSettings();
    // Tabs state
    const [accounts, setAccounts] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState("Summary");

    // Data state
    const [positions, setPositions] = useState<Position[]>([]);
    const [stats, setStats] = useState({ portfolio_yield: 0, annual_income: 0, dgr_5y: 0, currency: "USD" });
    const [loading, setLoading] = useState(true);

    // Modal states
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingPosition, setEditingPosition] = useState<Position | null>(null);

    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: number | null }>({
        isOpen: false,
        id: null
    });
    const [isDeleting, setIsDeleting] = useState(false);

    // Initial Fetch
    const fetchAccounts = async () => {
        try {
            const res = await fetch("/api/dividends/accounts");
            if (res.ok) {
                const data = await res.json();
                setAccounts(data);
            }
        } catch (err) {
            console.error("Error fetching accounts:", err);
        }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/dividends/dashboard?currency=${settings.mainCurrency}`);
            if (res.ok) {
                const data = await res.json();
                setStats(data.stats);
                setPositions(data.positions);
            }
        } catch (err) {
            console.error("Error fetching dividend dashboard:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    // Fetch data when settings (mainCurrency) or accounts change
    useEffect(() => {
        fetchData();
    }, [settings.mainCurrency]);

    // Derived state for current tab
    const filteredPositions = useMemo(() => {
        if (activeTab === "Summary" || activeTab === "Settings") return positions;
        return positions.filter(p => p.account === activeTab);
    }, [positions, activeTab]);

    const tabStats = useMemo(() => {
        const currentPositions = activeTab === "Summary" || activeTab === "Settings"
            ? positions
            : positions.filter(p => p.account === activeTab);

        if (currentPositions.length === 0) return { portfolio_yield: 0, annual_income: 0, dgr_5y: 0, currency: settings.mainCurrency };

        // For account tabs, we want to sum in the target currency (mainCurrency)
        const targetCurr = settings.mainCurrency;

        let totalValTarget = 0;
        let totalIncomeTarget = 0;

        currentPositions.forEach(p => {
            const posValueLocal = p.shares * p.price;
            totalValTarget += convertCurrency(posValueLocal, p.currency || "USD", targetCurr);
            totalIncomeTarget += convertCurrency(p.annual_income, p.currency || "USD", targetCurr);
        });

        let dgrSum = 0;
        let dgrCount = 0;
        currentPositions.forEach(p => {
            if (p.dgr_5y !== 0) {
                dgrSum += p.dgr_5y;
                dgrCount++;
            }
        });

        const avgDgr = dgrCount > 0 ? dgrSum / dgrCount : 0;
        const yieldVal = totalValTarget > 0 ? totalIncomeTarget / totalValTarget : 0;

        return {
            portfolio_yield: yieldVal,
            annual_income: totalIncomeTarget,
            dgr_5y: avgDgr,
            currency: targetCurr
        };
    }, [positions, activeTab, settings.mainCurrency]);

    // Override for Summary Tab
    const displayedStats = (activeTab === "Summary" || activeTab === "Settings") ? stats : tabStats;

    const handleSavePosition = async (posData: { account: string; ticker: string; shares: number; id?: number }) => {
        try {
            const method = posData.id ? "PUT" : "POST";
            const url = posData.id ? `/api/dividends/position/${posData.id}` : "/api/dividends/position";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    account: posData.account,
                    ticker: posData.ticker,
                    shares: posData.shares
                })
            });

            if (res.ok) {
                await fetchData();
                setIsAddModalOpen(false);
                setEditingPosition(null);
            } else {
                console.error("Failed to save position");
            }
        } catch (err) {
            console.error("Error saving position:", err);
        }
    };

    const confirmDelete = (id: number) => {
        setDeleteModal({ isOpen: true, id });
    };

    const handleExecuteDelete = async () => {
        if (!deleteModal.id) return;
        setIsDeleting(true);
        try {
            const res = await fetch(`/api/dividends/position/${deleteModal.id}`, { method: "DELETE" });
            if (res.ok) {
                setPositions(prev => prev.filter(p => p.id !== deleteModal.id));
                setDeleteModal({ isOpen: false, id: null });
            }
        } catch (err) {
            console.error("Error deleting position:", err);
        } finally {
            setIsDeleting(false);
        }
    };

    const openAddModal = () => {
        setEditingPosition(null);
        setIsAddModalOpen(true);
    };

    const openEditModal = (pos: Position) => {
        setEditingPosition(pos);
        setIsAddModalOpen(true);
    };

    // Auto-select account logic
    const defaultAccount = activeTab !== "Summary" && activeTab !== "Settings" ? activeTab : (accounts[0] || "");

    return (
        <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                {/* Tabs */}
                <div className="flex flex-wrap p-1 bg-slate-900 rounded-lg border border-slate-800 gap-1">
                    {["Summary", ...accounts].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === tab
                                ? "bg-slate-800 text-white shadow-sm"
                                : "text-slate-400 hover:text-slate-200"
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                    {/* Settings Tab Icon */}
                    <button
                        onClick={() => setActiveTab("Settings")}
                        className={`px-3 py-2 text-sm font-medium rounded-md transition-all flex items-center ${activeTab === "Settings"
                            ? "bg-slate-800 text-white shadow-sm"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        title="Manage Accounts"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </button>
                </div>

                {activeTab !== "Settings" && (
                    <button
                        onClick={openAddModal}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                        Add Position
                    </button>
                )}
            </div>

            {loading ? (
                <div className="text-center py-12 text-slate-500 animate-pulse">Loading dashboard...</div>
            ) : activeTab === "Settings" ? (
                <AccountSettings onAccountsChange={() => { fetchAccounts(); fetchData(); }} />
            ) : (
                <>
                    <StatsRow stats={displayedStats} />
                    <PositionsTable
                        positions={filteredPositions}
                        onDelete={confirmDelete}
                        onEdit={openEditModal}
                    />
                </>
            )}

            <AddPositionModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSave={handleSavePosition}
                initialData={editingPosition}
                availableAccounts={accounts}
                defaultAccount={defaultAccount}
            />

            <DeleteConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ ...deleteModal, isOpen: false })}
                onConfirm={handleExecuteDelete}
                isDeleting={isDeleting}
            />
        </div>
    );
}
