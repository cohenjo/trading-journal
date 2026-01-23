'use client';
import React, { useState, useEffect } from 'react';
import { PlanItem, PlanMilestone } from './types';
import { PlanTimeSelector } from './PlanTimeSelector';
import { PlanAssetDetails } from './PlanAssetDetails';
import { PlanAccountDetails } from './PlanAccountDetails';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSave: (item: PlanItem) => void;
    category: 'Income' | 'Expense' | 'Asset' | 'Liability' | 'Milestone' | 'Account'; 
    milestones?: PlanMilestone[];
    initialData?: PlanItem;
}

const INCOME_TYPES = [
    { label: 'Salary', icon: '🏢' },
    { label: 'Hourly Wage', icon: '💼' },
    { label: 'RSU Grant', icon: '📈' },
    { label: 'Inheritance', icon: '🎁' },
    { label: 'Pension', icon: '👴' },
    { label: 'Side Hustle', icon: '🐖' },
    { label: 'Custom Income', icon: '💲' },
];

const EXPENSE_TYPES = [
    { label: 'Living Expenses', icon: '🏠' },
    { label: 'Rent', icon: '🏘️' },
    { label: 'Mortgage', icon: '🏦' }, 
    { label: 'Travel', icon: '✈️' },
    { label: 'Education', icon: '🎓' },
    { label: 'Custom Expense', icon: '💲' },
];

const ASSET_TYPES = [
    { label: 'House', icon: '🏠' },
    { label: 'Car', icon: '🚗' },
    { label: 'Investment Property', icon: '🏢' },
    { label: 'Boat', icon: '🚤' },
    { label: 'Luxury Item', icon: '💎' },
    { label: 'Custom Asset', icon: '💲' },
];

const ACCOUNT_TYPES = [
    { label: 'Taxable Investments', icon: '📈' },
    { label: '401k/403b', icon: '🏦' },
    { label: 'Roth IRA', icon: '🛡️' },
    { label: 'Savings', icon: '🐖' },
    { label: 'HSA', icon: '🏥' },
    { label: 'Custom Account', icon: '💲' },
];

export const PlanModal: React.FC<Props> = ({ isOpen, onClose, onSave, category, milestones = [], initialData }) => {
    const [step, setStep] = useState<'type-select' | 'details'>(initialData ? 'details' : 'type-select');
    const [formData, setFormData] = useState<Partial<PlanItem>>({});

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setStep('details');
                setFormData(initialData);
            } else {
                setStep('type-select');
                setFormData({
                    category: category as any,
                    frequency: 'Yearly',
                    value: 0,
                    growth_rate: category === 'Expense' ? 3.0 : 0.0,
                    owner: 'You',
                    start_condition: 'Now'
                });
            }
        }
    }, [isOpen, category, initialData]);

    const handleUpdate = (updates: Partial<PlanItem>) => {
        setFormData(prev => ({ ...prev, ...updates }));
    };

    if (!isOpen) return null;

    const types = category === 'Income' ? INCOME_TYPES : 
                 category === 'Expense' ? EXPENSE_TYPES : 
                 category === 'Account' ? ACCOUNT_TYPES : ASSET_TYPES;

    // --- RENDER TYPE SELECT ---
    if (step === 'type-select') {
        if(category === 'Milestone') {
            setStep('details'); 
            return null;
        }

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <div className="bg-slate-900 rounded-xl border border-slate-800 w-full max-w-2xl shadow-2xl p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-white">New {category}</h2>
                        <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {types.map((t) => (
                            <button
                                key={t.label}
                                onClick={() => {
                                    handleUpdate({ sub_category: t.label, name: t.label });
                                    setStep('details');
                                }}
                                className="flex flex-col items-center gap-3 p-6 rounded-xl bg-slate-800 hover:bg-slate-700 hover:border-violet-500 border border-transparent transition-all group"
                            >
                                <span className="text-3xl group-hover:scale-110 transition-transform">{t.icon}</span>
                                <span className="font-medium text-slate-200">{t.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // --- RENDER DETAILS FORM ---
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
            <div className="bg-slate-950 rounded-xl border border-slate-800 w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-violet-900/50 flex items-center justify-center text-xl">
                            {types.find(t => t.label === formData.sub_category)?.icon || '📝'}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white uppercase tracking-wide">
                                {initialData ? 'Edit' : 'New'} {formData.sub_category || category}
                            </h2>
                            <p className="text-xs text-slate-400 font-mono">{formData.id || 'New Item'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">✕</button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                    
                    {/* Basic Info */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                             <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Name</label>
                             <input type="text" className="w-full bg-slate-900 border-slate-700 rounded p-3 text-lg text-white focus:ring-2 focus:ring-violet-500 outline-none" 
                                value={formData.name || ''} onChange={e => handleUpdate({ name: e.target.value })} 
                             />
                        </div>
                        
                        <div>
                             <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Owner</label>
                             <select className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                value={formData.owner} onChange={e => handleUpdate({ owner: e.target.value })}
                             >
                                <option value="You">You</option>
                                <option value="Spouse">Spouse</option>
                                <option value="Joint">Joint</option>
                             </select>
                        </div>

                         <div>
                             <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Frequency</label>
                             <select className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                value={formData.frequency} onChange={e => handleUpdate({ frequency: e.target.value as any })}
                             >
                                <option value="Yearly">Yearly</option>
                                <option value="Monthly">Monthly</option>
                                <option value="OneTime">One Time</option>
                             </select>
                        </div>
                    </div>

                    {category === 'Asset' ? (
                        <PlanAssetDetails item={formData as PlanItem} onChange={handleUpdate} />
                    ) : category === 'Account' ? (
                        <PlanAccountDetails item={formData as PlanItem} onChange={handleUpdate} />
                    ) : (
                        // Standard Amount & Growth for Income/Expense
                        <div className="bg-slate-800 p-4 rounded-lg space-y-4 border border-slate-700">
                             <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Annual Amount</label>
                                    <input type="number" className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                        value={formData.value ?? ''} 
                                        onChange={e => {
                                            const val = parseFloat(e.target.value);
                                            handleUpdate({ value: isNaN(val) ? 0 : val });
                                        }}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Growth Rate (%)</label>
                                    <input type="number" step="0.1" className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                        value={formData.growth_rate ?? ''} 
                                        onChange={e => {
                                             const val = parseFloat(e.target.value);
                                             handleUpdate({ growth_rate: isNaN(val) ? 0 : val });
                                        }}
                                    />
                                </div>
                             </div>

                             {category === 'Income' && (
                                 <div>
                                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Tax Rate (%)</label>
                                    <input type="number" step="1" className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                        value={formData.tax_rate ?? ''} 
                                        onChange={e => {
                                            const val = parseFloat(e.target.value);
                                            handleUpdate({ tax_rate: isNaN(val) ? 0 : val });
                                        }}
                                    />
                                    <p className="text-xs text-slate-500 mt-1">Effective tax rate on this income source.</p>
                                 </div>
                             )}
                        </div>
                    )}

                    {/* Time Range */}
                    <div className="space-y-4">
                        <PlanTimeSelector 
                            label="Start" 
                            condition={formData.start_condition}
                            reference={formData.start_reference}
                            date={formData.start_date}
                            milestones={milestones}
                            onChange={handleUpdate}
                        />
                        
                         <PlanTimeSelector 
                            label="End" 
                            condition={formData.end_condition}
                            reference={formData.end_reference}
                            date={formData.end_date}
                            milestones={milestones}
                            onChange={handleUpdate}
                            isEnd
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-800 bg-slate-900 rounded-b-xl flex justify-between items-center">
                     <button 
                        onClick={() => setStep('type-select')} 
                        className="text-slate-400 hover:text-white text-sm"
                        style={{ display: initialData ? 'none' : 'block' }}
                    > 
                        ← Back to Types
                    </button>
                    <div className="flex gap-3 ml-auto">
                        <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded">Cancel</button>
                        <button 
                            onClick={() => {
                                onSave({ ...formData, id: formData.id || crypto.randomUUID() } as PlanItem);
                                onClose();
                            }}
                            className="px-6 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium rounded shadow-lg shadow-violet-900/20"
                        >
                            {initialData ? 'Save Changes' : 'Add Item'}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};
