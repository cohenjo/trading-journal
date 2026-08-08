'use client';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { getPensionDashboard } from '@/app/pension/actions';
import { apiFetch } from '@/lib/api-client';
import { useSettings } from '@/app/settings/SettingsContext';
import type { PensionAccount } from '@/components/Pension/pensionTypes';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

type EditState = {
  value: string;
  deposits: string;
  withdrawal_coefficient: string;
};

type ProjectionRow = {
  id: string;
  owner: string;
  name: string;
  currentSum: number;
  monthlyContribution: number;
  withdrawalCoefficient: number;
  savingsAt50: number;
  savingsAt60: number;
  savingsAt67: number;
  pensionAt60: number;
  pensionAt67: number;
};

// Colors for the charts
const COLORS = ['#8b5cf6', '#d946ef', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e'];

export default function PensionEstimationPage() {
  const { settings } = useSettings();
  const [accounts, setAccounts] = useState<PensionAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [editStates, setEditStates] = useState<Record<string, EditState>>({});
  const [isEditing, setIsEditing] = useState<Record<string, boolean>>({});

  const assumedRateYearly = settings.pensionAssumedRate || 0.0386;
  const assumedRateMonthly = assumedRateYearly / 12;

  // Hardcoded dates based on requirements
  const stopWorkDate = new Date(2034, 6, 1); // July 2034
  const jony60Date = new Date(2044, 6, 1); // July 2044
  const jony67Date = new Date(2051, 6, 1); // July 2051

  const rita60Date = new Date(2042, 9, 1); // Oct 2042
  const rita67Date = new Date(2049, 9, 1); // Oct 2049

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const data = await getPensionDashboard();
      setAccounts(data.accounts || []);

      const newEditStates: Record<string, EditState> = {};
      (data.accounts || []).forEach(acc => {
        newEditStates[acc.id] = {
          value: acc.value.toString(),
          deposits: (acc.details?.deposits ?? acc.details?.monthly_contribution ?? 0).toString(),
          withdrawal_coefficient: ((acc.details?.divide_rate as number | undefined) ?? (acc.details?.withdrawal_coefficient as number | undefined) ?? 200).toString(),
        };
      });
      setEditStates(newEditStates);
    } catch (err) {
      console.error('Failed to load accounts', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleSave = async (id: string) => {
    const state = editStates[id];
    if (!state) return;

    setSavingId(id);
    try {
      await apiFetch(`/api/pension/${encodeURIComponent(id)}/override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: parseFloat(state.value) || 0,
          deposits: parseFloat(state.deposits) || 0,
          withdrawal_coefficient: parseFloat(state.withdrawal_coefficient) || 200,
        })
      });
      setIsEditing(prev => ({ ...prev, [id]: false }));
      await fetchAccounts();
    } catch (err) {
      console.error('Failed to save', err);
      alert('Failed to save overrides');
    } finally {
      setSavingId(null);
    }
  };

  // Helper to calculate FV month by month
  const calculateFV = (
    startValue: number,
    monthlyDeposit: number,
    startDate: Date,
    targetDate: Date,
    stopDepositDate: Date
  ) => {
    let currentVal = startValue;
    let currDate = new Date(startDate.getTime());

    while (currDate < targetDate) {
      const isDepositing = currDate < stopDepositDate;
      const deposit = isDepositing ? monthlyDeposit : 0;
      currentVal = currentVal * (1 + assumedRateMonthly) + deposit;

      // Advance 1 month
      currDate.setMonth(currDate.getMonth() + 1);
    }
    return currentVal;
  };

  const projections: ProjectionRow[] = useMemo(() => {
    const now = new Date();
    return accounts.map(acc => {
      const owner = (acc.owner || 'You').toLowerCase();
      const isSpouse = owner === 'rita' || owner === 'spouse';

      const date60 = isSpouse ? rita60Date : jony60Date;
      const date67 = isSpouse ? rita67Date : jony67Date;

      const currentSum = parseFloat(editStates[acc.id]?.value || '0') || acc.value;
      const monthlyContribution = parseFloat(editStates[acc.id]?.deposits || '0') || (acc.details?.deposits ?? 0);
      const withdrawalCoefficient = parseFloat(editStates[acc.id]?.withdrawal_coefficient || '0') || (acc.details?.divide_rate as number | undefined ?? acc.details?.withdrawal_coefficient as number | undefined ?? 200);

      const savingsAt50 = calculateFV(currentSum, monthlyContribution, now, stopWorkDate, stopWorkDate);
      const savingsAt60 = calculateFV(currentSum, monthlyContribution, now, date60, stopWorkDate);
      const savingsAt67 = calculateFV(currentSum, monthlyContribution, now, date67, stopWorkDate);

      return {
        id: acc.id,
        owner: acc.owner || 'You',
        name: acc.display_name || acc.name,
        currentSum,
        monthlyContribution,
        withdrawalCoefficient,
        savingsAt50,
        savingsAt60,
        savingsAt67,
        pensionAt60: withdrawalCoefficient > 0 ? savingsAt60 / withdrawalCoefficient : 0,
        pensionAt67: withdrawalCoefficient > 0 ? savingsAt67 / withdrawalCoefficient : 0,
      };
    });
  }, [accounts, editStates, assumedRateMonthly]);

  // Chart Data: Project total family wealth year by year up to 2051
  const chartData = useMemo(() => {
    const data = [];
    const now = new Date();
    const endYear = 2051;

    const accountSims = accounts.map(acc => {
       const currentSum = parseFloat(editStates[acc.id]?.value || '0') || acc.value;
       const monthlyContribution = parseFloat(editStates[acc.id]?.deposits || '0') || (acc.details?.deposits ?? 0);
       return { id: acc.id, name: acc.display_name || acc.name, val: currentSum, deposit: monthlyContribution };
    });

    let currDate = new Date(now.getTime());
    while (currDate.getFullYear() <= endYear) {
      if (currDate.getMonth() === 0 || currDate.getTime() === now.getTime()) {
        const point: any = { year: currDate.getFullYear() };
        accountSims.forEach(sim => {
          point[sim.name] = sim.val;
        });
        data.push(point);
      }

      const isDepositing = currDate < stopWorkDate;
      accountSims.forEach(sim => {
        const dep = isDepositing ? sim.deposit : 0;
        sim.val = sim.val * (1 + assumedRateMonthly) + dep;
      });

      currDate.setMonth(currDate.getMonth() + 1);
    }
    return data;
  }, [accounts, editStates, assumedRateMonthly]);

  const formatILS = (val: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(val);

  const totals = projections.reduce((acc, row) => ({
    currentSum: acc.currentSum + row.currentSum,
    savingsAt50: acc.savingsAt50 + row.savingsAt50,
    savingsAt60: acc.savingsAt60 + row.savingsAt60,
    savingsAt67: acc.savingsAt67 + row.savingsAt67,
    pensionAt60: acc.pensionAt60 + row.pensionAt60,
    pensionAt67: acc.pensionAt67 + row.pensionAt67,
  }), { currentSum: 0, savingsAt50: 0, savingsAt60: 0, savingsAt67: 0, pensionAt60: 0, pensionAt67: 0 });

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-white p-8 flex items-center justify-center">Loading estimation...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 pb-24">
      <div className="max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-fuchsia-400">Pension Estimation</h1>
          <p className="text-slate-400 mt-2">
            Project your pension savings and expected monthly income.
            Stop work date: <strong className="text-slate-200">July 2034</strong>.
            Assumed Growth: <strong className="text-slate-200">{(assumedRateYearly * 100).toFixed(2)}%</strong> (Change in Settings).
          </p>
        </header>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto shadow-xl">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3 text-right">Current Sum</th>
                <th className="px-4 py-3 text-right">Monthly Contrib.</th>
                <th className="px-4 py-3 text-right">Withdraw Coeff.</th>
                <th className="px-4 py-3 text-right text-violet-300">Savings @ 50</th>
                <th className="px-4 py-3 text-right text-fuchsia-300">Savings @ 60</th>
                <th className="px-4 py-3 text-right text-blue-300">Savings @ 67</th>
                <th className="px-4 py-3 text-right text-green-300">Pension @ 60</th>
                <th className="px-4 py-3 text-right text-emerald-300">Pension @ 67</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {projections.map((row) => {
                const editing = isEditing[row.id];
                return (
                  <tr key={row.id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-200">
                      {row.owner} - {row.name}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editing ? (
                        <input
                          type="number"
                          className="w-24 bg-slate-950 border border-slate-700 rounded p-1 text-right text-white"
                          value={editStates[row.id]?.value}
                          onChange={(e) => setEditStates(p => ({...p, [row.id]: {...p[row.id], value: e.target.value}}))}
                        />
                      ) : formatILS(row.currentSum)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editing ? (
                        <input
                          type="number"
                          className="w-20 bg-slate-950 border border-slate-700 rounded p-1 text-right text-white"
                          value={editStates[row.id]?.deposits}
                          onChange={(e) => setEditStates(p => ({...p, [row.id]: {...p[row.id], deposits: e.target.value}}))}
                        />
                      ) : formatILS(row.monthlyContribution)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editing ? (
                        <input
                          type="number"
                          className="w-16 bg-slate-950 border border-slate-700 rounded p-1 text-right text-white"
                          value={editStates[row.id]?.withdrawal_coefficient}
                          onChange={(e) => setEditStates(p => ({...p, [row.id]: {...p[row.id], withdrawal_coefficient: e.target.value}}))}
                        />
                      ) : row.withdrawalCoefficient.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-violet-200">{formatILS(row.savingsAt50)}</td>
                    <td className="px-4 py-3 text-right text-fuchsia-200">{formatILS(row.savingsAt60)}</td>
                    <td className="px-4 py-3 text-right text-blue-200">{formatILS(row.savingsAt67)}</td>
                    <td className="px-4 py-3 text-right font-bold text-green-400">{formatILS(row.pensionAt60)}</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-400">{formatILS(row.pensionAt67)}</td>
                    <td className="px-4 py-3 text-center">
                      {editing ? (
                        <div className="flex gap-2 justify-center">
                          <button
                            disabled={savingId === row.id}
                            onClick={() => handleSave(row.id)}
                            className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-2 py-1 rounded"
                          >
                            {savingId === row.id ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => setIsEditing(p => ({...p, [row.id]: false}))}
                            className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setIsEditing(p => ({...p, [row.id]: true}))}
                          className="text-xs text-slate-400 hover:text-white"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* Totals Row */}
              <tr className="bg-slate-950 font-bold text-slate-200 border-t-2 border-slate-700">
                <td className="px-4 py-4">Total</td>
                <td className="px-4 py-4 text-right">{formatILS(totals.currentSum)}</td>
                <td className="px-4 py-4 text-right">-</td>
                <td className="px-4 py-4 text-right">-</td>
                <td className="px-4 py-4 text-right text-violet-300">{formatILS(totals.savingsAt50)}</td>
                <td className="px-4 py-4 text-right text-fuchsia-300">{formatILS(totals.savingsAt60)}</td>
                <td className="px-4 py-4 text-right text-blue-300">{formatILS(totals.savingsAt67)}</td>
                <td className="px-4 py-4 text-right text-green-400">{formatILS(totals.pensionAt60)}</td>
                <td className="px-4 py-4 text-right text-emerald-400">{formatILS(totals.pensionAt67)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Chart Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
          <h2 className="text-xl font-bold mb-6 text-white">Projected Growth</h2>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="year"
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8' }}
                />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8' }}
                  tickFormatter={(val) => `₪${(val / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }}
                  itemStyle={{ color: '#e2e8f0' }}
                  formatter={(val: number) => formatILS(val)}
                  labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                {accounts.map((acc, index) => (
                  <Line
                    key={acc.id}
                    type="monotone"
                    dataKey={acc.display_name || acc.name}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
