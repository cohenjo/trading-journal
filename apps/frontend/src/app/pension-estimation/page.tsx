'use client';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { getPensionDashboard } from '@/app/pension/actions';
import { apiFetch } from '@/lib/api-client';
import { useSettings } from '@/app/settings/SettingsContext';
import { generatePensionProjection } from '@/lib/pension';
import type { PensionAccount } from '@/components/Pension/pensionTypes';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Bar,
  Tooltip,
  ReferenceLine,
  LabelList,
  AreaChart,
  Area,
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
  const [showAfterTax, setShowAfterTax] = useState(false);

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

      // Update local state instantly for snappy UI
      setAccounts(prev => prev.map(acc => {
        if (acc.id === id) {
          return {
            ...acc,
            value: parseFloat(state.value) || acc.value,
            details: {
              ...(acc.details || {}),
              deposits: parseFloat(state.deposits) || acc.details?.deposits || 0,
              withdrawal_coefficient: parseFloat(state.withdrawal_coefficient) || acc.details?.withdrawal_coefficient || 200,
              divide_rate: parseFloat(state.withdrawal_coefficient) || acc.details?.divide_rate || 200,
            }
          };
        }
        return acc;
      }));

      // Still fetch in background to ensure consistency
      fetchAccounts().catch(console.error);
    } catch (err) {
      console.error('Failed to save', err);
      alert('Failed to save overrides');
    } finally {
      setSavingId(null);
    }
  };

  // generatePensionProjection handles the FV math!

  const projections: ProjectionRow[] = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const stopWorkYear = stopWorkDate.getFullYear();

    return accounts.map(acc => {
      const owner = (acc.owner || 'You').toLowerCase();
      const isSpouse = owner === 'rita' || owner === 'spouse';

      const birthYear = isSpouse ? (settings?.spouse?.birthYear || 1982) : (settings?.primaryUser?.birthYear || 1984);
      const age60Year = birthYear + 60;
      const age67Year = birthYear + 67;

      const currentSum = parseFloat(editStates[acc.id]?.value || '0') || acc.value;
      const monthlyContribution = parseFloat(editStates[acc.id]?.deposits || '0') || (acc.details?.deposits ?? 0);
      const withdrawalCoefficient = parseFloat(editStates[acc.id]?.withdrawal_coefficient || '0') || (acc.details?.divide_rate as number | undefined ?? acc.details?.withdrawal_coefficient as number | undefined ?? 200);

      const proj60 = generatePensionProjection(currentYear, birthYear, currentSum, monthlyContribution, stopWorkYear, 60, assumedRateYearly, withdrawalCoefficient);
      const proj67 = generatePensionProjection(currentYear, birthYear, currentSum, monthlyContribution, stopWorkYear, 67, assumedRateYearly, withdrawalCoefficient);

      // get balance right before they turn 60/67
      const savingsAt50 = proj60.find(p => p.year === stopWorkYear)?.balance || 0;
      const savingsAt60 = proj60.find(p => p.year === age60Year - 1)?.balance || 0;
      const savingsAt67 = proj67.find(p => p.year === age67Year - 1)?.balance || 0;

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
        // No wait, calculateFV returned the balance. pensionAt60 = balance / coefficient.
        // So monthly payout! But generatePensionProjection grossPayout is ANNUAL!
        // So let's divide by 12.
        pensionAt60: (proj60.find(p => p.year === age60Year)?.grossPayout || 0) / 12,
        pensionAt67: (proj67.find(p => p.year === age67Year)?.grossPayout || 0) / 12,
      };
    });
  }, [accounts, editStates, assumedRateYearly, settings]);

  // Chart Data: Project total family wealth year by year up to 2051
  const chartData = useMemo(() => {
    const data = [];
    const currentYear = new Date().getFullYear();
    const endYear = 2051;
    const stopWorkYear = stopWorkDate.getFullYear();

    // Generate projections for each account (just growth, no payout)
    const projectionsByAcc = accounts.map(acc => {
      const owner = (acc.owner || 'You').toLowerCase();
      const isSpouse = owner === 'rita' || owner === 'spouse';
      const birthYear = isSpouse ? (settings?.spouse?.birthYear || 1982) : (settings?.primaryUser?.birthYear || 1984);
      const currentSum = parseFloat(editStates[acc.id]?.value || '0') || acc.value;
      const monthlyContribution = parseFloat(editStates[acc.id]?.deposits || '0') || (acc.details?.deposits ?? 0);

      return {
        name: acc.display_name || acc.name,
        // Start age 99 so it never pays out during this chart
        proj: generatePensionProjection(currentYear, birthYear, currentSum, monthlyContribution, stopWorkYear, 99, assumedRateYearly, 200)
      };
    });

    for (let y = currentYear; y <= endYear; y++) {
      const point: any = { year: y };
      projectionsByAcc.forEach(pAcc => {
        const pt = pAcc.proj.find(p => p.year === y);
        point[pAcc.name] = pt ? pt.balance : 0;
      });
      data.push(point);
    }

    return data;
  }, [accounts, editStates, assumedRateYearly, settings]);

  const formatILS = (val: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(val);

  const totals = projections.reduce((acc, row) => ({
    currentSum: acc.currentSum + row.currentSum,
    savingsAt50: acc.savingsAt50 + row.savingsAt50,
    savingsAt60: acc.savingsAt60 + row.savingsAt60,
    savingsAt67: acc.savingsAt67 + row.savingsAt67,
    pensionAt60: acc.pensionAt60 + row.pensionAt60,
    pensionAt67: acc.pensionAt67 + row.pensionAt67,
  }), { currentSum: 0, savingsAt50: 0, savingsAt60: 0, savingsAt67: 0, pensionAt60: 0, pensionAt67: 0 });

  // Withdrawal Strategies Comparison
  const withdrawalStrategiesData = useMemo(() => {
    let jonyGross60 = 0, jonyGross67 = 0;
    let ritaGross60 = 0, ritaGross67 = 0;

    projections.forEach(row => {
      const isSpouse = row.owner.toLowerCase() === 'rita' || row.owner.toLowerCase() === 'spouse';
      if (isSpouse) {
        ritaGross60 += row.pensionAt60;
        ritaGross67 += row.pensionAt67;
      } else {
        jonyGross60 += row.pensionAt60;
        jonyGross67 += row.pensionAt67;
      }
    });

    const getNet = (grossMonthly: number, year: number, is67: boolean) => {
      if (!showAfterTax) return grossMonthly;
      const annualGross = grossMonthly * 12;

      // We can use the imported calculateIsraeliPensionTax! But wait, Kitzba Mukeret (15%) logic is baked into it already
      // if we just pass the gross. Actually calculateIsraeliPensionTax computes the TAX.
      // So net is (gross - tax) / 12
      const { calculateIsraeliPensionTax } = require('@/lib/pension');
      const taxPaidAnnual = calculateIsraeliPensionTax(annualGross, year, is67);
      return (annualGross - taxPaidAnnual) / 12;
    };

    const jony60Year = jony60Date.getFullYear();
    const jony67Year = jony67Date.getFullYear();
    const rita60Year = rita60Date.getFullYear();
    const rita67Year = rita67Date.getFullYear();

    const opt1 = getNet(jonyGross60, jony60Year, false) + getNet(ritaGross60, rita60Year, false);
    const opt2 = getNet(jonyGross67, jony67Year, true) + getNet(ritaGross67, rita67Year, true);

    // Option 3: 15% at 60 (tax free), 85% at 67 (taxable, with Kibua Zchuyot)
    const jonyOpt3 = (jonyGross60 * 0.15) + getNet(jonyGross67 * 0.85, jony67Year, true);
    const ritaOpt3 = (ritaGross60 * 0.15) + getNet(ritaGross67 * 0.85, rita67Year, true);

    const jonyOpt3Val = showAfterTax ? jonyOpt3 : (jonyGross60 * 0.15 + jonyGross67 * 0.85);
    const ritaOpt3Val = showAfterTax ? ritaOpt3 : (ritaGross60 * 0.15 + ritaGross67 * 0.85);
    const splitOptionIncome = jonyOpt3Val + ritaOpt3Val;

    return [
      {
        name: 'All at Age 60',
        payout: opt1,
        fill: '#8b5cf6'
      },
      {
        name: 'Split (15% @ 60, 85% @ 67)',
        payout: splitOptionIncome,
        fill: '#f59e0b'
      },
      {
        name: 'All at Age 67',
        payout: opt2,
        fill: '#10b981'
      }
    ];
  }, [projections, showAfterTax, rita60Date, jony60Date, rita67Date, jony67Date]);

  // Cumulative Withdrawal Comparison
  const cumulativeGraphData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const stopWorkYear = stopWorkDate.getFullYear();

    // Earliest year someone hits 60 (Rita in 2042)
    const startYear = 2042;
    // Youngest hits 100 (Jony turns 100 in 2084)
    const endYear = 2084;

    const data = [];
    let cumOpt1 = 0;
    let cumOpt2 = 0;
    let cumOpt3 = 0;

    const projectionsByAcc = accounts.map(acc => {
      const owner = (acc.owner || 'You').toLowerCase();
      const isSpouse = owner === 'rita' || owner === 'spouse';
      const birthYear = isSpouse ? (settings?.spouse?.birthYear || 1982) : (settings?.primaryUser?.birthYear || 1984);
      const currentSum = parseFloat(editStates[acc.id]?.value || '0') || acc.value;
      const monthlyContribution = parseFloat(editStates[acc.id]?.deposits || '0') || (acc.details?.deposits ?? 0);
      const withdrawalCoefficient = parseFloat(editStates[acc.id]?.withdrawal_coefficient || '0') || (acc.details?.divide_rate as number | undefined ?? acc.details?.withdrawal_coefficient as number | undefined ?? 200);

      // Option 1: All at 60
      const projOpt1 = generatePensionProjection(currentYear, birthYear, currentSum, monthlyContribution, stopWorkYear, 60, assumedRateYearly, withdrawalCoefficient);
      // Option 2: Jony at 60, Rita at 67
      const projOpt2 = generatePensionProjection(currentYear, birthYear, currentSum, monthlyContribution, stopWorkYear, isSpouse ? 67 : 60, assumedRateYearly, withdrawalCoefficient);
      // Option 3: All at 67
      const projOpt3 = generatePensionProjection(currentYear, birthYear, currentSum, monthlyContribution, stopWorkYear, 67, assumedRateYearly, withdrawalCoefficient);

      return { projOpt1, projOpt2, projOpt3 };
    });

    for (let y = startYear; y <= endYear; y++) {
      let annualOpt1 = 0;
      let annualOpt2 = 0;
      let annualOpt3 = 0;

      projectionsByAcc.forEach(pAcc => {
        const pt1 = pAcc.projOpt1.find(p => p.year === y);
        const pt2 = pAcc.projOpt2.find(p => p.year === y);
        const pt3 = pAcc.projOpt3.find(p => p.year === y);

        annualOpt1 += pt1 ? pt1.netPayout : 0;
        annualOpt2 += pt2 ? pt2.netPayout : 0;
        annualOpt3 += pt3 ? pt3.netPayout : 0;
      });

      cumOpt1 += annualOpt1;
      cumOpt2 += annualOpt2;
      cumOpt3 += annualOpt3;

      data.push({
        year: y,
        'All at 60': cumOpt1,
        'Split (Jony 60, Rita 67)': cumOpt2,
        'All at 67': cumOpt3
      });
    }

    return data;
  }, [accounts, editStates, assumedRateYearly, settings]);

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
                  formatter={(val: any) => formatILS(val)}
                  labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <ReferenceLine x={2034} stroke="#cbd5e1" strokeDasharray="3 3" label={{ position: 'top', value: 'Age 50', fill: '#cbd5e1', fontSize: 12 }} />
                <ReferenceLine x={2044} stroke="#cbd5e1" strokeDasharray="3 3" label={{ position: 'top', value: 'Age 60', fill: '#cbd5e1', fontSize: 12 }} />
                <ReferenceLine x={2051} stroke="#cbd5e1" strokeDasharray="3 3" label={{ position: 'top', value: 'Age 67', fill: '#cbd5e1', fontSize: 12 }} />
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

        {/* Withdrawal Strategy Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="md:w-1/3 flex flex-col justify-center">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white">Withdrawal Strategies</h2>
                <button
                  onClick={() => setShowAfterTax(!showAfterTax)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showAfterTax ? 'bg-violet-600' : 'bg-slate-700'}`}
                  title="Toggle Post-Tax vs Pre-Tax"
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showAfterTax ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                Compare your estimated monthly income across three scenarios. {showAfterTax ? 'Showing POST-TAX amounts based on expected future brackets and exemptions.' : 'Showing PRE-TAX gross amounts.'}
              </p>
              <ul className="space-y-3 text-sm text-slate-300">
                <li className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-violet-500"></div>
                  <span><strong>Age 60:</strong> Pull all accounts early (fully taxed).</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                  <span><strong>Split:</strong> Pull the 15% tax-exempt portion at 60, defer the rest to 67.</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                  <span><strong>Age 67:</strong> Defer everything until retirement age (eligible for Kibua Zchuyot).</span>
                </li>
              </ul>
            </div>

            <div className="md:w-2/3 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={withdrawalStrategiesData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8' }}
                    tickFormatter={(val) => `₪${(val / 1000).toFixed(0)}k`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#1e293b' }}
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '0.5rem' }}
                    formatter={(val: any) => [formatILS(val), 'Monthly Payout']}
                  />
                  <Bar
                    dataKey="payout"
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey="payout"
                      position="top"
                      formatter={(val: any) => formatILS(val)}
                      fill="#e2e8f0"
                      fontSize={13}
                      fontWeight="bold"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Cumulative Withdrawal Comparison Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
          <h2 className="text-xl font-bold mb-2 text-white">Cumulative Post-Tax Withdrawals (Age 60 to 100)</h2>
          <p className="text-slate-400 text-sm mb-6">
            Compare total cumulative cash flow from pension payouts across different starting ages. This helps visualize the crossover point where deferring to age 67 overcomes the 7 lost years of payouts.
          </p>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cumulativeGraphData} margin={{ top: 10, right: 20, left: 20, bottom: 5 }}>
                <defs>
                  <linearGradient id="colorOpt1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorOpt2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorOpt3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
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
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '0.5rem' }}
                  itemStyle={{ color: '#e2e8f0' }}
                  formatter={(val: any) => formatILS(val)}
                  labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Area type="monotone" dataKey="All at 60" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorOpt1)" strokeWidth={3} />
                <Area type="monotone" dataKey="Split (Jony 60, Rita 67)" stroke="#f59e0b" fillOpacity={1} fill="url(#colorOpt2)" strokeWidth={3} />
                <Area type="monotone" dataKey="All at 67" stroke="#10b981" fillOpacity={1} fill="url(#colorOpt3)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
