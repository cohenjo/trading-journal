'use client';

import React, { useState } from 'react';
import { FinanceModal } from './FinanceModal';

// --- Types ---
export interface FinanceItem {
  id: string;
  category: 'Savings' | 'Investments' | 'Assets' | 'Liabilities';
  name: string;
  value: number;
  subValue?: number; // e.g. amount owed on asset
  type: string;
  owner: string;
  details?: Record<string, string | number>;
}

interface TabProps {
  label: string;
  subLabel?: string; 
  active: boolean;
  onClick: () => void;
}

// --- Components ---

const Tab: React.FC<TabProps> = ({ label, subLabel, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-1 flex flex-col items-center justify-center py-3 px-1 border-b-2 transition-colors duration-200 ${
      active
        ? 'border-blue-500 bg-slate-900/50'
        : 'border-transparent hover:bg-slate-900/30 border-slate-800'
    }`}
  >
    <span className={`text-sm font-medium ${active ? 'text-blue-400' : 'text-slate-400'}`}>{label}</span>
    {subLabel && <span className={`text-xs mt-1 ${active ? 'text-slate-100 font-bold' : 'text-slate-500'}`}>{subLabel}</span>}
  </button>
);

const FinanceCard: React.FC<{ item: FinanceItem; onEdit: (item: FinanceItem) => void; onDelete: (id: string) => void }> = ({ item, onEdit, onDelete }) => {
  return (
    <div className="bg-slate-900 rounded-lg p-5 mb-4 border border-slate-800 flex flex-col md:flex-row gap-5 group relative">
      
      {/* Edit/Delete Overlay or Buttons (Visible on Hover usually, but explicit edit button is better for mobile) */}
      <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
         <button onClick={() => onEdit(item)} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 transition-colors" title="Edit">
            ✏️
         </button>
         <button onClick={() => onDelete(item.id)} className="p-1.5 bg-slate-800 hover:bg-red-900/50 rounded text-red-400 transition-colors" title="Delete">
            🗑️
         </button>
      </div>

      {/* Icon Placeholder */}
      <div className="flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-xl">
            {item.category === 'Assets' && '🏠'}
            {item.category === 'Investments' && '📈'}
            {item.category === 'Savings' && '💰'}
            {item.category === 'Liabilities' && '💳'}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-grow grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Header */}
        <div className="col-span-1 md:col-span-2 lg:col-span-4 flex justify-between items-start border-b border-slate-800 pb-3 mb-1">
            <div>
                 <h3 className="text-base font-semibold text-slate-100">{item.name}</h3>
                 <span className="text-xs text-slate-400 font-medium bg-slate-800 px-1.5 py-0.5 rounded uppercase tracking-wider">{item.type}</span>
            </div>
            <div className="text-right mr-8 md:mr-0"> 
                 <div className="text-lg font-bold text-slate-100">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.value)}
                 </div>
            </div>
        </div>
        
        {/* Details Grid */}
        {item.details && Object.entries(item.details).map(([key, value]) => (
          <div key={key} className="bg-slate-950/30 p-2 rounded border border-slate-800/30">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">{key.replace(/([A-Z])/g, " $1").trim()}</div>
            <div className="text-sm font-medium text-slate-300">
                {typeof value === 'number' && key.toLowerCase().includes('rate') 
                    ? `${value}%` 
                    : typeof value === 'number' 
                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
                        : value}
            </div>
          </div>
        ))}

        <div className="bg-slate-950/30 p-2 rounded border border-slate-800/30">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Owner</div>
            <div className="text-sm font-medium text-slate-300">
                 {item.owner}
            </div>
        </div>

      </div>
    </div>
  );
};

interface FinanceTabsProps {
  items: FinanceItem[];
  onUpdateItems: (items: FinanceItem[]) => void;
}

export const FinanceTabs: React.FC<FinanceTabsProps> = ({ items, onUpdateItems }) => {
  const [activeTab, setActiveTab] = useState<'Savings' | 'Investments' | 'Assets' | 'Liabilities'>('Assets');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FinanceItem | undefined>(undefined);

  const categories = ['Savings', 'Investments', 'Assets', 'Liabilities'] as const;

  // Calculate totals for tab labels
  const totals = categories.reduce((acc, cat) => {
    acc[cat] = items.filter(i => i.category === cat).reduce((sum, i) => sum + i.value, 0);
    return acc;
  }, {} as Record<string, number>);

  const filteredItems = items.filter((item) => item.category === activeTab);

  // --- Handlers ---

  const handleCreate = () => {
      setEditingItem(undefined);
      setIsModalOpen(true);
  }

  const handleEdit = (item: FinanceItem) => {
      setEditingItem(item);
      setIsModalOpen(true);
  }

  const handleDelete = (id: string) => {
      if(window.confirm('Delete this item?')) {
          onUpdateItems(items.filter(i => i.id !== id));
      }
  }

  const handleSave = (item: FinanceItem) => {
      if (editingItem) {
          // Update
          onUpdateItems(items.map(i => i.id === item.id ? item : i));
      } else {
          // Create
          onUpdateItems([...items, item]);
      }
  };

  return (
    <div className="mt-8">
      {/* Tabs Header with Summaries */}
      <div className="flex border-b border-slate-800 mb-6 bg-slate-950">
        {categories.map((tab) => (
          <Tab
            key={tab}
            label={tab}
            subLabel={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totals[tab])}
            active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          />
        ))}
      </div>

      {/* List */}
      <div className="space-y-4">
        {filteredItems.length > 0 ? (
          filteredItems.map((item) => (
            <FinanceCard 
                key={item.id} 
                item={item} 
                onEdit={handleEdit} 
                onDelete={handleDelete}
            />
          ))
        ) : (
          <div className="text-center py-12 bg-slate-900 rounded-lg border border-slate-800 border-dashed">
            <p className="text-slate-500">No items found in {activeTab}</p>
            <button 
                onClick={handleCreate}
                className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm text-white transition-colors"
            >
                Add {activeTab.slice(0, -1)}
            </button>
          </div>
        )}
      </div>
      
      {/* Quick Add Button below list */}
       {filteredItems.length > 0 && (
          <div className="mt-6 flex justify-center">
            <button 
                onClick={handleCreate}
                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-md text-sm text-white transition-colors border border-slate-700 flex items-center gap-2"
            >
                <span>+</span> Add {activeTab.slice(0, -1)}
            </button>
          </div>
        )}

        {/* Modal */}
        <FinanceModal 
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSave={handleSave}
            initialData={editingItem}
            category={activeTab}
        />
    </div>
  );
};
