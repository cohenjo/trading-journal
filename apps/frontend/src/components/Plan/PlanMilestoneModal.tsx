'use client';
import React, { useState, useEffect } from 'react';
import { PlanMilestone } from './types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSave: (milestone: PlanMilestone) => void;
    initialData?: PlanMilestone;
}

const MILESTONE_TYPES = [
    { id: 'Custom', label: 'Custom Milestone', icon: '✨', description: 'Set a specific date or year offset.' },
    { id: 'Retirement', label: 'Retirement', icon: '🌴', description: 'When you plan to stop working.' },
    { id: 'Financial Independence', label: 'Financial Independence', icon: '🚩', description: 'When Liquid Net Worth > X * Expenses' },
    { id: 'Debt Free', label: 'Debt Free', icon: '🔓', description: 'When Total Debt is $0' },
    { id: 'Life Expectancy', label: 'Life Expectancy', icon: '💓', description: 'Estimated end of plan (e.g. Age 95)' },
];

const COLORS = [
    { label: 'Blue', value: 'bg-blue-500' },
    { label: 'Green', value: 'bg-green-500' },
    { label: 'Violet', value: 'bg-violet-500' },
    { label: 'Pink', value: 'bg-pink-500' },
    { label: 'Orange', value: 'bg-orange-500' },
    { label: 'Red', value: 'bg-red-500' },
    { label: 'Teal', value: 'bg-teal-500' },
    { label: 'Slate', value: 'bg-slate-500' },
];

export const PlanMilestoneModal: React.FC<Props> = ({ isOpen, onClose, onSave, initialData }) => {
    const [step, setStep] = useState<'type-select' | 'details'>(initialData ? 'details' : 'type-select');
    const [formData, setFormData] = useState<Partial<PlanMilestone>>({});

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setStep('details');
                setFormData(initialData);
            } else {
                setStep('type-select');
                setFormData({
                    type: 'Custom',
                    color: 'bg-violet-500',
                    icon: '✨',
                });
            }
        }
    }, [isOpen, initialData]);

    const handleUpdate = (updates: Partial<PlanMilestone>) => {
        setFormData(prev => ({ ...prev, ...updates }));
    };

    const handleDetailsUpdate = (key: string, value: any) => {
        setFormData(prev => ({
            ...prev,
            details: { ...prev.details, [key]: value }
        }));
    };

    if (!isOpen) return null;

    const currentType = MILESTONE_TYPES.find(t => t.id === formData.type) || MILESTONE_TYPES[0];

    // --- RENDER TYPE SELECT ---
    if (step === 'type-select') {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <div className="bg-slate-900 rounded-xl border border-slate-800 w-full max-w-2xl shadow-2xl p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-white">Add Milestone</h2>
                        <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {MILESTONE_TYPES.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => {
                                    handleUpdate({ type: t.id, icon: t.icon, name: t.label });
                                    setStep('details');
                                }}
                                className="flex items-start gap-4 p-4 rounded-xl bg-slate-800 hover:bg-slate-750 hover:border-violet-500 border border-transparent transition-all group text-left"
                            >
                                <span className="text-3xl bg-slate-900 p-3 rounded-lg group-hover:scale-110 transition-transform">{t.icon}</span>
                                <div>
                                    <span className="font-medium text-slate-200 block mb-1">{t.label}</span>
                                    <span className="text-xs text-slate-500">{t.description}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // --- RENDER DETAILS FORM ---
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-slate-950 rounded-xl border border-slate-800 w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${formData.color || 'bg-violet-500'} bg-opacity-20 text-white`}>
                            {formData.icon}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white tracking-wide">
                                {initialData ? 'Edit' : 'New'} Milestone
                            </h2>
                            <p className="text-xs text-slate-400 font-mono">{formData.type}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">✕</button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">

                    {/* Name */}
                    <div>
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Name</label>
                        <input type="text" className="w-full bg-slate-900 border-slate-700 rounded p-3 text-lg text-white focus:ring-2 focus:ring-violet-500 outline-none"
                            value={formData.name || ''} onChange={e => handleUpdate({ name: e.target.value })}
                        />
                    </div>

                    {/* Type Specific Fields */}
                    <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800">
                        {formData.type === 'Financial Independence' && (
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Trigger Condition</label>
                                <div className="flex items-center gap-3 bg-slate-900 p-3 rounded border border-slate-700">
                                    <span className="text-slate-300">Liquid Net Worth &ge;</span>
                                    <input
                                        type="number"
                                        className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-center"
                                        value={formData.details?.expense_multiplier ?? 25}
                                        onChange={e => handleDetailsUpdate('expense_multiplier', parseFloat(e.target.value) || 0)}
                                    />
                                    <span className="text-slate-300">x Annual Expenses</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-2">
                                    Calculates based on projected annual expenses and total liquid assets.
                                </p>
                            </div>
                        )}

                        {formData.type === 'Debt Free' && (
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Trigger Condition</label>
                                <div className="flex items-center gap-3 bg-slate-900 p-3 rounded border border-slate-700">
                                    <span className="text-slate-300">Total Debt ==</span>
                                    <span className="text-white font-mono">$0.00</span>
                                </div>
                            </div>
                        )}

                        {formData.type === 'Life Expectancy' && (
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Target Age</label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        className="w-24 bg-slate-900 border border-slate-700 rounded p-2 text-white"
                                        value={formData.details?.age ?? 95}
                                        onChange={e => handleDetailsUpdate('age', parseFloat(e.target.value))}
                                    />
                                    <span className="text-slate-500">Years Old</span>
                                </div>
                            </div>
                        )}

                        {(formData.type === 'Custom' || formData.type === 'Retirement') && (
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Timing</label>
                                    <select
                                        className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white mb-2"
                                        value={formData.date ? 'Date' : 'Offset'}
                                        onChange={e => {
                                            if (e.target.value === 'Date') handleUpdate({ date: '2030-01-01', year_offset: undefined });
                                            else handleUpdate({ year_offset: 20, date: undefined });
                                        }}
                                    >
                                        <option value="Offset">Year Offset (e.g. In 20 Years)</option>
                                        <option value="Date">Specific Date</option>
                                    </select>

                                    {formData.date !== undefined ? (
                                        <input
                                            type="date"
                                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                            value={formData.date}
                                            onChange={e => handleUpdate({ date: e.target.value })}
                                        />
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400">In</span>
                                            <input
                                                type="number"
                                                className="w-20 bg-slate-900 border-slate-700 rounded p-2 text-white"
                                                value={formData.year_offset ?? 0}
                                                onChange={e => handleUpdate({ year_offset: parseInt(e.target.value) || 0 })}
                                            />
                                            <span className="text-slate-400">Years</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Appearance */}
                    <div>
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 block">Appearance</label>
                        <div className="grid grid-cols-2 gap-4">
                            {/* Icon Select */}
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-slate-400">Icon:</span>
                                <input
                                    type="text"
                                    className="w-12 h-10 text-center text-xl bg-slate-900 border border-slate-700 rounded"
                                    value={formData.icon || ''}
                                    onChange={e => handleUpdate({ icon: e.target.value })}
                                />
                            </div>

                            {/* Color Select */}
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1 overflow-x-auto pb-1 custom-scrollbar">
                                    {COLORS.map(c => (
                                        <button
                                            key={c.value}
                                            onClick={() => handleUpdate({ color: c.value })}
                                            className={`w-6 h-6 rounded-full ${c.value} ${formData.color === c.value ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900' : 'opacity-50 hover:opacity-100'}`}
                                            title={c.label}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
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
                                onSave({ ...formData, id: formData.id || crypto.randomUUID() } as PlanMilestone);
                                onClose();
                            }}
                            className="px-6 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium rounded shadow-lg shadow-violet-900/20"
                        >
                            {initialData ? 'Save Changes' : 'Add Milestone'}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};
