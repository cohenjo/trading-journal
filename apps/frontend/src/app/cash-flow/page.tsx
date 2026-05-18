'use client';
export const dynamic = 'force-dynamic';
import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSettings } from '../settings/SettingsContext';
import { CashFlowSankey } from '@/components/CashFlow/CashFlowSankey';
import { PlanData } from '@/components/Plan/types';
import { getLatestPlan, runPlanSimulation } from '../plan/actions';
import { getLatestFinanceSnapshot } from '../finances/actions';
import { getDividendSummary } from '../dividends/actions';
import { getLadderIncome } from '../ladder/actions';
import type { BondIncomePoint, DividendIncomeTotal } from '../plan/simulation';

type CashFlowDisplayMode = 'yearly' | 'monthly';

export default function CashFlowPage() {
    const { settings } = useSettings();
    const [plan, setPlan] = useState<any>(null);
    const [finances, setFinances] = useState<any>(null);
    const [dividendTotal, setDividendTotal] = useState<DividendIncomeTotal | undefined>(undefined);
    const [dividendByAccount, setDividendByAccount] = useState<{ ibkr: number; schwab: number; ira: number } | undefined>(undefined);
    const [bondProjection, setBondProjection] = useState<BondIncomePoint[]>([]);
    const [projection, setProjection] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
    const [displayMode, setDisplayMode] = useState<CashFlowDisplayMode>('yearly');

    // Initial Load — fetch plan, finances, and the 3 summary income streams in parallel
    useEffect(() => {
        Promise.all([
            getLatestPlan(),
            getLatestFinanceSnapshot(),
            getDividendSummary(),
            getLadderIncome(),
        ]).then(([planData, financeData, dividendData, bondData]) => {
            setFinances(financeData);
            if (planData) setPlan(planData);

            // Dividend: total_forward_annual is already USD, major units (Round 8 contract)
            setDividendTotal({ annualTotal: dividendData.total_forward_annual });
            setDividendByAccount(dividendData.by_account);

            // Bond ladder: income_series is per-year { date: "YYYY-01-01", value: number }
            if (bondData.ok && bondData.data) {
                const bondPoints: BondIncomePoint[] = bondData.data.income_series.map(
                    (pt: { date: string; value: number }) => ({
                        year: new Date(pt.date).getUTCFullYear(),
                        amount: pt.value,
                    }),
                );
                setBondProjection(bondPoints);
            }

            setLoading(false);
        });
    }, []);

    // Simulation Effect — includes virtual income streams so Sankey reflects all 3 (#441)
    useEffect(() => {
        if (!plan || !plan.data || !finances) return;

        // Debounce slightly
        const timer = setTimeout(() => {
            runPlanSimulation({
                plan: plan.data,
                finances,
                settings: settings as unknown as Record<string, unknown>,
                dividendTotal,
                dividendByAccount,
                bondProjection,
            })
                .then(data => {
                    const formatted = data.map(p => ({
                        time: `${p.year}-01-01`,
                        value: p.net_worth,
                        ...p
                    }));
                    setProjection(formatted);
                    if (formatted.length > 0) {
                        // If selected year is invalid, reset to start
                        setSelectedYear(prev => {
                            const exists = formatted.find(p => p.year === prev);
                            return exists ? prev : formatted[0].year;
                        });
                    }
                })
                .catch(err => console.error("Cash-flow simulation Server Action error:", err));
        }, 300);

        return () => clearTimeout(timer);
    }, [plan, finances, settings, dividendTotal, dividendByAccount, bondProjection]);

    // Derived Data
    const selectedData = useMemo(() => {
        return projection.find(p => p.year === selectedYear) || null;
    }, [projection, selectedYear]);

    // Scale data for monthly/yearly display mode
    const displayData = useMemo(() => {
        if (!selectedData) return null;
        if (displayMode === 'yearly') return selectedData;
        const divisor = 12;
        const scale = (v: number | undefined | null) => (typeof v === 'number' ? v / divisor : v);
        return {
            ...selectedData,
            income: scale(selectedData.income),
            withdrawals: scale(selectedData.withdrawals),
            tax_paid: scale(selectedData.tax_paid),
            expenses: scale(selectedData.expenses),
            income_details: selectedData.income_details?.map((d: Record<string, unknown>) => ({ ...d, value: scale(d.value as number | undefined | null), gross: scale(d.gross as number | undefined | null), tax: scale(d.tax as number | undefined | null) })),
            expense_details: selectedData.expense_details?.map((d: Record<string, unknown>) => ({ ...d, value: scale(d.value as number | undefined | null) })),
            savings_details: selectedData.savings_details?.map((d: Record<string, unknown>) => ({ ...d, value: scale(d.value as number | undefined | null) })),
            withdrawal_details: selectedData.withdrawal_details?.map((d: Record<string, unknown>) => ({ ...d, value: scale(d.value as number | undefined | null) })),
        };
    }, [selectedData, displayMode]);

    const minYear = projection.length > 0 ? projection[0].year : new Date().getFullYear();
    const maxYear = projection.length > 0 ? projection[projection.length - 1].year : new Date().getFullYear() + 40;

    // Ages
    const primaryBirthYear = settings?.primaryUser?.birthYear || 1980;
    const spouseBirthYear = settings?.spouse?.birthYear;

    const primaryAge = selectedYear - primaryBirthYear;
    const spouseAge = spouseBirthYear ? selectedYear - spouseBirthYear : null;

    if (loading) return <div className="min-h-screen bg-slate-950 p-8 text-slate-400">Loading cash flow data...</div>;

    if (!plan || !plan.data) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <div className="text-center max-w-md px-6">
                    <div className="text-5xl mb-6">📊</div>
                    <h2 className="text-2xl font-bold text-slate-100 mb-3">No financial plan yet</h2>
                    <p className="text-slate-400 mb-8">
                        Cash flow projections appear once you create your financial plan. Add your income, expenses, and accounts to see the full picture.
                    </p>
                    <Link
                        href="/plan"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
                    >
                        Create your plan →
                    </Link>
                </div>
            </div>
        );
    }

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
                        <div className="flex flex-col items-end gap-2">
                            <div className="text-3xl font-mono text-slate-100 font-bold">
                                {selectedYear}
                            </div>
                            <div className="flex items-center gap-3 text-slate-400 text-sm">
                                <span>Age {primaryAge}</span>
                                {spouseAge && <span className="opacity-60">Spouse {spouseAge}</span>}
                            </div>
                            <div role="group" aria-label="Display mode" className="inline-flex rounded-lg bg-slate-900/60 p-1 border border-slate-800">
                                <button
                                    type="button"
                                    aria-pressed={displayMode === 'yearly'}
                                    onClick={() => setDisplayMode('yearly')}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                                        displayMode === 'yearly' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    Yearly
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={displayMode === 'monthly'}
                                    onClick={() => setDisplayMode('monthly')}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                                        displayMode === 'monthly' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    Monthly
                                </button>
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
                    <CashFlowSankey data={displayData} currency={settings.mainCurrency || 'USD'} />

                    {/* Summary Cards below chart */}
                    {displayData && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                            <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase font-semibold">Total Inflow{displayMode === 'monthly' ? ' / mo' : ''}</span>
                                <div className="text-xl font-mono text-emerald-400 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency || 'USD', maximumFractionDigits: 0 }).format((displayData.income || 0) + (displayData.withdrawals || 0))}
                                </div>
                            </div>
                            <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase font-semibold">Spending{displayMode === 'monthly' ? ' / mo' : ''}</span>
                                <div className="text-xl font-mono text-fuchsia-400 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency || 'USD', maximumFractionDigits: 0 }).format(displayData.expenses)}
                                </div>
                            </div>
                            <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase font-semibold">Taxes{displayMode === 'monthly' ? ' / mo' : ''}</span>
                                <div className="text-xl font-mono text-slate-400 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency || 'USD', maximumFractionDigits: 0 }).format(displayData.tax_paid)}
                                </div>
                            </div>
                            <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800">
                                <span className="text-xs text-slate-500 uppercase font-semibold">Net Savings{displayMode === 'monthly' ? ' / mo' : ''}</span>
                                <div className="text-xl font-mono text-cyan-400 mt-1">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.mainCurrency || 'USD', maximumFractionDigits: 0 }).format((displayData.income || 0) + (displayData.withdrawals || 0) - (displayData.tax_paid || 0) - (displayData.expenses || 0))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
