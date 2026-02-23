'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useSettings } from '../settings/SettingsContext';
import { CashFlowSankey } from '@/components/CashFlow/CashFlowSankey';
import { PlanData } from '@/components/Plan/types';

// Fetch Utilities (Duplicated from PlanPage for now)
async function fetchLatestPlan() {
    const res = await fetch('/api/plans/latest');
    if (res.ok) return res.json();
    return null;
}

async function fetchFinances() {
    const res = await fetch('/api/finances/latest');
    if (res.ok) return res.json();
    return {
        net_worth: 0,
        total_assets: 0,
        total_liabilities: 0,
        date: new Date().toISOString().split('T')[0],
        data: { items: [], total_investments: 0, total_savings: 0 }
    };
}

export default function CashFlowPage() {
    const { settings } = useSettings();
    const [plan, setPlan] = useState<any>(null);
    const [finances, setFinances] = useState<any>(null);
    const [projection, setProjection] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

    // Initial Load
    useEffect(() => {
        Promise.all([fetchLatestPlan(), fetchFinances()]).then(([planData, financeData]) => {
            setFinances(financeData);
            if (planData) setPlan(planData);
            setLoading(false);
        });
    }, []);

    // Simulation Effect
    useEffect(() => {
        if (!plan || !plan.data || !finances) return;

        // Debounce slightly
        const timer = setTimeout(() => {
            fetch('/api/plans/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan: plan.data,
                    finances: finances,
                    settings: settings
                })
            })
                .then(async res => {
                    if (!res.ok) {
                        const txt = await res.text();
                        console.error("Simulation failed response:", txt);
                        throw new Error("Simulation failed: " + txt);
                    }
                    return res.json();
                })
                .then(data => {
                    const formatted = data.map((p: any) => ({
                        time: `${p.year}-01-01`,
                        value: p.net_worth,
                        ...p
                    }));
                    setProjection(formatted);
                    if (formatted.length > 0) {
                        // If selected year is invalid, reset to start
                        setSelectedYear(prev => {
                            const exists = formatted.find((p: any) => p.year === prev);
                            return exists ? prev : formatted[0].year;
                        });
                    }
                })
                .catch(err => console.error("Simulation error:", err));
        }, 300);

        return () => clearTimeout(timer);
    }, [plan, finances, settings]);

    // Derived Data
    const selectedData = useMemo(() => {
        return projection.find(p => p.year === selectedYear) || null;
    }, [projection, selectedYear]);

    const minYear = projection.length > 0 ? projection[0].year : new Date().getFullYear();
    const maxYear = projection.length > 0 ? projection[projection.length - 1].year : new Date().getFullYear() + 40;

    // Ages
    const primaryBirthYear = settings?.primaryUser?.birthYear || 1980;
    const spouseBirthYear = settings?.spouse?.birthYear;

    const primaryAge = selectedYear - primaryBirthYear;
    const spouseAge = spouseBirthYear ? selectedYear - spouseBirthYear : null;

    if (loading) return <div className="min-h-screen bg-slate-950 p-8 text-slate-400">Loading cash flow data...</div>;

    return (
        <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden flex-col">

            {/* Header & Slider Section */}
            <div className="p-6 md:p-8 border-b border-slate-800 bg-slate-900/40">
                <div className="max-w-6xl mx-auto w-full">
                    <div className="flex justify-between items-end mb-6">
                        <div>
                            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
                                Cash Flow Analysis
                            </h1>
                            <p className="text-slate-400 mt-1">
                                Visualize income, expenses, and savings flow
                            </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <div className="text-3xl font-mono text-slate-100 font-bold">
                                {selectedYear}
                            </div>
                            <div className="flex items-center gap-3 text-slate-400 text-sm">
                                <span>Age {primaryAge}</span>
                                {spouseAge && <span className="opacity-60">Spouse {spouseAge}</span>}
                            </div>
                        </div>
                    </div>

                    {/* Timeline Slider */}
                    <div className="flex flex-col gap-2">
                        <input
                            type="range"
                            min={minYear}
                            max={maxYear}
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                            className="w-full h-3 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 transition-all"
                        />
                        <div className="flex justify-between text-xs text-slate-500 font-mono">
                            <span>{minYear}</span>
                            <span>{maxYear}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content: Sankey Chart */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                <div className="max-w-6xl mx-auto w-full h-full flex flex-col">
                    <CashFlowSankey data={selectedData} currency={settings.mainCurrency || 'USD'} />

                    {/* Summary Cards below chart */}
                    {selectedData && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                            <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase font-semibold">Total Inflow</span>
                                <div className="text-xl font-mono text-emerald-400 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency || 'USD', maximumFractionDigits: 0 }).format((selectedData.income || 0) + (selectedData.withdrawals || 0))}
                                </div>
                            </div>
                            <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase font-semibold">Spending</span>
                                <div className="text-xl font-mono text-fuchsia-400 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency || 'USD', maximumFractionDigits: 0 }).format(selectedData.expenses)}
                                </div>
                            </div>
                            <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase font-semibold">Taxes</span>
                                <div className="text-xl font-mono text-slate-400 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency || 'USD', maximumFractionDigits: 0 }).format(selectedData.tax_paid)}
                                </div>
                            </div>
                            <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase font-semibold">Net Savings</span>
                                <div className="text-xl font-mono text-cyan-400 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency || 'USD', maximumFractionDigits: 0 }).format((selectedData.income || 0) + (selectedData.withdrawals || 0) - (selectedData.tax_paid || 0) - (selectedData.expenses || 0))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
