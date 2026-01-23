import React, { useState } from 'react';
import { FinanceItem } from '@/components/CurrentFinances/FinanceTabs';

interface FinanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: FinanceItem) => void;
  initialData?: Partial<FinanceItem>;
  category: 'Savings' | 'Investments' | 'Assets' | 'Liabilities';
}

export const FinanceModal: React.FC<FinanceModalProps> = ({ isOpen, onClose, onSave, initialData, category }) => {
  const [name, setName] = useState(initialData?.name || '');
  const [value, setValue] = useState(initialData?.value || 0);
  const [type, setType] = useState(initialData?.type || '');
  const [owner, setOwner] = useState(initialData?.owner || 'You');
  const [details, setDetails] = useState<Record<string, string | number>>(initialData?.details || {});

  // Simple key-value pair state for details editing
  const [newDetailKey, setNewDetailKey] = useState('');
  const [newDetailValue, setNewDetailValue] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: initialData?.id || crypto.randomUUID(),
      category,
      name,
      value: Number(value),
      type,
      owner,
      details
    });
    onClose();
  };

  const addDetail = () => {
    if (newDetailKey && newDetailValue) {
        // Simple heuristic for number conversion
        const numVal = Number(newDetailValue);
        setDetails({ ...details, [newDetailKey]: isNaN(numVal) ? newDetailValue : numVal });
        setNewDetailKey('');
        setNewDetailValue('');
    }
  };
  
  const removeDetail = (key: string) => {
      const newDetails = { ...details };
      delete newDetails[key];
      setDetails(newDetails);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-md p-6 shadow-xl">
        <h2 className="text-xl font-bold mb-4 text-white">
          {initialData?.id ? 'Edit' : 'Add'} {category} Item
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Value ($)</label>
            <input
              type="number"
              required
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Type</label>
                <input
                type="text"
                required
                placeholder='e.g. Cash, Stock'
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                />
            </div>
             <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Owner</label>
                <select
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                >
                    <option value="You">You</option>
                    <option value="Spouse">Spouse</option>
                    <option value="Joint">Joint</option>
                </select>
            </div>
          </div>

          {/* Details Section */}
          <div className="border-t border-slate-800 pt-4 mt-4">
            <h3 className="text-sm font-medium text-white mb-2">Details</h3>
            
            <div className="flex gap-2 mb-2">
                <input 
                    placeholder="Key (e.g. Bank)" 
                    value={newDetailKey}
                    onChange={e => setNewDetailKey(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200"
                />
                 <input 
                    placeholder="Value" 
                    value={newDetailValue}
                     onChange={e => setNewDetailValue(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200"
                />
                <button type="button" onClick={addDetail} className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-slate-200 text-sm">+</button>
            </div>

            <div className="space-y-2 max-h-32 overflow-y-auto">
                {Object.entries(details).map(([k, v]) => (
                    <div key={k} className="flex justify-between items-center text-sm bg-slate-950/50 p-2 rounded">
                        <span className="text-slate-400">{k}: <span className="text-slate-200">{v}</span></span>
                        <button type="button" onClick={() => removeDetail(k)} className="text-red-400 hover:text-red-300">×</button>
                    </div>
                ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
