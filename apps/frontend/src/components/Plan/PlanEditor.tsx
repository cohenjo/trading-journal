'use client';
import React, { useState, useEffect } from 'react';
import { PlanData, PlanItem, PlanMilestone } from './types';
import { PlanMilestoneModal } from './PlanMilestoneModal';

import { PlanModal } from './PlanModal';
import { useSettings } from '../../app/settings/SettingsContext';
import { convertCurrency } from '@/lib/currency';

interface Props {
    data: PlanData;
    onChange: (data: PlanData) => void;
    finances?: any; // Finance Snapshot
}

const Tab: React.FC<{ label: string; count: number; active: boolean; onClick: () => void }> = ({ label, count, active, onClick }) => (
    <button
        onClick={onClick}
        className={`flex-1 py-3 border-b-2 text-sm font-medium transition-colors ${active ? 'border-violet-500 text-violet-400 bg-slate-900/50' : 'border-transparent text-slate-400 hover:text-slate-300 hover:bg-slate-900/30'
            }`}
    >
        {label} <span className="ml-2 text-xs opacity-50 bg-slate-800 px-1.5 rounded">{count}</span>
    </button>
);

export const PlanEditor: React.FC<Props> = ({ data, onChange, finances }) => {
    const { settings } = useSettings();
    const mainCurrency = settings.mainCurrency;
    const [activeTab, setActiveTab] = useState<'Account' | 'Income' | 'Expense' | 'Asset' | 'Milestone'>('Account');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<PlanItem | undefined>(undefined);

    // Milestone Modal State
    const [isMilestoneModalOpen, setIsMilestoneModalOpen] = useState(false);
    const [editingMilestone, setEditingMilestone] = useState<PlanMilestone | undefined>(undefined);

    // Merge Finances into Accounts View
    // We want to list all items from finances.items that are 'Savings' or 'Investments'
    // If they exist in plan.items (ref by ID? or Name?), merge the config.
    const [mergedAccounts, setMergedAccounts] = useState<any[]>([]);
    const [mergedRealAssets, setMergedRealAssets] = useState<any[]>([]);

    useEffect(() => {
        if (!finances) return;

        const financeItems = finances.data?.items?.filter((f: any) => f.category === 'Savings' || f.category === 'Investments') || [];
        const planAccounts = data.items.filter(i => i.category === 'Account');

        const merged = financeItems.map((f: any) => {
            const planItem = planAccounts.find(p => p.name === f.name);

            // Default Type Logic (Match FinanceTabs logic)
            let accType: any = 'Taxable';
            const rawType = f.type || '';
            const t = rawType.toLowerCase();

            // 1. Try Exact Match
            const VALID_TYPES = ['Taxable', '401k', 'Roth', 'HSA', 'Savings', 'Broker', 'ESPP', 'RSU', 'Hishtalmut', 'IRA', 'Pension'];
            if (VALID_TYPES.includes(rawType)) {
                accType = rawType;
            }
            // 2. Fallback to Detection
            else {
                if (t.includes('broker')) accType = 'Broker';
                else if (t.includes('401k')) accType = '401k';
                else if (t.includes('roth')) accType = 'Roth';
                else if (t.includes('ira')) accType = 'IRA';
                else if (t.includes('hishtalmut')) accType = 'Hishtalmut';
                else if (t.includes('espp')) accType = 'ESPP';
                else if (f.category !== 'Savings' && t.includes('rsu')) accType = 'RSU';
                else if (t.includes('hsa')) accType = 'HSA';
                else if (t.includes('pension')) accType = 'Pension';
                else if (t.includes('savings') || t.includes('bank')) accType = 'Savings';
            }

            const defaultSettings: any = {
                type: accType,
                bond_allocation: 0,
                dividend_yield: 0,
                fees: 0
            };

            if (accType === 'Pension' && f.details) {
                if (f.details.managing_body) defaultSettings.managing_body = f.details.managing_body;
                if (f.details.draw_income !== undefined) defaultSettings.draw_income = f.details.draw_income;
                if (f.details.divide_rate) defaultSettings.divide_rate = Number(f.details.divide_rate);
                if (f.details.starting_age) defaultSettings.starting_age = Number(f.details.starting_age);
                if (f.details.monthly_contribution) defaultSettings.monthly_contribution = Number(f.details.monthly_contribution);
            }

            if (accType === 'RSU' && f.details) {
                if (f.details.stock_symbol) defaultSettings.stock_symbol = f.details.stock_symbol;
                if (f.details.rsu_grants) defaultSettings.rsu_grants = f.details.rsu_grants;
                if (f.details.current_price) defaultSettings.current_price = f.details.current_price;
            }

            const mergedSettings = {
                ...defaultSettings,
                ...(planItem?.account_settings || {})
            };

            // SYNC PRIORITY: If linked, use snapshot's balance and dividend info
            const itemCurrency = f.currency || 'ILS';
            let displayValue = f.value;
            let displayDivAmount = f.details?.dividend_fixed_amount;

            // NORMALIZE TO MAIN CURRENCY
            if (itemCurrency !== mainCurrency) {
                displayValue = convertCurrency(f.value, itemCurrency, mainCurrency);
                if (displayDivAmount !== undefined) {
                    displayDivAmount = convertCurrency(displayDivAmount, itemCurrency, mainCurrency);
                }
            }

            if (f.details) {
                if (displayDivAmount !== undefined) {
                    mergedSettings.dividend_fixed_amount = displayDivAmount;
                    mergedSettings.dividend_mode = f.details.dividend_mode || 'Fixed';
                }
                if (f.details.dividend_yield !== undefined) {
                    mergedSettings.dividend_yield = f.details.dividend_yield;
                }
            }

            return {
                ...planItem, // General config (growth, owner, etc)
                id: planItem?.id || f.id || crypto.randomUUID(),
                name: f.name,
                category: 'Account',
                sub_category: planItem?.sub_category || f.type || 'General',
                owner: planItem?.owner || f.owner || 'You',
                value: displayValue, // Normalized Snapshot wins!
                currency: mainCurrency, // Normalizing to plan's main currency
                account_settings: mergedSettings,
                isLinked: true,
                hasPlan: !!planItem
            };
        });

        // Also add accounts that are ONLY in Plan (Manual entries)
        const manualAccounts = planAccounts.filter(p => !financeItems.find((f: any) => f.name === p.name));

        setMergedAccounts([...merged, ...manualAccounts]);

        // Merge Finances into Assets View (Real Assets)
        const financeAssets = finances.data?.items?.filter((f: any) => f.category === 'Assets') || [];
        const planAssets = data.items.filter(i => i.category === 'Asset');

        const mergedAssets = financeAssets.map((f: any) => {
            const planItem = planAssets.find(p => p.name === f.name);

            // Map financing details if they exist in the finance item
            let financingOverride = undefined;
            if (f.details?.loan_balance && !f.details?.fully_owned) {
                financingOverride = {
                    down_payment: (f.value - (f.details.loan_balance as number)), // Calculate implied down payment/equity
                    interest_rate: f.details.interest_rate || 0,
                    term_months: f.details.loan_end_year ? (f.details.loan_end_year - new Date().getFullYear()) * 12 : 360,
                    monthly_payment: 0 // Will be calculated
                };
            }

            return {
                id: planItem?.id || f.id || crypto.randomUUID(),
                name: f.name,
                category: 'Asset',
                value: f.value,
                ...planItem,
                financing: planItem ? planItem.financing : financingOverride,
                isLinked: true,
                hasPlan: !!planItem
            };
        });

        const manualAssets = planAssets.filter(p => !financeAssets.find((f: any) => f.name === p.name));
        // We need to store this somewhere to use it in the render
        // For now, let's just make 'mergedAssets' available.
        // Since we don't have a state for it, we can compute it or add a new state.
        // Let's add a new state: mergedRealAssets
        setMergedRealAssets([...mergedAssets, ...manualAssets]);

    }, [finances, data.items]);


    const handleSaveItem = (item: PlanItem) => {
        let newItems = [...data.items];
        // Check if updating existing
        const index = newItems.findIndex(i => i.id === item.id);

        if (index >= 0) {
            newItems[index] = item;
        } else {
            // Check if it's a finance item being promoted to plan
            // If so, we are adding it for the first time
            newItems.push(item);
        }
        onChange({ ...data, items: newItems });
    };

    const handleSaveMilestone = (m: PlanMilestone) => {
        let newMilestones = [...data.milestones];
        const index = newMilestones.findIndex(x => x.id === m.id);
        if (index >= 0) newMilestones[index] = m;
        else newMilestones.push(m);
        onChange({ ...data, milestones: newMilestones });
    };

    const handleDeleteItem = (id: string, isLinked: boolean) => {
        if (confirm(isLinked ? 'Remove custom settings for this account?' : 'Delete this account?')) {
            onChange({ ...data, items: data.items.filter(i => i.id !== id) });
        }
    };

    // --- Derived Pension Income Items ---
    const pensionIncomeItems = React.useMemo(() => {
        // Collect accounts that have draw_income enabled
        const pensions = mergedAccounts.filter(a =>
            (a.account_settings?.type === 'Pension' || a.sub_category?.includes('Pension'))
            && a.account_settings?.draw_income
        );

        return pensions.map(p => {
            // Calculate implied annual payout for display
            // Payout = Value / Divide Rate * 12
            const rate = p.account_settings?.divide_rate || 200;
            const annual = rate > 0 ? (p.value / rate) * 12 : 0;
            const monthly = annual / 12;
            const startAge = p.account_settings?.starting_age || 67;

            return {
                id: `pension_income_${p.id}`,
                name: `Pension: ${p.name}`,
                category: 'Income',
                value: monthly, // Show Monthly Value
                frequency: 'Monthly', // Use Monthly Frequency label
                currency: mainCurrency,
                isLinked: true,
                isVirtual: true, // Marker to disable editing
                start_condition: 'Age',
                start_reference: startAge,
                growth_rate: 0 // Pensions typically don't grow like salary
            };
        });
    }, [mergedAccounts]);


    // --- Derived Pension Milestones ---
    const pensionMilestones = React.useMemo(() => {
        return pensionIncomeItems.map(p => {
            // p is the derived Income Item. We need the source account to know the Owner?
            // Actually p.name is "Pension: <AccountName>".
            // We can find the source account in mergedAccounts if needed, or just use settings.
            // But wait, p has no owner field?
            // Let's look at pensionIncomeItems generation again.
            // It maps `p` (Account).

            // We'll iterate mergedAccounts again to be safe and get Owner.
            return null;
        });
    }, []);

    const calculatedPensionMilestones = React.useMemo(() => {
        const milestones: PlanMilestone[] = [];

        mergedAccounts.forEach(acc => {
            const isPension = (acc.account_settings?.type === 'Pension' || acc.sub_category?.includes('Pension'));
            if (isPension && acc.account_settings?.starting_age) {
                const ownerName = acc.owner === 'Spouse' ? settings.spouse.name : settings.primaryUser.name;
                // Or if "You", use primary.

                milestones.push({
                    id: `pension_milestone_${acc.id}`,
                    name: `${ownerName} Pension`,
                    type: 'Custom',
                    year_offset: undefined,
                    date: undefined, // calculated dynamically in markers? No, PlanMilestone expects date or offset?
                    // Wait, PlanPage calculates markers. Here we just display.
                    // A "Custom" milestone usually has a date.
                    // But this is "Age based".
                    // Frontend Milestones list doesn't show Age directly?
                    // It shows "In X Years".
                    // We can calculate the year offset: Age - CurrentAge.
                    // CurrentAge comes from settings birthYear.

                    // Let's calc offset.
                    // currentYear = new Date().getFullYear().
                    // birthYear = owner...
                    // targetYear = birthYear + startAge.
                    // offset = targetYear - currentYear.
                } as any);
            }
        });
        return milestones;
    }, [mergedAccounts, settings]);

    // Reworking the above to be cleaner and actual code
    const virtualPensionMilestones = React.useMemo(() => {
        const milestones: PlanMilestone[] = [];
        const currentYear = new Date().getFullYear();

        mergedAccounts.forEach(acc => {
            const isPension = (acc.account_settings?.type === 'Pension' || acc.sub_category?.includes('Pension'));
            if (isPension && acc.account_settings?.starting_age) {
                const isSpouse = acc.owner === 'Spouse';
                const ownerName = isSpouse ? settings.spouse.name : settings.primaryUser.name;
                const birthYear = isSpouse ? settings.spouse.birthYear : settings.primaryUser.birthYear;

                const targetAge = acc.account_settings.starting_age;
                const targetYear = birthYear + targetAge;
                const offset = targetYear - currentYear;

                milestones.push({
                    id: `pension_ms_${acc.id}`,
                    name: `${ownerName} Pension`,
                    type: 'Custom', // Or maybe 'Retirement'? Keeping Custom.
                    owner: acc.owner,
                    year_offset: offset,
                    color: isSpouse ? 'bg-violet-500' : 'bg-blue-500',
                    icon: '🎉',
                    isVirtual: true, // Marker
                    details: { description: `Derived from ${acc.name} (Age ${targetAge})` }
                });
            }
        });
        return milestones;
    }, [mergedAccounts, settings]);

    const currentItems = activeTab === 'Account' ? mergedAccounts :
        activeTab === 'Asset' ? mergedRealAssets :
            activeTab === 'Income' ? [...data.items.filter(i => i.category === 'Income'), ...pensionIncomeItems] :
                data.items.filter(i => i.category === activeTab);

    return (
        <div className="mt-8 bg-slate-900/20 p-6 rounded-xl border border-slate-800/50">
            <div className="flex border-b border-slate-800 mb-6 overflow-x-auto">
                <Tab label="Accounts" count={mergedAccounts.length} active={activeTab === 'Account'} onClick={() => setActiveTab('Account')} />
                <Tab label="Income" count={data.items.filter(i => i.category === 'Income').length + pensionIncomeItems.length} active={activeTab === 'Income'} onClick={() => setActiveTab('Income')} />
                <Tab label="Expenses" count={data.items.filter(i => i.category === 'Expense').length} active={activeTab === 'Expense'} onClick={() => setActiveTab('Expense')} />
                <Tab label="Real Assets" count={data.items.filter(i => i.category === 'Asset').length} active={activeTab === 'Asset'} onClick={() => setActiveTab('Asset')} />
                <Tab label="Milestones" count={data.milestones.length + virtualPensionMilestones.length} active={activeTab === 'Milestone'} onClick={() => setActiveTab('Milestone')} />
            </div>

            <div className="space-y-4">
                {activeTab !== 'Milestone' ? (
                    currentItems.length > 0 ? (
                        currentItems.map(item => (
                            <div key={item.id} className="bg-slate-900 p-4 rounded-lg border border-slate-800 flex justify-between items-center group hover:border-slate-700 transition-colors">
                                <div>
                                    <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                                        {item.name}
                                        {item.isLinked && <span className="text-[10px] bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded">Linked</span>}
                                        {item.category === 'Account' && !item.hasPlan && !item.growth_rate && item.isLinked &&
                                            <span className="text-[10px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">Unconfigured</span>
                                        }
                                        {item.currency && (
                                            <span className="text-[10px] bg-violet-900/50 text-violet-400 px-1.5 py-0.5 rounded">{item.currency}</span>
                                        )}
                                    </h4>
                                    <div className="text-xs text-slate-500 mt-1 flex gap-3 h-5 items-center">
                                        {/* Account Specific Details */}
                                        {item.category === 'Account' ? (
                                            <>
                                                <span className="flex items-center gap-1">📈 {item.growth_rate || 0}%</span>
                                                <span className="w-1 h-1 rounded-full bg-slate-700" />
                                                <span className="flex items-center gap-1">🏦 {item.account_settings?.bond_allocation || 0}% Bonds</span>
                                                <span className="w-1 h-1 rounded-full bg-slate-700" />
                                                <span className="flex items-center gap-1">💸 {item.account_settings?.dividend_yield || 0}% Div</span>
                                            </>
                                        ) : (item as any).isVirtual ? (
                                            // Virtual (Pension Income)
                                            <>
                                                <span className="text-violet-400">Derived from Pension</span>
                                                <span>•</span>
                                                <span>Starts at Age {item.start_reference}</span>
                                            </>
                                        ) : (
                                            // Standard
                                            <>
                                                <span>{item.frequency}</span>
                                                <span>•</span>
                                                <span>{item.growth_rate}% Growth</span>
                                                {item.start_date && <span>• Starts {item.start_date}</span>}
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="font-mono font-bold text-slate-200">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency || 'USD' }).format(item.value)}
                                    </span>
                                    {!(item as any).isVirtual && (
                                        <>
                                            <button onClick={() => { setEditingItem(item); setIsModalOpen(true); }} className="p-1 hover:bg-slate-800 rounded text-slate-400 opacity-60 hover:opacity-100 transition-opacity">
                                                ✏️ {item.category === 'Account' && !item.hasPlan && item.isLinked ? 'Configure' : ''}
                                            </button>
                                            <button onClick={() => handleDeleteItem(item.id, item.isLinked)} className="p-1 hover:bg-slate-800 rounded text-red-400 opacity-60 hover:opacity-100 transition-opacity">🗑️</button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-center py-8 text-slate-500">No {activeTab} defined.</div>
                    )
                ) : (
                    // Milestones List
                    [...data.milestones, ...virtualPensionMilestones].length > 0 ? (
                        [...data.milestones, ...virtualPensionMilestones].map(m => (
                            <div key={m.id} className="bg-slate-900 p-4 rounded-lg border border-slate-800 flex justify-between items-center group">
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${m.color || 'bg-slate-800'} bg-opacity-20 text-white`}>
                                        {m.icon || '📍'}
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-slate-200">{m.name}</h4>
                                        <div className="text-xs text-slate-500 mt-1 flex gap-2">
                                            <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">{m.type}</span>
                                            {m.date ? <span>{m.date}</span> : ''}
                                            {m.year_offset ? <span>In {m.year_offset} Years</span> : ''}
                                            {m.type === 'Financial Independence' && <span>{m.details?.expense_multiplier}x Expenses</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {(m as any).isVirtual ? (
                                        <span className="text-xs text-slate-500 italic">Linked to Pension</span>
                                    ) : (
                                        <>
                                            <button onClick={() => { setEditingMilestone(m); setIsMilestoneModalOpen(true); }} className="p-2 hover:bg-slate-800 rounded text-slate-400">✏️</button>
                                            <button onClick={() => {
                                                onChange({ ...data, milestones: data.milestones.filter(x => x.id !== m.id) })
                                            }} className="p-2 hover:bg-slate-800 rounded text-red-400">🗑️</button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-center py-8 text-slate-500">No milestones yet.</div>
                    )
                )}
            </div>

            <button
                onClick={() => {
                    if (activeTab === 'Milestone') {
                        setEditingMilestone(undefined);
                        setIsMilestoneModalOpen(true);
                    } else {
                        setEditingItem(undefined);
                        setIsModalOpen(true);
                    }
                }}
                className="mt-6 w-full py-3 border-2 border-dashed border-slate-700 rounded-lg text-slate-400 hover:border-violet-500 hover:text-violet-400 transition-colors flex items-center justify-center gap-2"
            >
                <span>+</span> Add {activeTab === 'Asset' ? 'Asset' : activeTab}
            </button>

            {/* Item Modal */}
            <PlanModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                category={activeTab as any}
                onSave={handleSaveItem}
                initialData={editingItem}
                milestones={[...data.milestones, ...virtualPensionMilestones]}
            />

            {/* Milestone Modal */}
            <PlanMilestoneModal
                isOpen={isMilestoneModalOpen}
                onClose={() => setIsMilestoneModalOpen(false)}
                onSave={handleSaveMilestone}
                initialData={editingMilestone}
            />
        </div >
    );
};
