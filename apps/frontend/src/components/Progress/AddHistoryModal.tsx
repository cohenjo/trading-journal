'use client';

import React, { useState } from 'react';

export interface ProgressSummary {
  date: string;
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  total_savings: number;
  total_investments: number;
}

interface AddHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (summary: ProgressSummary) => void;
  initialData?: ProgressSummary;
}

export const AddHistoryModal: React.FC<AddHistoryModalProps> = ({ isOpen, onClose, onSave, initialData }) => {
  const [formData, setFormData] = useState<Partial<ProgressSummary>>({
    date: new Date().toISOString().split('T')[0],
    net_worth: 0,
    total_assets: 0,  
    total_liabilities: 0,
    total_savings: 0,
    total_investments: 0
  });

  // Reset/Initialize form data when modal opens or initialData changes
  React.useEffect(() => {
    if (isOpen) {
        if (initialData) {
            setFormData(initialData);
        } else {
            setFormData({
                date: new Date().toISOString().split('T')[0],
                net_worth: 0,
                total_assets: 0,  
                total_liabilities: 0,
                total_savings: 0,
                total_investments: 0
            });
        }
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'date' ? value : parseFloat(value) || 0
    }));
  };
  
  // Internal state adds 'real_assets' to distinguish from total calculation
  // We map 'total_assets' in the form data to mean 'Real Assets' based on user preference
  const calculateNetWorth = () => {
      const realAssets = (formData.total_assets || 0);
      const savings = (formData.total_savings || 0);
      const investments = (formData.total_investments || 0);
      const liabilities = (formData.total_liabilities || 0);
      
      const totalWorth = (realAssets + savings + investments) - liabilities;
      
      setFormData(prev => ({ ...prev, net_worth: totalWorth }));
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.date) return;
    
    onSave({
      date: formData.date,
      net_worth: formData.net_worth || 0,
      total_assets: formData.total_assets || 0, // Sending Real Assets as total_assets per user mental model
      total_liabilities: formData.total_liabilities || 0,
      total_savings: formData.total_savings || 0,
      total_investments: formData.total_investments || 0,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
          <h2 className="text-lg font-semibold text-slate-100">Add Historic Snapshot</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Date</label>
            <input 
                type="date" 
                name="date"
                required
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                value={formData.date}
                onChange={handleChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Savings</label>
                <input 
                    type="number" 
                    name="total_savings"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    value={formData.total_savings}
                    onChange={(e) => { handleChange(e); }}
                    onBlur={calculateNetWorth}
                />
             </div>
             <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Investments</label>
                <input 
                    type="number" 
                    name="total_investments"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    value={formData.total_investments}
                    onChange={(e) => { handleChange(e); }}
                    onBlur={calculateNetWorth}
                />
             </div>
          </div>

           <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Real Assets</label>
                <input 
                    type="number" 
                    name="total_assets"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    value={formData.total_assets}
                    onChange={(e) => { handleChange(e); }}
                    onBlur={calculateNetWorth}
                />
             </div>
             <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Total Liabilities</label>
                <input 
                    type="number" 
                    name="total_liabilities"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    value={formData.total_liabilities}
                    onChange={(e) => { handleChange(e); }}
                    onBlur={calculateNetWorth}
                />
             </div>
          </div>

          <div className="pt-2 border-t border-slate-800">
             <label className="block text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1.5">Net Worth (Calculated)</label>
             <input 
                type="number" 
                name="net_worth"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-blue-100 font-bold focus:outline-none"
                value={formData.net_worth}
                readOnly
             />
          </div>

          <div className="pt-4 flex justify-end gap-3">
             <button 
                type="button" 
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
             >
                Cancel
             </button>
             <button 
                type="submit" 
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors shadow-lg shadow-blue-900/20"
             >
                Add Snapshot
             </button>
          </div>

        </form>
      </div>
    </div>
  );
};
