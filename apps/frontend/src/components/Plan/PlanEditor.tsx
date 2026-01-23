'use client';
import React, { useState, useEffect } from 'react';
import { PlanData, PlanItem, PlanMilestone } from './types';
import { PlanModal } from './PlanModal';

interface Props {
    data: PlanData;
    onChange: (data: PlanData) => void;
    finances?: any; // Finance Snapshot
}

const Tab: React.FC<{ label: string; count: number; active: boolean; onClick: () => void }> = ({ label, count, active, onClick }) => (
    <button
        onClick={onClick}
        className={`flex-1 py-3 border-b-2 text-sm font-medium transition-colors ${
            active ? 'border-violet-500 text-violet-400 bg-slate-900/50' : 'border-transparent text-slate-400 hover:text-slate-300 hover:bg-slate-900/30'
        }`}
    >
        {label} <span className="ml-2 text-xs opacity-50 bg-slate-800 px-1.5 rounded">{count}</span>
    </button>
);

export const PlanEditor: React.FC<Props> = ({ data, onChange, finances }) => {
    const [activeTab, setActiveTab] = useState<'Account' | 'Income' | 'Expense' | 'Asset' | 'Milestone'>('Account');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<PlanItem | undefined>(undefined);
    
    // Merge Finances into Accounts View
    // We want to list all items from finances.items that are 'Savings' or 'Investments'
    // If they exist in plan.items (ref by ID? or Name?), merge the config.
    const [mergedAccounts, setMergedAccounts] = useState<any[]>([]);

    useEffect(() => {
        if (!finances) return;
        
        const financeItems = finances.data?.items?.filter((f: any) => f.category === 'Savings' || f.category === 'Investments') || [];
        const planAccounts = data.items.filter(i => i.category === 'Account');
        
        const merged = financeItems.map((f: any) => {
            const planItem = planAccounts.find(p => p.name === f.name); // Simple match by name for now? Or should we use ID if stable?
            // Finance IDs might change? Let's assume Name is stable enough for MVP or use ID if available.
            return {
                id: planItem?.id || f.id || crypto.randomUUID(),
                name: f.name,
                category: 'Account',
                value: f.value, // Current Balance always from Snapshot
                ...planItem, // Override with plan config if exists (growth, yield etc)
                isLinked: true,
                hasPlan: !!planItem
            };
        });
        
        // Also add accounts that are ONLY in Plan (Manual entries)
        const manualAccounts = planAccounts.filter(p => !financeItems.find((f: any) => f.name === p.name));
        
        setMergedAccounts([...merged, ...manualAccounts]);
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
    
    const handleDeleteItem = (id: string, isLinked: boolean) => {
        if(confirm(isLinked ? 'Remove custom settings for this account?' : 'Delete this account?')) {
             onChange({ ...data, items: data.items.filter(i => i.id !== id) });
        }
    };

    const currentItems = activeTab === 'Account' ? mergedAccounts : data.items.filter(i => i.category === activeTab);

    return (
        <div className="mt-8 bg-slate-900/20 p-6 rounded-xl border border-slate-800/50">
            <div className="flex border-b border-slate-800 mb-6 overflow-x-auto">
                <Tab label="Accounts" count={mergedAccounts.length} active={activeTab === 'Account'} onClick={() => setActiveTab('Account')} />
                <Tab label="Income" count={data.items.filter(i => i.category === 'Income').length} active={activeTab === 'Income'} onClick={() => setActiveTab('Income')} />
                <Tab label="Expenses" count={data.items.filter(i => i.category === 'Expense').length} active={activeTab === 'Expense'} onClick={() => setActiveTab('Expense')} />
                <Tab label="Real Assets" count={data.items.filter(i => i.category === 'Asset').length} active={activeTab === 'Asset'} onClick={() => setActiveTab('Asset')} />
                <Tab label="Milestones" count={data.milestones.length} active={activeTab === 'Milestone'} onClick={() => setActiveTab('Milestone')} />
            </div>

            <div className="space-y-4">
                {activeTab !== 'Milestone' ? (
                    currentItems.length > 0 ? currentItems.map(item => (
                        <div key={item.id} className="bg-slate-900 p-4 rounded-lg border border-slate-800 flex justify-between items-center group hover:border-slate-700 transition-colors">
                             <div>
                                <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                                    {item.name}
                                    {item.isLinked && <span className="text-[10px] bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded">Linked</span>}
                                    {item.category === 'Account' && !item.hasPlan && !item.growth_rate && item.isLinked && 
                                        <span className="text-[10px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">Unconfigured</span>
                                    }
                                </h4>
                                <div className="text-xs text-slate-500 mt-1 flex gap-3 h-5 items-center">
                                    {/* Account Specific Details */}
                                    {item.category === 'Account' ? (
                                        <>
                                            <span className="flex items-center gap-1">📈 {item.growth_rate || 0}%</span>
                                            <span className="w-1 h-1 rounded-full bg-slate-700"/>
                                            <span className="flex items-center gap-1">🏦 {item.account_settings?.bond_allocation || 0}% Bonds</span>
                                            <span className="w-1 h-1 rounded-full bg-slate-700"/>
                                            <span className="flex items-center gap-1">💸 {item.account_settings?.dividend_yield || 0}% Div</span>
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
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.value)}
                                </span>
                                <button onClick={() => { setEditingItem(item); setIsModalOpen(true); }} className="p-1 hover:bg-slate-800 rounded text-slate-400 opacity-60 hover:opacity-100 transition-opacity">
                                    ✏️ {item.category === 'Account' && !item.hasPlan && item.isLinked ? 'Configure' : ''}
                                </button>
                                <button onClick={() => handleDeleteItem(item.id, item.isLinked)} className="p-1 hover:bg-slate-800 rounded text-red-400 opacity-60 hover:opacity-100 transition-opacity">🗑️</button>
                             </div>
                        </div>
                    )) : (
                        <div className="text-center py-8 text-slate-500">No {activeTab} defined.</div>
                    )
                ) : (
                    // Milestones List (Unchanged)
                    data.milestones.length > 0 ? data.milestones.map(m => (
                        <div key={m.id} className="bg-slate-900 p-4 rounded-lg border border-slate-800 flex justify-between items-center">
                            <div>
                                <h4 className="font-semibold text-slate-200">{m.name}</h4>
                                <div className="text-xs text-slate-500 mt-1">
                                    {m.date ? `Date: ${m.date}` : `Year Offset: +${m.year_offset}`}
                                </div>
                            </div>
                            <button onClick={() => { 
                                onChange({ ...data, milestones: data.milestones.filter(x => x.id !== m.id) })
                            }} className="p-1 hover:bg-slate-800 rounded text-red-400">🗑️</button>
                        </div>
                    )) : <div className="text-center py-8 text-slate-500">No milestones yet.</div>
                )}
            </div>

            <button 
                onClick={() => {
                    if (activeTab === 'Milestone') {
                        // Quick add milestone (unchanged)
                        const name = prompt("Milestone Name (e.g. Retirement)");
                        if (name) {
                            const offset = prompt("Years from now?", "20");
                            onChange({ 
                                ...data, 
                                milestones: [...data.milestones, { 
                                    id: crypto.randomUUID(), 
                                    name, 
                                    year_offset: parseInt(offset || "0"), 
                                    type: 'Custom' 
                                }] 
                            });
                        }
                    } else {
                        setEditingItem(undefined);
                        setIsModalOpen(true);
                    }
                }}
                className="mt-6 w-full py-3 border-2 border-dashed border-slate-700 rounded-lg text-slate-400 hover:border-violet-500 hover:text-violet-400 transition-colors flex items-center justify-center gap-2"
            >
                <span>+</span> Add {activeTab === 'Asset' ? 'Asset' : activeTab}
            </button>

            {/* Modal */}
            <PlanModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                category={activeTab as any} 
                onSave={handleSaveItem}
                initialData={editingItem}
                milestones={data.milestones}
            />
        </div>
    );
};
