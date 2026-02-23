'use client';

import React, { useState, useEffect } from 'react';
import { DonutChart } from '@/components/CurrentFinances/DonutChart';
import { FinanceTabs, FinanceItem } from '@/components/CurrentFinances/FinanceTabs';
import { useSettings } from '../settings/SettingsContext';
import { convertCurrency } from '@/lib/currency';

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
  const { settings } = useSettings();
  const mainCurrency = settings.mainCurrency || 'USD';
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

  const totalRealAssets = assetsItems.reduce((sum, i) => sum + convertCurrency(i.value, i.currency || 'ILS', mainCurrency), 0);
  const totalSavings = savingsItems.reduce((sum, i) => sum + convertCurrency(i.value, i.currency || 'ILS', mainCurrency), 0);
  const totalInvestments = investmentItems.reduce((sum, i) => sum + convertCurrency(i.value, i.currency || 'ILS', mainCurrency), 0);
  const totalEquity = totalSavings + totalInvestments;
  const totalLiabilities = liabilityItems.reduce((sum, i) => sum + convertCurrency(i.value, i.currency || 'ILS', mainCurrency), 0);

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

    // NOTE: For 'metrics' we save them in the main currency or base?
    // Logic: The snapshot store should probably be agnostic or we store it 'as is' and convert on read.
    // But the 'metrics' fields are summations.
    // Let's store them as Main Currency values at the time of save, OR usage consistency.
    // Given we use these for "Net Worth History" which might not convert retroactively if rates change,
    // it is safer to store the SUM in the users Main Currency at that time. 
    // OR store them in Base ILS if we want consistency. 
    // The current flow doesn't check 'mainCurrency' for save logic (user context).
    // Let's save the calculated totals (which are now in Main Currency).
    // But wait: if user switches currency, history chart will jump!
    // Ideally history is normalized to a Base currency (e.g. ILS or USD).
    // Since backend doesn't seem to have multi-currency history support yet,
    // let's stick to saving what the user sees (Main Currency) and assume they don't flip flop often OR backend handles it.
    // PROPOSAL: Store metrics in base currency (ILS or USD) always?
    // Let's assume the backend expects raw values and `PlanService` converts them.
    // Actually `saveSnapshot` just dumps JSON.
    // Let's simply save the converted totals so the snapshot matches the dashboard view.

    const tRealAssets = tAssetsItems.reduce((sum, i) => sum + convertCurrency(i.value, i.currency || 'ILS', mainCurrency), 0);
    const tSavings = tSavingsItems.reduce((sum, i) => sum + convertCurrency(i.value, i.currency || 'ILS', mainCurrency), 0);
    const tInvestments = tInvestItems.reduce((sum, i) => sum + convertCurrency(i.value, i.currency || 'ILS', mainCurrency), 0);
    const tLiabilities = tLiabilityItems.reduce((sum, i) => sum + convertCurrency(i.value, i.currency || 'ILS', mainCurrency), 0);
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
      value: convertCurrency(item.value, item.currency || 'USD', mainCurrency),
      color: ['#fde047', '#eab308', '#ca8a04', '#a16207'][idx % 4], // Yellow Ramp
    }))
    : [{ label: 'None', value: 0, color: '#334155' }];

  // 3. Equity Breakdown (by Type)
  // Group savings + investments by 'type'
  const equityItems = [...savingsItems, ...investmentItems];
  const equityByType = equityItems.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + convertCurrency(item.value, item.currency || 'ILS', mainCurrency);
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
      value: convertCurrency(item.value, item.currency || 'USD', mainCurrency),
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
            mainCurrency={mainCurrency}
          />
          <DonutChart
            data={assetsData}
            totalLabel="Real Assets"
            size={140}
            thickness={10}
            mainCurrency={mainCurrency}
          />
          <DonutChart
            data={equityData}
            totalLabel="Equity"
            subLabel="(Investments)"
            size={140}
            thickness={10}
            mainCurrency={mainCurrency}
          />
          <DonutChart
            data={liabilityData}
            totalLabel="Liabilities"
            size={140}
            thickness={10}
            mainCurrency={mainCurrency}
          />
        </div>

        {/* Data Tabs w/ Integrated Editing */}
        <FinanceTabs items={items} onUpdateItems={handleUpdateItems} mainCurrency={mainCurrency} />

      </div>
    </div>
  );
}
