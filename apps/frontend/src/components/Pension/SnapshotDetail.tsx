'use client';

import React from 'react';
import type { PensionSnapshotSummary, PensionSnapshotAccount } from './pensionTypes';

type Props = {
  snapshot: PensionSnapshotSummary;
  previousSnapshot: PensionSnapshotSummary | null;
  onClose: () => void;
};

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(val);

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
};

function DeltaCell({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined || previous === 0) return null;
  const diff = current - previous;
  const pct = ((diff / previous) * 100).toFixed(1);
  const isPositive = diff > 0;
  return (
    <div
      className={`text-xs ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}
    >
      {isPositive ? '+' : ''}
      {formatCurrency(diff)} ({isPositive ? '+' : ''}{pct}%)
    </div>
  );
}

export default function SnapshotDetail({ snapshot, previousSnapshot, onClose }: Props) {
  const totalDelta = previousSnapshot
    ? snapshot.total_value - previousSnapshot.total_value
    : null;

  return (
    <div className="bg-slate-900 border border-blue-500/30 rounded-xl p-6 relative">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-1 text-slate-500 hover:text-slate-300 transition-colors"
        title="Close"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-semibold text-white">
            Snapshot — {formatDate(snapshot.date)}
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-2xl font-bold text-emerald-400">
            {formatCurrency(snapshot.total_value)}
          </span>
          {totalDelta !== null && previousSnapshot && (
            <div className="flex flex-col">
              <span
                className={`text-sm font-semibold ${totalDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
              >
                {totalDelta >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(totalDelta))}
              </span>
              <span className="text-xs text-slate-500">
                vs {formatDate(previousSnapshot.date)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Account details table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-slate-300">
          <thead className="text-xs text-slate-400 uppercase bg-slate-800/50">
            <tr>
              <th className="px-4 py-3 font-semibold">Owner</th>
              <th className="px-4 py-3 font-semibold">Account</th>
              <th className="px-4 py-3 font-semibold text-right">Value</th>
              <th className="px-4 py-3 font-semibold text-right">Change</th>
              <th className="px-4 py-3 font-semibold text-right">Deposits</th>
              <th className="px-4 py-3 font-semibold text-right">Earnings</th>
              <th className="px-4 py-3 font-semibold text-right">Fees</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {snapshot.accounts.map((acc: PensionSnapshotAccount) => {
              const prevAcc = previousSnapshot?.accounts.find((a) => a.id === acc.id);
              return (
                <tr key={acc.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        acc.owner === 'You'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-purple-500/20 text-purple-400'
                      }`}
                    >
                      {acc.owner}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-200 font-medium">{acc.name}</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                    {formatCurrency(acc.value)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DeltaCell current={acc.value} previous={prevAcc?.value} />
                  </td>
                  <td className="px-4 py-3 text-right text-slate-400">
                    {acc.deposits ? formatCurrency(acc.deposits) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400/80">
                    {acc.earnings ? formatCurrency(acc.earnings) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-rose-400/80">
                    {(acc.fees || acc.insurance_fees)
                      ? formatCurrency((acc.fees || 0) + (acc.insurance_fees || 0))
                      : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
