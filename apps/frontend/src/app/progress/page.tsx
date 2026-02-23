'use client';

import React, { useState, useEffect } from 'react';
import { ProgressChart } from '@/components/Progress/ProgressChart';
import { ProgressTable } from '@/components/Progress/ProgressTable';
import { AddHistoryModal, ProgressSummary } from '@/components/Progress/AddHistoryModal';
import { useSettings } from '../settings/SettingsContext';

async function fetchHistory() {
    try {
        const res = await fetch('/api/finances/history?limit=100');
        if (!res.ok) throw new Error('Failed to fetch history');
        const data = await res.json();
        // Map backend model to frontend summary
        // Backend returns FinanceSnapshot objects which contain data dict
        return data.map((d: any) => ({
            date: d.date,
            net_worth: d.net_worth,
            total_assets: d.total_assets,
            total_liabilities: d.total_liabilities,
            // The following might be in d.data (the json column) or computed if we updated backend to return them.
            // Based on my backend update, I didn't add them as columns on FinanceSnapshot, 
            // so they are in d.data.total_savings etc.
            total_savings: d.data.total_savings || 0,
            total_investments: d.data.total_investments || 0
        }));
    } catch (err) {
        console.error(err);
        return [];
    }
}

async function saveHistory(summary: ProgressSummary) {
    try {
        const payload = {
            items: [],
            date: summary.date,
            net_worth: summary.net_worth,
            total_assets: summary.total_assets,
            total_liabilities: summary.total_liabilities,
            total_savings: summary.total_savings,
            total_investments: summary.total_investments
        };

        const res = await fetch('/api/finances/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error('Failed to save history');
        return await res.json();
    } catch (err) {
        console.error(err);
        alert('Failed to save.');
    }
}

async function deleteHistory(date: string) {
    try {
        const res = await fetch(`/api/finances/${date}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete history');
        return true;
    } catch (err) {
        console.error(err);
        alert('Failed to delete.');
        return false;
    }
}

export default function ProgressPage() {
    const { settings } = useSettings();
    const [data, setData] = useState<ProgressSummary[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ProgressSummary | null>(null);

    const loadData = () => {
        fetchHistory().then(setData);
    }

    useEffect(() => {
        loadData();
    }, []);

    const handleCreate = async (newItem: ProgressSummary) => {
        await saveHistory(newItem);
        loadData(); // Refresh list
    };

    const handleEdit = (item: ProgressSummary) => {
        setEditingItem(item);
        setIsModalOpen(true);
    };

    const handleDelete = async (date: string) => {
        if (confirm('Are you sure you want to delete this record?')) {
            await deleteHistory(date);
            loadData();
        }
    };

    // Prepare chart data (Net Worth over time)
    const chartData = data.map(d => ({
        time: d.date,
        value: d.net_worth
    }));

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
                <header className="mb-8 flex justify-between items-end">
                    <div>
                        <h1 className="text-3xl font-bold mb-2">Progress</h1>
                        <div className="flex gap-8 text-sm">
                            <div>
                                <span className="text-slate-500 block text-xs uppercase tracking-wider mb-1">Net Worth</span>
                                <span className="text-2xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                                    {data.length > 0
                                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency, maximumFractionDigits: 0 }).format(data[0].net_worth)
                                        : new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency, maximumFractionDigits: 0 }).format(0)}
                                </span>
                            </div>
                            <div>
                                <span className="text-slate-500 block text-xs uppercase tracking-wider mb-1">Current Assets</span>
                                <span className="text-xl font-semibold text-slate-300">
                                    {data.length > 0
                                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency, compactDisplay: 'short' }).format(data[0].total_assets)
                                        : new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency, maximumFractionDigits: 0 }).format(0)}
                                </span>
                            </div>
                            <div>
                                <span className="text-slate-500 block text-xs uppercase tracking-wider mb-1">Liabilities</span>
                                <span className="text-xl font-semibold text-red-400">
                                    {data.length > 0
                                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency, compactDisplay: 'short' }).format(data[0].total_liabilities)
                                        : new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency, maximumFractionDigits: 0 }).format(0)}
                                </span>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => { setEditingItem(null); setIsModalOpen(true); }}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm transition-all shadow-sm"
                    >
                        <span>+</span> Add Historic Record
                    </button>
                </header>

                {/* Graph Section */}
                <section className="mb-12 bg-slate-900/30 border border-slate-800/50 rounded-xl p-6 relative">
                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6 absolute top-6 left-6 z-10">Net Worth History</h3>
                    {chartData.length > 0 ? (
                        <ProgressChart data={chartData} />
                    ) : (
                        <div className="h-[300px] flex items-center justify-center text-slate-500">
                            No data to display
                        </div>
                    )}
                </section>

                {/* Table Section */}
                <section>
                    <h3 className="text-xl font-bold mb-4">Progress Points</h3>
                    <ProgressTable
                        data={data}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        currency={settings.mainCurrency}
                    />
                </section>

                <AddHistoryModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleCreate}
                    initialData={editingItem || undefined}
                />

            </div>
        </div>
    );
}
