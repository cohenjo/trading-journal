"use client";

import { useState, useEffect } from "react";
import { useSettings, PersonInfo } from "../settings/SettingsContext";
import { CurrencySelector } from "@/components/Common/CurrencySelector";

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

// Generate years from 1950 to 2010? Or dynamic?
const YEARS = Array.from({ length: 80 }, (_, i) => 1950 + i);

interface EditModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    data: PersonInfo;
    onSave: (data: PersonInfo) => void;
}

const EditPersonModal = ({ isOpen, onClose, title, data, onSave }: EditModalProps) => {
    const [formData, setFormData] = useState<PersonInfo>(data);

    useEffect(() => {
        if (isOpen) setFormData(data);
    }, [isOpen, data]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-slate-900 rounded-xl border border-slate-800 w-full max-w-md shadow-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-6">{title}</h2>

                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Name</label>
                        <input
                            type="text"
                            className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-violet-500 outline-none"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Birth Month</label>
                            <select
                                className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-violet-500 outline-none appearance-none"
                                value={formData.birthMonth}
                                onChange={e => setFormData({ ...formData, birthMonth: parseInt(e.target.value) })}
                            >
                                {MONTHS.map((m, i) => (
                                    <option key={m} value={i + 1}>{m}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Birth Year</label>
                            <select
                                className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-violet-500 outline-none appearance-none"
                                value={formData.birthYear}
                                onChange={e => setFormData({ ...formData, birthYear: parseInt(e.target.value) })}
                            >
                                {YEARS.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Placeholder for Customize Appearance */}
                    <div className="pt-4">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Appearance</label>
                        <button className="px-4 py-2 border border-slate-700 rounded text-slate-300 hover:bg-slate-800 flex items-center gap-2">
                            <span>☺</span> Customize
                        </button>
                    </div>
                </div>

                <div className="mt-8 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded">Cancel</button>
                    <button
                        onClick={() => { onSave(formData); onClose(); }}
                        className="px-6 py-2 bg-white text-slate-900 font-semibold rounded hover:bg-slate-200"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function SettingsPage() {
    const { settings, updateSettings } = useSettings();

    // UI State
    const [targetIncome, setTargetIncome] = useState<number>(settings.targetIncome);
    const [defaultRungTarget, setDefaultRungTarget] = useState<number>(settings.defaultRungTarget);

    // Modal State
    const [editPerson, setEditPerson] = useState<'primary' | 'spouse' | null>(null);

    useEffect(() => {
        setTargetIncome(settings.targetIncome);
        setDefaultRungTarget(settings.defaultRungTarget);
    }, [settings]);

    const handleFinancialSave = () => {
        updateSettings({
            targetIncome: Math.max(0, targetIncome),
            defaultRungTarget: Math.max(0, defaultRungTarget),
        });
    };

    const getAge = (year: number, month: number) => {
        const now = new Date();
        let age = now.getFullYear() - year;
        if (now.getMonth() + 1 < month) age--;
        return age;
    };

    return (
        <main className="min-h-screen bg-slate-950 text-slate-100 flex justify-center py-10 px-4">
            <div className="w-full max-w-2xl space-y-8">

                <header>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-fuchsia-400">Settings</h1>
                    <p className="text-slate-400">Manage your profile and planning preferences</p>
                </header>

                {/* Basic Info Section */}
                <section>
                    <h2 className="text-xl font-semibold mb-4 text-slate-200">Basic Info</h2>
                    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden divide-y divide-slate-800">

                        {/* Planning Mode */}
                        <div className="p-4 flex items-center justify-between hover:bg-slate-800/50 cursor-pointer group"
                            onClick={() => updateSettings({ planningMode: settings.planningMode === 'Individual' ? 'Couple' : 'Individual' })}
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-xl text-slate-400 group-hover:bg-slate-700 group-hover:text-white transition-colors">
                                    {settings.planningMode === 'Couple' ? '👥' : '👤'}
                                </div>
                                <div>
                                    <div className="font-medium text-slate-200">
                                        {settings.planningMode === 'Couple' ? 'As a couple' : 'Individual'}
                                    </div>
                                    <div className="text-sm text-slate-500">
                                        {settings.planningMode === 'Couple' ? 'Planning as a couple' : 'Planning for one person'}
                                    </div>
                                </div>
                            </div>
                            <span className="text-slate-600 group-hover:text-slate-400 text-xl">›</span>
                        </div>

                        {/* Primary User */}
                        <div className="p-4 flex items-center justify-between hover:bg-slate-800/50 cursor-pointer group"
                            onClick={() => setEditPerson('primary')}
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-violet-900/30 flex items-center justify-center text-xl text-violet-400 group-hover:bg-violet-900/50 transition-colors">
                                    ☺
                                </div>
                                <div>
                                    <div className="font-medium text-slate-200">{settings.primaryUser?.name || 'You'}</div>
                                    <div className="text-sm text-slate-500">
                                        Age {getAge(settings.primaryUser?.birthYear || 1980, settings.primaryUser?.birthMonth || 1)} • {MONTHS[(settings.primaryUser?.birthMonth || 1) - 1]} {settings.primaryUser?.birthYear}
                                    </div>
                                </div>
                            </div>
                            <span className="text-slate-600 group-hover:text-slate-400 text-xl">›</span>
                        </div>

                        {/* Spouse (Conditional) */}
                        {settings.planningMode === 'Couple' && (
                            <div className="p-4 flex items-center justify-between hover:bg-slate-800/50 cursor-pointer group"
                                onClick={() => setEditPerson('spouse')}
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-fuchsia-900/30 flex items-center justify-center text-xl text-fuchsia-400 group-hover:bg-fuchsia-900/50 transition-colors">
                                        ☺
                                    </div>
                                    <div>
                                        <div className="font-medium text-slate-200">{settings.spouse?.name || 'Spouse'}</div>
                                        <div className="text-sm text-slate-500">
                                            Age {getAge(settings.spouse?.birthYear || 1980, settings.spouse?.birthMonth || 1)} • {MONTHS[(settings.spouse?.birthMonth || 1) - 1]} {settings.spouse?.birthYear}
                                        </div>
                                    </div>
                                </div>
                                <span className="text-slate-600 group-hover:text-slate-400 text-xl">›</span>
                            </div>
                        )}
                    </div>
                </section>

                {/* App Preferences */}
                <section>
                    <h2 className="text-xl font-semibold mb-4 text-slate-200">App Preferences</h2>
                    <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-6">
                        <div>
                            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Main Currency</label>
                            <div className="flex items-center gap-4">
                                <CurrencySelector
                                    value={settings.mainCurrency || 'ILS'}
                                    onChange={c => updateSettings({ mainCurrency: c as any })}
                                    className="w-40"
                                />
                                <p className="text-sm text-slate-500">
                                    This currency will be used for dashboard totals.
                                    (Items: USD=3 ILS, EUR=3.5 ILS)
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Financial Parameters Section */}
                <section>
                    <h2 className="text-xl font-semibold mb-4 text-slate-200">Financial Parameters</h2>
                    <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Target Yearly Income</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-slate-500">$</span>
                                    <input
                                        type="number"
                                        className="w-full bg-slate-950 border border-slate-700 rounded p-2 pl-7 text-white focus:ring-2 focus:ring-violet-500 outline-none"
                                        value={targetIncome}
                                        onChange={(e) => setTargetIncome(Number(e.target.value) || 0)}
                                        onBlur={handleFinancialSave}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Default Rung Target</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-slate-500">$</span>
                                    <input
                                        type="number"
                                        className="w-full bg-slate-950 border border-slate-700 rounded p-2 pl-7 text-white focus:ring-2 focus:ring-violet-500 outline-none"
                                        value={defaultRungTarget}
                                        onChange={(e) => setDefaultRungTarget(Number(e.target.value) || 0)}
                                        onBlur={handleFinancialSave}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <button onClick={handleFinancialSave} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded transition-colors">
                                Save Parameters
                            </button>
                        </div>
                    </div>
                </section>

                {/* Edit Modals */}
                <EditPersonModal
                    isOpen={editPerson === 'primary'}
                    onClose={() => setEditPerson(null)}
                    title="About You"
                    data={settings.primaryUser || { name: 'You', birthYear: 1980, birthMonth: 1 }}
                    onSave={(data) => updateSettings({ primaryUser: data })}
                />

                <EditPersonModal
                    isOpen={editPerson === 'spouse'}
                    onClose={() => setEditPerson(null)}
                    title="About Your Partner"
                    data={settings.spouse || { name: 'Spouse', birthYear: 1980, birthMonth: 1 }}
                    onSave={(data) => updateSettings({ spouse: data })}
                />

            </div>
        </main>
    );
}
