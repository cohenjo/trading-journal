import React, { useEffect } from 'react';
import { PlanItem } from './types';

interface Props {
  item: PlanItem;
  onChange: (updates: Partial<PlanItem>) => void;
}

export const PlanAssetDetails: React.FC<Props> = ({ item, onChange }) => {
    
    // Helper to calculate monthly payment
    // P = L[c(1 + c)^n]/[(1 + c)^n - 1]
    const calculatePayment = (loan: number, rate: number, months: number) => {
        if (rate === 0) return loan / months;
        const c = rate / 100 / 12;
        return (loan * (c * Math.pow(1 + c, months))) / (Math.pow(1 + c, months) - 1);
    };

    // Auto-update monthly payment if loan parameters change
    useEffect(() => {
        if (item.financing && item.financing.term_months > 0) {
            const loan = item.value - (item.financing.down_payment || 0);
            if (loan > 0) {
                const pmt = calculatePayment(loan, item.financing.interest_rate, item.financing.term_months);
                // Only update if significantly different to avoid loop
                if (!item.financing.monthly_payment || Math.abs(pmt - item.financing.monthly_payment) > 0.1) {
                    onChange({ financing: { ...item.financing, monthly_payment: pmt } });
                }
            }
        }
    }, [item.value, item.financing?.down_payment, item.financing?.interest_rate, item.financing?.term_months]);

    const hasFinancing = !!item.financing;
    const isRecurring = item.recurrence?.rule === 'Replace';

    return (
        <div className="space-y-4">
             {/* Value & Down Payment */}
             <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                    🛒 Purchase Details
                </h4>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs text-slate-400">Total Price ($)</label>
                        <input 
                            type="number" 
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                            value={item.value}
                            onChange={e => onChange({ value: parseFloat(e.target.value) })}
                        />
                    </div>
                </div>
            </div>

            {/* Change Over Time */}
            <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                    📈 Change Over Time
                </h4>
                 <div className="flex gap-4 items-center">
                    <div className="flex-1">
                        <label className="text-xs text-slate-400">Annual Growth / Depreciation (%)</label>
                        <input 
                            type="number" 
                            step="0.1"
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                            value={item.growth_rate}
                            onChange={e => onChange({ growth_rate: parseFloat(e.target.value) })}
                        />
                        <p className="text-xs text-slate-500 mt-1">Use negative for depreciation (e.g. -8.0)</p>
                    </div>
                </div>
            </div>

             {/* Financing */}
             <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700">
                <div className="flex justify-between items-center">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                        🏦 Financing Details
                    </h4>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={hasFinancing}
                            onChange={(e) => {
                                if (e.target.checked) {
                                    onChange({ 
                                        financing: { 
                                            down_payment: item.value * 0.2, // Default 20%
                                            interest_rate: 6.0, 
                                            term_months: 60,
                                            monthly_payment: 0 
                                        } 
                                    });
                                } else {
                                    onChange({ financing: undefined });
                                }
                            }}
                        />
                        <span className="text-xs text-slate-400">Financed?</span>
                    </label>
                </div>

                {hasFinancing && item.financing && (
                    <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                        <div>
                            <label className="text-xs text-slate-400">Down Payment ($)</label>
                            <input 
                                type="number" 
                                className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                value={item.financing.down_payment}
                                onChange={e => onChange({ financing: { ...item.financing!, down_payment: parseFloat(e.target.value) } })}
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400">Interest Rate (APR %)</label>
                            <input 
                                type="number" step="0.1"
                                className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                value={item.financing.interest_rate}
                                onChange={e => onChange({ financing: { ...item.financing!, interest_rate: parseFloat(e.target.value) } })}
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400">Loan Term (Months)</label>
                            <input 
                                type="number" 
                                className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                value={item.financing.term_months}
                                onChange={e => onChange({ financing: { ...item.financing!, term_months: parseFloat(e.target.value) } })}
                            />
                        </div>
                         <div>
                            <label className="text-xs text-slate-400">Monthly Payment ($)</label>
                            <div className="w-full bg-slate-900/50 border border-slate-800 rounded p-2 text-slate-400 cursor-not-allowed">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.financing.monthly_payment || 0)}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Recurrence / Replacement */}
            <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700">
                <div className="flex justify-between items-center">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                         🔁 Recurrence
                    </h4>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={isRecurring}
                            onChange={(e) => {
                                if (e.target.checked) {
                                    onChange({ recurrence: { rule: 'Replace', period_years: 7 } });
                                } else {
                                    onChange({ recurrence: undefined });
                                }
                            }}
                        />
                        <span className="text-xs text-slate-400">Repeat Purchase?</span>
                    </label>
                </div>
                 {isRecurring && item.recurrence && (
                    <div className="animate-in fade-in slide-in-from-top-2">
                        <label className="text-xs text-slate-400">Replace Every (Years)</label>
                        <input 
                            type="number" 
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white mt-1"
                            value={item.recurrence.period_years}
                            onChange={e => onChange({ recurrence: { ...item.recurrence!, period_years: parseFloat(e.target.value) } })}
                        />
                         <p className="text-xs text-slate-500 mt-2">
                            Assumes sale of old asset and purchase of new one at same initial formatted price (inflation adjusted).
                        </p>
                    </div>
                 )}
            </div>
        </div>
    );
};
