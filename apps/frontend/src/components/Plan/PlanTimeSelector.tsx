import React from 'react';
import { PlanItem, PlanMilestone } from './types';

interface Props {
  label: string;
  condition: PlanItem['start_condition'] | PlanItem['end_condition'];
  reference: string | undefined;
  date: string | undefined;
  milestones: PlanMilestone[];
  onChange: (updates: Partial<PlanItem>) => void;
  isEnd?: boolean;
}

export const PlanTimeSelector: React.FC<Props> = ({ 
    label, condition, reference, date, milestones, onChange, isEnd 
}) => {
    // Default to 'Date' if undefined
    const activeCondition = condition || (date ? 'Date' : (isEnd ? 'Forever' : 'Now'));

    // Options for the dropdown
    // For Start: Now, Date, Milestone
    // For End: Forever, Date, Milestone
    const typeOptions = isEnd 
        ? ['Forever', 'Date', 'Milestone'] 
        : ['Now', 'Date', 'Milestone'];

    return (
        <div className="bg-slate-800 p-4 rounded-lg flex flex-col gap-3 border border-slate-700">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</label>
            
            <div className="flex gap-2">
                <select
                    value={activeCondition}
                    onChange={(e) => {
                        const newCond = e.target.value as any;
                        const updates: any = isEnd 
                            ? { end_condition: newCond } 
                            : { start_condition: newCond };
                        
                        // Reset ref if switching
                        if (newCond === 'Milestone') updates[isEnd ? 'end_reference' : 'start_reference'] = milestones[0]?.id || '';
                        
                        onChange(updates);
                    }}
                    className="bg-slate-900 border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-violet-500"
                >
                    {typeOptions.map(o => <option key={o} value={o}>{o === 'Forever' ? '∞ End of Plan' : o}</option>)}
                </select>

                {activeCondition === 'Date' && (
                    <input 
                        type="date" 
                        value={date || ''}
                        onChange={(e) => onChange(isEnd ? { end_date: e.target.value } : { start_date: e.target.value })}
                        className="flex-1 bg-slate-900 border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 outline-none"
                    />
                )}

                {activeCondition === 'Milestone' && (
                    <select
                        value={reference || ''}
                        onChange={(e) => onChange(isEnd ? { end_reference: e.target.value } : { start_reference: e.target.value })}
                        className="flex-1 bg-slate-900 border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 outline-none"
                    >
                        {milestones.length > 0 ? milestones.map(m => (
                            <option key={m.id} value={m.id}>
                                🏷️ {m.name} {m.year_offset ? `(+${m.year_offset}y)` : ''}
                            </option>
                        )) : <option disabled>No milestones</option>}
                    </select>
                )}
                
                {activeCondition === 'Now' && (
                    <div className="flex-1 flex items-center text-sm text-slate-500 italic px-2">
                        Starts Immediately
                    </div>
                )}
                
                 {activeCondition === 'Forever' && (
                    <div className="flex-1 flex items-center text-sm text-slate-500 italic px-2">
                        Until end of projection
                    </div>
                )}
            </div>
        </div>
    );
};
