'use client';

import React, { useState, useEffect } from 'react';
import type {
  PensionReportsResponse,
  PensionSnapshotSummary,
  PensionSnapshotAccount,
} from './pensionTypes';

type Props = {
  /** Called when the user selects a snapshot to view its details */
  onSelectSnapshot: (snapshot: PensionSnapshotSummary | null) => void;
  /** Currently selected snapshot date, kept in sync with parent */
  selectedDate: string | null;
  /** Trigger refetch when a new upload completes */
  refreshKey: number;
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

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  if (diff === 0 || previous === 0) return null;
  const pct = ((diff / previous) * 100).toFixed(1);
  const isPositive = diff > 0;
  return (
    <span
      className={`inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded ${
        isPositive
          ? 'bg-emerald-500/20 text-emerald-400'
          : 'bg-rose-500/20 text-rose-400'
      }`}
    >
      {isPositive ? '▲' : '▼'} {formatCurrency(Math.abs(diff))} ({isPositive ? '+' : ''}{pct}%)
    </span>
  );
}

export default function ReportHistory({ onSelectSnapshot, selectedDate, refreshKey }: Props) {
  const [data, setData] = useState<PensionReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch('/api/pension/reports')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: PensionReportsResponse) => {
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 animate-pulse">
        <div className="h-5 bg-slate-800 rounded w-40 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-slate-800/50 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Report History</h2>
        <p className="text-red-400 text-sm">Failed to load reports: {error}</p>
      </div>
    );
  }

  const snapshots = data?.snapshots ?? [];
  const reports = data?.reports ?? [];

  if (snapshots.length === 0 && reports.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Report History</h2>
        <p className="text-slate-500 text-sm italic">
          No historical reports yet. Upload your first pension report above.
        </p>
      </div>
    );
  }

  const handleSnapshotClick = (snapshot: PensionSnapshotSummary) => {
    if (selectedDate === snapshot.date) {
      onSelectSnapshot(null);
    } else {
      onSelectSnapshot(snapshot);
    }
  };

  const toggleExpand = (date: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedDate(expandedDate === date ? null : date);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-1">Report History</h2>
      <p className="text-slate-500 text-xs mb-4">
        {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''} · {reports.length} file{reports.length !== 1 ? 's' : ''}
      </p>

      {/* Snapshot timeline */}
      <div className="space-y-2">
        {snapshots.map((snapshot, idx) => {
          const prevSnapshot = idx > 0 ? snapshots[idx - 1] : null;
          const isSelected = selectedDate === snapshot.date;
          const isExpanded = expandedDate === snapshot.date;

          return (
            <div key={snapshot.date}>
              <button
                onClick={() => handleSnapshotClick(snapshot)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-slate-800 bg-slate-800/30 hover:border-slate-700 hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        idx === snapshots.length - 1
                          ? 'bg-emerald-400'
                          : 'bg-slate-600'
                      }`}
                    />
                    <div>
                      <span className="text-sm font-medium text-slate-200">
                        {formatDate(snapshot.date)}
                      </span>
                      {idx === snapshots.length - 1 && (
                        <span className="ml-2 text-xs text-emerald-400 font-medium">Latest</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-emerald-400">
                      {formatCurrency(snapshot.total_value)}
                    </span>
                    {prevSnapshot && (
                      <DeltaBadge
                        current={snapshot.total_value}
                        previous={prevSnapshot.total_value}
                      />
                    )}
                    <button
                      onClick={(e) => toggleExpand(snapshot.date, e)}
                      className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                      title="Show accounts"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-1 ml-5">
                  <span className="text-xs text-slate-500">
                    {snapshot.account_count} account{snapshot.account_count !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>

              {/* Expanded account details */}
              {isExpanded && (
                <div className="ml-5 mt-1 mb-2 border-l-2 border-slate-800 pl-4 space-y-2">
                  {snapshot.accounts.map((acc: PensionSnapshotAccount) => {
                    const prevAcc = prevSnapshot?.accounts.find((a) => a.id === acc.id);
                    return (
                      <div
                        key={acc.id}
                        className="flex items-center justify-between text-xs py-1"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              acc.owner === 'You'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-purple-500/20 text-purple-400'
                            }`}
                          >
                            {acc.owner}
                          </span>
                          <span className="text-slate-300">{acc.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 font-medium">
                            {formatCurrency(acc.value)}
                          </span>
                          {prevAcc && (
                            <DeltaBadge current={acc.value} previous={prevAcc.value} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Uploaded files section */}
      {reports.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400 transition-colors">
            Uploaded files ({reports.length})
          </summary>
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {reports.map((r, i) => (
              <div
                key={`${r.filename}-${i}`}
                className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-slate-800/30"
              >
                <div className="flex items-center gap-2 truncate">
                  <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-slate-400 truncate">{r.filename}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                      r.owner === 'You'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-purple-500/20 text-purple-400'
                    }`}
                  >
                    {r.owner}
                  </span>
                  <span className="text-slate-600">{formatFileSize(r.size_bytes)}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
