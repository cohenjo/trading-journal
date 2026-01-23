import React from 'react';
import { PlanItem } from './types';

interface Props {
  item: PlanItem;
  onChange: (updates: Partial<PlanItem>) => void;
}

export const PlanAccountDetails: React.FC<Props> = ({ item, onChange }) => {
    
    const settings = item.account_settings || {
        type: 'Taxable',
        bond_allocation: 0,
        dividend_yield: 0,
        fees: 0,
        withdrawal_priority: 1
    };

    const updateSettings = (updates: Partial<typeof settings>) => {
        onChange({ account_settings: { ...settings, ...updates } });
    };

    return (
        <div className="space-y-4">
             {/* Value & Type */}
             <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                    💰 Account Details
                </h4>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs text-slate-400">Current Balance ($)</label>
                        <input 
                            type="number" 
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                            value={item.value}
                            onChange={e => onChange({ value: parseFloat(e.target.value) })}
                        />
                    </div>
                     <div>
                        <label className="text-xs text-slate-400">Account Type</label>
                        <select 
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                            value={settings.type}
                            onChange={e => updateSettings({ type: e.target.value as any })}
                        >
                            <option value="Taxable">Taxable Brokerage</option>
                            <option value="401k">401k / 403b</option>
                            <option value="Roth">Roth IRA</option>
                            <option value="HSA">HSA</option>
                            <option value="Savings">Savings / Cash</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Growth & Allocation */}
            <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                    📈 Investment Profile
                </h4>
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="text-xs text-slate-400">Planned Growth Rate (%)</label>
                        <input 
                            type="number" 
                            step="0.1"
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                            value={item.growth_rate}
                            onChange={e => onChange({ growth_rate: parseFloat(e.target.value) })}
                        />
                        <p className="text-xs text-slate-500 mt-1">Expected annual return</p>
                    </div>
                    <div>
                        <label className="text-xs text-slate-400">Bond Allocation (%)</label>
                         <input 
                            type="number" 
                            step="1"
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                            value={settings.bond_allocation}
                            onChange={e => updateSettings({ bond_allocation: parseFloat(e.target.value) })}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-400">Dividend Yield (%)</label>
                         <input 
                            type="number" 
                            step="0.1"
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                            value={settings.dividend_yield}
                            onChange={e => updateSettings({ dividend_yield: parseFloat(e.target.value) })}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-400">Annual Fees (%)</label>
                         <input 
                            type="number" 
                            step="0.01"
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                            value={settings.fees}
                            onChange={e => updateSettings({ fees: parseFloat(e.target.value) })}
                        />
                    </div>
                </div>
            </div>

             {/* Usage */}
             <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                    💸 Usage Strategy
                </h4>
                <div className="flex justify-between items-center">
                    <label className="text-xs text-slate-400">Withdrawal Priority</label>
                     <select 
                            className="bg-slate-900 border-slate-700 rounded p-2 text-white text-sm"
                            value={settings.withdrawal_priority}
                            onChange={e => updateSettings({ withdrawal_priority: parseInt(e.target.value) })}
                        >
                            <option value={1}>1 - First</option>
                            <option value={2}>2 - Second</option>
                            <option value={3}>3 - Third</option>
                            <option value={4}>4 - Last</option>
                        </select>
                </div>
                <p className="text-xs text-slate-500">
                    Determines which accounts are liquidated first to cover deficits.
                </p>
            </div>
        </div>
    );
};
