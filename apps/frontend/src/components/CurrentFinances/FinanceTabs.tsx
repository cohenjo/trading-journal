'use client';

import React, { useState } from 'react';
import { PlanModal } from '@/components/Plan/PlanModal';
import { PlanItem, PlanMilestone } from '@/components/Plan/types';

// --- Types ---
export interface FinanceItem {
  id: string;
  category: 'Savings' | 'Investments' | 'Assets' | 'Liabilities';
  name: string;
  value: number;
  subValue?: number; // e.g. amount owed on asset
  type: string;
  owner: string;
  currency?: string;
  inflow_priority?: number;
  withdrawal_priority?: number;
  details?: Record<string, any>;
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
    className={`flex-1 flex flex-col items-center justify-center py-3 px-1 border-b-2 transition-colors duration-200 ${active
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

      {/* Edit/Delete Overlay or Buttons */}
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
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency || 'USD' }).format(item.value)}
            </div>
          </div>
        </div>

        {/* Details Grid */}
        {item.details && Object.entries(item.details)
          .filter(([key]) => key !== 'rsu_grants') // Hide raw data
          .map(([key, value]) => (
            <div key={key} className="bg-slate-950/30 p-2 rounded border border-slate-800/30">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">{key.replace(/([A-Z])/g, " $1").trim()}</div>
              <div className="text-sm font-medium text-slate-300">
                {typeof value === 'number' && (key.toLowerCase().includes('rate') || key.toLowerCase().includes('yield'))
                  ? `${value}%`
                  : typeof value === 'number'
                    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency || 'USD' }).format(value)
                    : typeof value === 'object' ? JSON.stringify(value).slice(0, 20) + '...' : value}
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

import { PrioritiesTab } from './PrioritiesTab';
import { convertCurrency, formatCurrency } from '@/lib/currency';

interface FinanceTabsProps {
  items: FinanceItem[];
  onUpdateItems: (items: FinanceItem[]) => void;
  mainCurrency?: string;
}

export const FinanceTabs: React.FC<FinanceTabsProps> = ({ items, onUpdateItems, mainCurrency = 'USD' }) => {
  const [activeTab, setActiveTab] = useState<'Savings' | 'Investments' | 'Assets' | 'Liabilities' | 'Priorities'>('Assets');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanItem | undefined>(undefined);
  const [modalCategory, setModalCategory] = useState<'Account' | 'Asset' | 'Liability'>('Asset');

  const categories = ['Savings', 'Investments', 'Assets', 'Liabilities'] as const;

  // Calculate totals for tab labels
  const totals = categories.reduce((acc, cat) => {
    acc[cat] = items
      .filter(i => i.category === cat)
      .reduce((sum, i) => sum + convertCurrency(i.value, i.currency || 'ILS', mainCurrency), 0);
    return acc;
  }, {} as Record<string, number>);

  const filteredItems = items.filter((item) => item.category === activeTab);

  // --- Mapping Helpers ---

  const toPlanItem = (f: FinanceItem): PlanItem => {
    let pCat: any = 'Asset';
    if (f.category === 'Savings' || f.category === 'Investments') pCat = 'Account';
    if (f.category === 'Liabilities') pCat = 'Liability';

    const pItem: PlanItem = {
      id: f.id,
      name: f.name,
      category: pCat,
      sub_category: f.type, // Map generic type to sub_cat (e.g. "Brokerage Account")
      owner: f.owner,
      value: f.value,
      growth_rate: 0,
      currency: f.currency, // Persist currency
      frequency: 'OneTime',
      details: f.details,
      inflow_priority: f.inflow_priority,
      withdrawal_priority: f.withdrawal_priority,
    };

    if (pCat === 'Account') {
      // Try to map type string to account_settings.type
      // f.type might be "Brokerage Account" (Label) or "Broker" (Code) depending on how it was saved.
      // Let's assume best effort mapping.
      let accType: any = 'Taxable';
      const t = f.type.toLowerCase();
      if (t.includes('broker')) accType = 'Broker';
      else if (t.includes('401k')) accType = '401k';
      else if (t.includes('roth')) accType = 'Roth';
      else if (t.includes('ira')) accType = 'IRA';
      else if (t.includes('hishtalmut')) accType = 'Hishtalmut';
      else if (t.includes('espp')) accType = 'ESPP';
      else if (t.includes('rsu')) accType = 'RSU';
      else if (t.includes('hsa')) accType = 'HSA';
      else if (t.includes('pension')) accType = 'Pension';
      else if (t.includes('savings')) accType = 'Savings';

      pItem.account_settings = {
        type: accType,
        bond_allocation: 0,
        dividend_yield: 0,
        fees: 0
      };

      // Merge details back if they exist, to preserve rates etc.
      if (f.details) {
        if (f.details.growth_rate) pItem.growth_rate = Number(f.details.growth_rate);
        if (accType === 'Pension') {
          if (f.details.managing_body) pItem.account_settings.managing_body = f.details.managing_body;
          if (f.details.draw_income !== undefined) pItem.account_settings.draw_income = f.details.draw_income;
          if (f.details.divide_rate) pItem.account_settings.divide_rate = Number(f.details.divide_rate);
          if (f.details.starting_age) pItem.account_settings.starting_age = Number(f.details.starting_age);
          if (f.details.monthly_contribution) pItem.account_settings.monthly_contribution = Number(f.details.monthly_contribution);
        }
        if (accType === 'RSU') {
          if (f.details.stock_symbol) pItem.account_settings.stock_symbol = f.details.stock_symbol;
          if (f.details.rsu_grants) pItem.account_settings.rsu_grants = f.details.rsu_grants;
        }
      }
    }

    // Asset details
    if (pCat === 'Asset' && f.details) {
      // Map flattened details back to structures if needed, usually details dict is enough for simple mode
      // But PlanAssetDetails uses specific fields.
      // For now, PlanModal reads `item` props. 
      // If we have specific fields in f.details like `interest_rate`, we might want to map them?
      // PlanAssetDetails uses `item.financing` etc. 
      // Let's keep it simple: we pass `details` and let the Modal handle standard fields if it finds them, 
      // OR we map them explicitly if we want rich editing.
      // For now, let's rely on basic `details` being passed through.
    }

    return pItem;
  };

  const fromPlanItem = (p: PlanItem): FinanceItem => {
    let fCat: 'Savings' | 'Investments' | 'Assets' | 'Liabilities' = 'Assets';

    if (p.category === 'Account') {
      if (p.account_settings?.type === 'Savings' || p.account_settings?.type === 'Pension') fCat = 'Savings';
      else fCat = 'Investments';
    } else if (p.category === 'Liability') {
      fCat = 'Liabilities';
    }

    // Determine Type String (Label)
    let typeStr = p.sub_category || 'General';
    if (p.category === 'Account' && p.account_settings?.type) {
      // Maybe prefer the internal type code if sub_category is missing
      // But UI displays sub_category usually.
      if (!typeStr || typeStr === 'Account') typeStr = p.account_settings.type;
    }

    // Flatten useful nested props into details for the "Snapshot" view
    const details: Record<string, any> = { ...p.details };
    if (p.growth_rate) details.growth_rate = p.growth_rate;
    if (p.account_settings) {
      if (p.account_settings.dividend_yield) details.dividend_yield = p.account_settings.dividend_yield;
      if (p.account_settings.fees) details.fees = p.account_settings.fees;
      if (p.account_settings.type === 'Pension') {
        details.managing_body = p.account_settings.managing_body;
        details.draw_income = p.account_settings.draw_income;
        details.divide_rate = p.account_settings.divide_rate;
        details.starting_age = p.account_settings.starting_age;
        details.monthly_contribution = p.account_settings.monthly_contribution;
      }
      if (p.account_settings.type === 'RSU') {
        details.stock_symbol = p.account_settings.stock_symbol;
        details.rsu_grants = p.account_settings.rsu_grants;
        // Compute Summary for Display
        const totalVested = (p.account_settings.rsu_grants || []).reduce((sum, g) => sum + (g.vested || 0), 0);
        details.total_vested = totalVested + ' Shares'; // String to avoid currency formatting
      }
    }

    return {
      id: p.id,
      category: fCat,
      name: p.name,
      value: p.value,
      currency: p.currency, // Persist currency
      type: typeStr,
      owner: p.owner,
      inflow_priority: p.inflow_priority,
      withdrawal_priority: p.withdrawal_priority,
      details: details
    };
  };


  // --- Handlers ---

  const handleCreate = () => {
    let cat: 'Account' | 'Asset' | 'Liability' = 'Asset';
    if (activeTab === 'Savings' || activeTab === 'Investments') cat = 'Account';
    if (activeTab === 'Liabilities') cat = 'Liability';

    setModalCategory(cat);
    setEditingItem(undefined);
    setIsModalOpen(true);
  }

  const handleEdit = (item: FinanceItem) => {
    const pItem = toPlanItem(item);
    setModalCategory(pItem.category as any);
    setEditingItem(pItem);
    setIsModalOpen(true);
  }

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this item?')) {
      onUpdateItems(items.filter(i => i.id !== id));
    }
  }

  const handleSave = (pItem: PlanItem) => {
    const fItem = fromPlanItem(pItem);

    // Override category based on what we logic'd in fromPlanItem
    // But verify it matches expectation?
    // If user changed type in Modal (e.g. from Savings to Investment), fItem.category will reflect that.

    const exists = items.find(i => i.id === fItem.id);
    if (exists) {
      onUpdateItems(items.map(i => i.id === fItem.id ? fItem : i));
    } else {
      onUpdateItems([...items, fItem]);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="mt-8">
      {/* Tabs Header with Summaries */}
      <div className="flex border-b border-slate-800 mb-6 bg-slate-950">
        {categories.map((tab) => (
          <Tab
            key={tab}
            label={tab}
            subLabel={formatCurrency(totals[tab], mainCurrency, true)}
            active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          />
        ))}
        {/* Priorities Tab using simple Tab component but manual */}
        <Tab
          label="Priorities"
          subLabel="Cash Flow"
          active={activeTab === 'Priorities'}
          onClick={() => setActiveTab('Priorities')}
        />
      </div>

      {/* List */}
      <div className="space-y-4">
        {activeTab === 'Priorities' ? (
          <PrioritiesTab items={items} onUpdateItems={onUpdateItems} />
        ) : (
          filteredItems.length > 0 ? (
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
          )
        )}
      </div>

      {/* Quick Add Button below list */}
      {activeTab !== 'Priorities' && filteredItems.length > 0 && (
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
      <PlanModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        initialData={editingItem}
        category={modalCategory as any}
        milestones={[]} // Pass empty if not needed for this view
        mode="snapshot"
      />
    </div>
  );
};
