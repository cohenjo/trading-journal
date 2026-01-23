'use client';

import React, { useState, useEffect } from 'react';
import { DonutChart } from '@/components/CurrentFinances/DonutChart';
import { FinanceTabs, FinanceItem } from '@/components/CurrentFinances/FinanceTabs';

// --- API Helper ---
async function fetchLatestSnapshot() {
  try {
    const res = await fetch('/api/finances/latest');
    if (!res.ok) {
        if (res.status === 404) return null; // No snapshot yet
        const errorText = await res.text();
        throw new Error(`Failed to fetch snapshot: ${res.status} ${errorText}`);
    }
    const data = await res.json();
    // Use the inner 'data' which matches our SnapshotData structure
    // But check if it has the 'items' key.
    // The backend stores JSON in 'data' column. 
    // And FinanceSnapshot model has 'data' field.
    return data.data; 
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function saveSnapshot(items: FinanceItem[], metrics: { net_worth: number, total_assets: number, total_liabilities: number, total_savings: number, total_investments: number }) {
  try {
    const payload = {
        items,
        ...metrics
    };
    
    const res = await fetch('/api/finances/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to save snapshot: ${res.status} ${errorText}`);
    }
    return await res.json();
  } catch (err) {
    console.error(err);
    alert('Failed to save changes. Check console.');
  }
}


export default function CurrentFinancesPage() {
  const [items, setItems] = useState<FinanceItem[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Initial Fetch ---
  useEffect(() => {
    fetchLatestSnapshot().then(data => {
        if (data && data.items) {
            setItems(data.items);
        }
        setLoading(false);
    });
  }, []);

  // --- Calculations for Charts ---
  const assetsItems = items.filter(i => i.category === 'Assets');
  const savingsItems = items.filter(i => i.category === 'Savings');
  const investmentItems = items.filter(i => i.category === 'Investments');
  const liabilityItems = items.filter(i => i.category === 'Liabilities');

  const totalRealAssets = assetsItems.reduce((sum, i) => sum + i.value, 0);
  const totalSavings = savingsItems.reduce((sum, i) => sum + i.value, 0);
  const totalInvestments = investmentItems.reduce((sum, i) => sum + i.value, 0);
  const totalEquity = totalSavings + totalInvestments;
  const totalLiabilities = liabilityItems.reduce((sum, i) => sum + i.value, 0);

  const totalAssets = totalRealAssets + totalEquity;
  const netWorth = totalAssets - totalLiabilities;

  // Save logic tied to items update
  // We wrap setItems to also trigger save, or use an effect. 
  // Using a handler is safer to control when save happens.
  const handleUpdateItems = (newItems: FinanceItem[]) => {
      setItems(newItems);
      
      const tAssetsItems = newItems.filter(i => i.category === 'Assets');
      const tSavingsItems = newItems.filter(i => i.category === 'Savings');
      const tInvestItems = newItems.filter(i => i.category === 'Investments');
      const tLiabilityItems = newItems.filter(i => i.category === 'Liabilities');

      const tRealAssets = tAssetsItems.reduce((sum, i) => sum + i.value, 0);
      const tSavings = tSavingsItems.reduce((sum, i) => sum + i.value, 0);
      const tInvestments = tInvestItems.reduce((sum, i) => sum + i.value, 0);
      const tLiabilities = tLiabilityItems.reduce((sum, i) => sum + i.value, 0);
      const tTotalAssets = tRealAssets + tSavings + tInvestments;

      saveSnapshot(newItems, {
          net_worth: tTotalAssets - tLiabilities,
          total_assets: tTotalAssets,
          total_liabilities: tLiabilities,
          total_savings: tSavings,
          total_investments: tInvestments
      });
  };


  // Chart Data Preparation 
  
  // 1. Net Worth Allocation (Real Assets vs Equity)
  const netWorthData = [
    { label: 'Real Assets', value: totalRealAssets, color: '#facc15' }, // Yellow-400
    { label: 'Equity', value: totalEquity, color: '#8b5cf6' },          // Violet-500
  ];

  // 2. Real Assets Breakdown (by Item Name)
  const assetsData = assetsItems.length > 0 
    ? assetsItems.map((item, idx) => ({
        label: item.name,
        value: item.value,
        color: ['#fde047', '#eab308', '#ca8a04', '#a16207'][idx % 4], // Yellow Ramp
      }))
    : [{ label: 'None', value: 0, color: '#334155' }];

  // 3. Equity Breakdown (by Type)
  // Group savings + investments by 'type'
  const equityItems = [...savingsItems, ...investmentItems];
  const equityByType = equityItems.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + item.value;
      return acc;
  }, {} as Record<string, number>);
  
  const equityData = Object.entries(equityByType).length > 0
    ? Object.entries(equityByType).map(([type, value], idx) => ({
        label: type, 
        value: value,
        color: ['#a78bfa', '#7c3aed', '#60a5fa', '#3b82f6', '#22d3ee'][idx % 5], // Violet/Blue/Cyan mix
    }))
    : [{ label: 'None', value: 0, color: '#334155' }];


  // 4. Liability Breakdown (by Item Name)
  const liabilityData = liabilityItems.length > 0 
    ? liabilityItems.map((item, idx) => ({
        label: item.name,
        value: item.value,
        color: idx === 0 ? '#ef4444' : '#f87171',
      }))
    : [{ label: 'None', value: 0, color: '#334155' }];

  if (loading) {
      return <div className="min-h-screen bg-slate-950 p-8 text-slate-400">Loading finances...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Current Finances</h1>
            <p className="text-slate-400 text-sm">Overview of net worth, assets, and liabilities.</p>
          </div>
          {/* Could add date selector here later */}
        </header>

        {/* Compact Charts Row */}
        <div className="flex flex-col md:flex-row gap-4 mb-8 justify-between items-center bg-slate-900/30 p-4 rounded-xl border border-slate-800/50 overflow-x-auto">
            <DonutChart 
                data={netWorthData} 
                totalLabel="Net Worth" 
                size={140} 
                thickness={10}
            />
             <DonutChart 
                data={assetsData} 
                totalLabel="Real Assets" 
                size={140} 
                thickness={10}
            />
             <DonutChart 
                data={equityData} 
                totalLabel="Equity" 
                subLabel="(Investments)"
                size={140} 
                thickness={10}
            />
             <DonutChart 
                data={liabilityData} 
                totalLabel="Liabilities" 
                size={140} 
                thickness={10}
            />
        </div>

        {/* Data Tabs w/ Integrated Editing */}
        <FinanceTabs items={items} onUpdateItems={handleUpdateItems} />

      </div>
    </div>
  );
}
