'use client';
export const dynamic = 'force-dynamic';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { PlanChart } from '@/components/Plan/PlanChart';
import { PlanEditor } from '@/components/Plan/PlanEditor';
import { PlanDetailsPane } from '@/components/Plan/PlanDetailsPane';
import { Plan, PlanData } from '@/components/Plan/types';
import { useSettings } from '../settings/SettingsContext';
import { createPlan, getLatestPlan, runPlanSimulation, updatePlan } from './actions';
import { getLatestFinanceSnapshot } from '../finances/actions';
import { getOptionsIncomeEstimation } from '../options/actions';
import { getDividendSummary } from '../dividends/actions';
import { getLadderIncome } from '../ladder/actions';
import type { BondIncomePoint, DividendIncomeTotal } from './simulation';

export default function PlanPage() {
    const { settings } = useSettings();
    const [plan, setPlan] = useState<Plan | null>(null);
    const [finances, setFinances] = useState<any>(null);
    const [optionsProjection, setOptionsProjection] = useState<Array<{ year: number; expectedIncome: number }>>([]);
    const [dividendTotal, setDividendTotal] = useState<DividendIncomeTotal | undefined>(undefined);
    const [dividendByAccount, setDividendByAccount] = useState<{ ibkr: number; schwab: number; ira: number } | undefined>(undefined);
    const [bondProjection, setBondProjection] = useState<BondIncomePoint[]>([]);
    const [projection, setProjection] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

    // Initial Load
    useEffect(() => {
        Promise.all([
            getLatestPlan(),
            getLatestFinanceSnapshot(),
            getOptionsIncomeEstimation(),
            getDividendSummary(),
            getLadderIncome(),
        ]).then(([planData, financeData, optionsData, dividendData, bondData]) => {
            setFinances(financeData);
            setOptionsProjection(optionsData.projections);

            // Wire dividend summary: total_forward_annual is already USD, major units.
            // Display as constant annual income across all plan years.
            setDividendTotal({ annualTotal: dividendData.total_forward_annual });
            setDividendByAccount(dividendData.by_account);

            // Wire bond ladder income: income_series is per-year { date, value } from buildIncome().
            // Parse year from "YYYY-01-01" date strings.
            if (bondData.ok && bondData.data) {
                const bondPoints: BondIncomePoint[] = bondData.data.income_series.map(
                    (pt: { date: string; value: number }) => ({
                        year: new Date(pt.date).getUTCFullYear(),
                        amount: pt.value,
                    }),
                );
                setBondProjection(bondPoints);
            }
            // If bondData.ok === false, leave bondProjection empty — no bond rows shown.
            if (planData) {
                setPlan(planData);
            } else {
                // Initialize default empty plan
                setPlan({
                    name: 'My Plan',
                    data: { items: [], milestones: [], settings: {} },
                    created_at: new Date().toISOString()
                });
            }
            setLoading(false);
        });
    }, []);

    // Save Handler (Debounced ideal, simple here)
    const handleUpdatePlanData = async (newData: PlanData) => {
        if (!plan) return;

        const previousPlan = plan;
        const updatedPlan = { ...plan, data: newData };
        setPlan(updatedPlan); // Optimistic Update

        if (plan.id) {
            const result = await updatePlan(plan.id, { data: newData });
            if (result.ok) {
                setPlan(result.plan);
            } else {
                // Rollback and surface the error
                setPlan(previousPlan);
                const message = result.error ?? 'Failed to save plan. Please try again.';
                console.error('[plan] updatePlan failed:', message);
                toast.error('Plan not saved', { description: message });
            }
        } else {
            const result = await createPlan(newData);
            if (result.ok) {
                setPlan(result.plan);
            } else {
                // Rollback and surface the error
                setPlan(previousPlan);
                const message = result.error ?? 'Failed to create plan. Please try again.';
                console.error('[plan] createPlan failed:', message);
                toast.error('Plan not saved', { description: message });
            }
        }
    };

    // Server-Side Simulation Effect
    useEffect(() => {
        if (!plan || !plan.data) return;

        const timer = setTimeout(() => {
            runPlanSimulation({
                plan: plan.data,
                finances,
                settings: settings as unknown as Record<string, unknown>,
                optionsProjection,
                dividendTotal,
                // @ts-expect-error pending PR squad/cashflow-dividend-redesign — McManus is adding dividendByAccount
                dividendByAccount,
                bondProjection,
            })
                .then(data => {
                    const formatted = data.map(p => ({
                        time: `${p.year}-01-01`,
                        value: p.net_worth, // Default view
                        ...p
                    }));
                    setProjection(formatted);
                    // Set initial selected year if not set or out of range
                    if (formatted.length > 0) {
                        setSelectedYear(prev => {
                            const exists = formatted.find(p => p.year === prev);
                            return exists ? prev : formatted[0].year;
                        });
                    }
                })
                .catch(err => console.error("Plan simulation Server Action error:", err));
        }, 500); // 500ms debounce

        return () => clearTimeout(timer);
    }, [plan, finances, settings, optionsProjection, dividendTotal, dividendByAccount, bondProjection]); // Re-run when any input changes

    // Calculate Markers
    const markers = useMemo(() => {
        if (!plan || !plan.data) return [];
        const startYear = new Date().getFullYear();
        const primaryBirthYear = settings?.primaryUser?.birthYear || 1980;
        const spouseBirthYear = settings?.spouse?.birthYear || primaryBirthYear; // Fallback

        const planItems = plan.data.items || [];
        const financeItems = finances?.data?.items || [];

        // Helper to find account settings
        const getPensionStartYear = (name: string): number | null => {
            // Check Plan Item first (Override)
            const pItem = planItems.find(i => i.name === name && i.category === 'Account');
            if (pItem?.account_settings?.starting_age) {
                const owner = pItem.owner === 'Spouse' ? 'Spouse' : 'You';
                const birthYear = owner === 'Spouse' ? spouseBirthYear : primaryBirthYear;
                return birthYear + pItem.account_settings.starting_age;
            }

            // Check Finance Item (Default)
            const fItem = financeItems.find((i: any) => i.name === name);
            if (fItem?.details?.starting_age) {
                const owner = fItem.owner === 'Spouse' ? 'Spouse' : 'You'; // Assuming finance item has owner? or default to You
                const birthYear = owner === 'Spouse' ? spouseBirthYear : primaryBirthYear;
                return birthYear + Number(fItem.details.starting_age);
            }
            return null;
        };

        // Pension Markers
        const pensionMarkers = financeItems
            .filter((f: any) => (f.type || '').toLowerCase().includes('pension'))
            .map((f: any) => {
                const year = getPensionStartYear(f.name);
                if (!year) return null;

                const isSpouse = f.owner === 'Spouse'; // Check if finance item has owner
                const label = isSpouse ? `${settings?.spouse?.name || 'Spouse'} Pension` : `${settings?.primaryUser?.name || 'You'} Pension`;

                // Avoid duplicate markers if milestone exists with same name?
                // But Milestones have unique IDs.

                return {
                    time: `${year}-01-01`,
                    position: 'aboveBar',
                    color: isSpouse ? '#8b5cf6' : '#3b82f6', // Violet vs Blue
                    shape: 'arrowDown',
                    text: label,
                    id: `pension_marker_${f.id}`
                };
            })
            .filter(Boolean);

        const milestoneMarkers = plan.data.milestones.map(m => {
            let year: number | undefined = undefined;
            const type = m.type;

            // 1. Dynamic Milestones (Check Projection)
            if (type === 'Financial Independence' || type === 'Debt Free') {
                const hitPoint = projection.find(p => p.milestones_hit?.includes(m.id));
                if (hitPoint) {
                    year = hitPoint.year;
                }
            }
            // 2. Life Expectancy
            else if (type === 'Life Expectancy') {
                const birthYear = m.owner === 'Spouse' ? spouseBirthYear : primaryBirthYear;
                const age = m.details?.age || 95;
                year = birthYear + age;
            }
            // 3. Static / Custom
            else {
                if (m.date) {
                    year = new Date(m.date).getFullYear();
                } else if (m.year_offset !== undefined) {
                    year = startYear + m.year_offset;
                }
            }

            if (!year) return null;

            return {
                time: `${year}-01-01`,
                position: 'aboveBar',
                color: (() => {
                    const c = m.color || 'bg-violet-500';
                    const map: Record<string, string> = {
                        'bg-blue-500': '#3b82f6',
                        'bg-green-500': '#22c55e',
                        'bg-violet-500': '#8b5cf6',
                        'bg-pink-500': '#ec4899',
                        'bg-orange-500': '#f97316',
                        'bg-red-500': '#ef4444',
                        'bg-teal-500': '#14b8a6',
                        'bg-slate-500': '#64748b'
                    };
                    return map[c] || '#8b5cf6';
                })(),
                shape: 'arrowDown',
                text: m.name,
            };
        }).filter(Boolean);

        return [...milestoneMarkers, ...pensionMarkers];
    }, [plan, projection, settings, finances]);

    // Derived Selection Data
    const selectedData = useMemo(() => {
        return projection.find(p => p.year === selectedYear) || null;
    }, [projection, selectedYear]);

    const prevData = useMemo(() => {
        return projection.find(p => p.year === selectedYear - 1) || null;
    }, [projection, selectedYear]);

    const minYear = projection.length > 0 ? projection[0].year : new Date().getFullYear();
    const maxYear = projection.length > 0 ? projection[projection.length - 1].year : new Date().getFullYear() + 40;

    const liquidData = useMemo(() => {
        return projection.map(p => ({
            time: p.time,
            value: p.liquid_net_worth || 0
        }));
    }, [projection]);

    const netWorthData = useMemo(() => {
        return projection.map(p => ({
            time: p.time,
            value: p.net_worth || 0
        }));
    }, [projection]);

    const handleCrosshairMove = useCallback((y: number | null) => {
        if (y) setSelectedYear(y);
    }, []);

    if (loading) return <div className="min-h-screen bg-slate-950 p-8 text-slate-400">Loading plan...</div>;

    return (
        <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
            {/* Main Content (Scrollable) */}
            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
                <div className="p-4 md:p-8 flex flex-col gap-8 max-w-5xl mx-auto w-full">
                    <header>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-fuchsia-400">
                            Financial Plan
                        </h1>
                        <p className="text-slate-400 mt-2">
                            Projection based on current net worth of {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(finances?.net_worth || 0)}
                        </p>
                    </header>

                    {/* Chart Section */}
                    <div className="bg-slate-900/50 rounded-2xl p-6 border border-slate-800 shadow-xl backdrop-blur-sm">
                        <div className="w-full">
                            {/* Pass mapped projection data */}
                            <PlanChart
                                data={liquidData}
                                secondaryData={netWorthData}
                                markers={markers as any}
                                height={400}
                                birthYear={settings?.primaryUser?.birthYear || 1980}
                                onCrosshairMove={handleCrosshairMove}
                            />
                        </div>
                        <div className="mt-4 flex gap-4 text-xs text-slate-500 justify-center">
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-[#8b5cf6]"></span> Liquid NW
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-1 rounded-full bg-slate-500"></span> Net Worth
                            </div>
                        </div>
                    </div>

                    {/* Editor Section */}
                    <div>
                        <h2 className="text-xl font-semibold mb-4 text-slate-200">Plan Inputs</h2>
                        {plan && <PlanEditor
                            data={plan.data}
                            onChange={handleUpdatePlanData}
                            finances={finances}
                            dividendAutoAccounts={dividendByAccount}
                            virtualIncomeStreams={{
                                // Options: use current year's expected income from the projection
                                optionsAnnual: optionsProjection.find(p => p.year === new Date().getFullYear())?.expectedIncome
                                    ?? (optionsProjection.length > 0 ? optionsProjection[0].expectedIncome : undefined),
                                // Dividends: forward annual total in USD (constant across years)
                                dividendAnnual: dividendTotal?.annualTotal,
                                // Bonds: current or nearest year's coupon+principal income
                                bondAnnual: bondProjection.find(p => p.year === new Date().getFullYear())?.amount
                                    ?? (bondProjection.length > 0 ? bondProjection[0].amount : undefined),
                            }}
                        />}
                    </div>
                </div>
            </div>

            {/* Right Side Pane (Fixed/Sticky) */}
            <PlanDetailsPane
                data={selectedData}
                prevData={prevData}
                currentYear={selectedYear}
                minYear={minYear}
                maxYear={maxYear}
                onChangeYear={setSelectedYear}
                settings={settings}
            />
        </div>
    );
}
