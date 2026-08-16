import React from 'react';
import { PlanItem, PlanMilestone } from './types';
import { CurrencySelector } from '../Common/CurrencySelector';

interface Props {
  item: PlanItem;
  onChange: (updates: Partial<PlanItem>) => void;
  mode: 'planning' | 'snapshot';
  milestones?: PlanMilestone[];
}

export const PlanLiabilityDetails: React.FC<Props> = ({ item, onChange, mode, milestones }) => {
  const details = item.details || {};
  const subPlans = details.sub_plans || [];

  return (
    <div className="bg-slate-800 p-4 rounded-lg space-y-6 border border-slate-700">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Outstanding Balance</label>
          <div className="flex gap-2">
            <input type="number" className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
              value={item.value ?? ''}
              onChange={e => {
                const val = parseFloat(e.target.value);
                onChange({ value: isNaN(val) ? 0 : val });
              }}
            />
            <CurrencySelector
              value={item.currency || 'ILS'}
              onChange={c => onChange({ currency: c })}
              className="w-24 shrink-0"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Monthly Payment</label>
          <div className="flex gap-2">
            <input type="number" className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
              value={details.monthly_payment ?? ''}
              onChange={e => {
                const val = parseFloat(e.target.value);
                onChange({ details: { ...details, monthly_payment: isNaN(val) ? 0 : val } });
              }}
              placeholder="e.g. 5623.41"
            />
            <div className="w-24 shrink-0 flex items-center justify-center bg-slate-900 border border-slate-700 rounded text-sm text-slate-400 uppercase font-medium">
                {item.currency || 'ILS'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-slate-700/50 pt-4">
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">Start Date</label>
            <input type="date" className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white text-sm"
              value={details.start_date || ''}
              onChange={e => onChange({ details: { ...details, start_date: e.target.value } })}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 block">End Date</label>
            <input type="date" className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white text-sm"
              value={details.end_date || ''}
              onChange={e => onChange({ details: { ...details, end_date: e.target.value } })}
            />
          </div>
      </div>

      {subPlans.length > 0 && (
        <div className="border-t border-slate-700/50 pt-4">
          <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Sub-Plans</h4>
          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
            {subPlans.map((plan: any, idx: number) => (
              <div key={idx} className="bg-slate-900/50 p-3 rounded border border-slate-700/50 flex justify-between items-center group hover:border-slate-600 transition-colors">
                <div>
                  <div className="text-sm font-medium text-slate-200">{plan.name}</div>
                  <div className="text-xs text-slate-500 mt-1">Plan #{plan.plan_id} &bull; Ends {plan.end_date}</div>
                </div>
                <div className="text-sm font-bold text-slate-300 bg-slate-800 px-2 py-1 rounded">
                   {new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency || 'ILS' }).format(plan.balance)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
