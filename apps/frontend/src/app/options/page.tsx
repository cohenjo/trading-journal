'use client';
export const dynamic = 'force-dynamic';

import Decimal from 'decimal.js';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import EfficiencyGauges from '@/components/Options/efficiency-gauges';
import FreshnessBadge from '@/components/Options/freshness-badge';
import NetCashFlowVsRealizedChart, { buildOptionsChartSeries } from '@/components/Options/net-cash-flow-vs-realized-chart';
import RollEfficiencyDonut from '@/components/Options/roll-efficiency-donut';
import TradeLifecycleTimeline from '@/components/Options/trade-lifecycle-timeline';
import VarianceGapBadge from '@/components/Options/variance-gap-badge';
import { formatDate, formatSignedUsd } from '@/components/Options/options-format';
import type { EfficiencyGaugesData, MonthlyMetric, OptionsEnabledAccount, OptionsFreshness, OptionsTradeSummary, RollEvent, StrategyGroup } from '@/types/options';
import {
  getEfficiencyGaugesData,
  getOptionsFreshness,
  getOptionsMonthlyMetrics,
  getOptionsRollEvents,
  getOptionsStrategyTimeline,
  getOptionsTrades,
  getUserAccountsWithOptionsEnabled,
} from './actions';

interface DashboardState {
  accounts: OptionsEnabledAccount[];
  months: MonthlyMetric[];
  rolls: RollEvent[];
  groups: StrategyGroup[];
  freshness: OptionsFreshness;
  trades: OptionsTradeSummary[];
  gauges: EfficiencyGaugesData;
}

const EMPTY_STATE: DashboardState = {
  accounts: [],
  months: [],
  rolls: [],
  groups: [],
  freshness: { asOf: null, source: null, status: null },
  trades: [],
  gauges: { rocaR_pct: null, marginUtilization_pct: null, marginSource: null, marginAsOf: null, marginUsed: null, marginAvailable: null, isStale: false },
};

function yearRange(): number[] {
  const current = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, index) => current - index);
}

function rangeForYear(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
  };
}

function isStale(asOf: string | null): boolean {
  if (!asOf) return false;
  return Date.now() - new Date(asOf).getTime() > 24 * 60 * 60 * 1000;
}

function SkeletonDashboard() {
  return (
    <div className="space-y-6" aria-label="Loading options dashboard">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-96 animate-pulse rounded-3xl bg-slate-900" />
        <div className="h-96 animate-pulse rounded-3xl bg-slate-900 lg:col-span-2" />
      </div>
      <div className="h-[430px] animate-pulse rounded-3xl bg-slate-900" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-96 animate-pulse rounded-3xl bg-slate-900 lg:col-span-2" />
        <div className="h-96 animate-pulse rounded-3xl bg-slate-900" />
      </div>
    </div>
  );
}

function EmptyAccountsCard() {
  return (
    <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/70 p-10 text-center">
      <h2 className="text-2xl font-bold text-slate-100">No trading accounts are opted into options income yet</h2>
      <p className="mx-auto mt-3 max-w-2xl text-slate-400">
        Enable the options-income computation toggle on an IBKR trading account to start the Flex sync → grouping → metrics worker chain.
      </p>
      <Link href="/trading/accounts" className="mt-6 inline-flex rounded-full bg-blue-500 px-5 py-3 font-semibold text-white hover:bg-blue-400">
        Open account settings
      </Link>
    </div>
  );
}

function EmptyDataCard() {
  return (
    <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/70 p-10 text-center">
      <h2 className="text-2xl font-bold text-slate-100">No options dashboard metrics for this range yet</h2>
      <p className="mx-auto mt-3 max-w-2xl text-slate-400">
        The options worker runs daily after Flex ingestion. If this is a new setup, run the options backfill manually to populate monthly metrics, strategy groups, and roll classifications.
      </p>
    </div>
  );
}

function DrillDownTrades({ trades }: { trades: OptionsTradeSummary[] }) {
  return (
    <details className="rounded-3xl border border-slate-700/80 bg-slate-950/80 p-5">
      <summary className="cursor-pointer text-lg font-semibold text-slate-100">Trade drill-down ({trades.length})</summary>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Underlying</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2 text-right">Cash Flow</th>
              <th className="px-3 py-2 text-right">Realized P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id} className="border-t border-slate-800 text-slate-200">
                <td className="px-3 py-2">{formatDate(trade.tradeDate)}</td>
                <td className="px-3 py-2">{trade.underlyingSymbol ?? '—'}</td>
                <td className="px-3 py-2 capitalize">{trade.eventType}</td>
                <td className="px-3 py-2 capitalize">{trade.side}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatSignedUsd(trade.netCashFlow)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatSignedUsd(trade.realizedPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function OptionsPage() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedAccount, setSelectedAccount] = useState('');
  const [data, setData] = useState<DashboardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { start, end } = rangeForYear(selectedYear);

    async function loadDashboard() {
      setLoading(true);
      setError(null);
      try {
        const accountFilter = selectedAccount || undefined;
        const [accounts, months, rolls, groups, freshness, trades, gauges] = await Promise.all([
          getUserAccountsWithOptionsEnabled(),
          getOptionsMonthlyMetrics(selectedYear, accountFilter),
          getOptionsRollEvents(start, end, accountFilter),
          getOptionsStrategyTimeline(start, end, accountFilter),
          getOptionsFreshness(),
          getOptionsTrades(start, end, accountFilter),
          getEfficiencyGaugesData(accountFilter),
        ]);

        if (!cancelled) setData({ accounts, months, rolls, groups, freshness, trades, gauges });
      } catch (err) {
        console.error('Failed to load options dashboard:', err);
        if (!cancelled) setError('Failed to load options dashboard. Please refresh and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [selectedAccount, selectedYear]);

  const chartSeries = useMemo(() => buildOptionsChartSeries(data.months), [data.months]);
  const latestPoint = chartSeries.at(-1);
  const totals = useMemo(() => {
    if (!latestPoint) {
      return { cashFlow: '0', realized: '0', gap: '0', asOf: data.freshness.asOf };
    }
    return {
      cashFlow: latestPoint.cumulativeCashFlow,
      realized: latestPoint.cumulativeRealizedPnl,
      gap: latestPoint.varianceGap,
      asOf: data.freshness.asOf ?? data.months.at(-1)?.lastComputedAt ?? latestPoint.time,
    };
  }, [data.freshness.asOf, data.months, latestPoint]);

  const rollCounts = useMemo(() => data.rolls.reduce(
    (acc, roll) => ({
      positive: acc.positive + (roll.classification === 'positive' ? 1 : 0),
      negative: acc.negative + (roll.classification === 'negative' ? 1 : 0),
      neutral: acc.neutral + (roll.classification === 'neutral' ? 1 : 0),
    }),
    { positive: 0, negative: 0, neutral: 0 },
  ), [data.rolls]);

  const aggregateCashFlow = data.groups.reduce((sum, group) => sum.plus(group.netCashFlow), new Decimal(0));

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_35%),#020617] p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.34em] text-blue-300">Phase 4</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-50">Options Income Dashboard</h1>
          <p className="mt-2 text-slate-400">Read-only Flex metrics: cash flow, realized P&amp;L, strategy lifecycle, and roll quality.</p>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <FreshnessBadge asOf={data.freshness.asOf} source={data.freshness.source} />
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedAccount}
              onChange={(event) => setSelectedAccount(event.target.value)}
              className="rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100"
              aria-label="Options account filter"
            >
              <option value="">All options-enabled accounts</option>
              {data.accounts.map((account) => (
                <option key={account.id} value={account.accountId}>{account.label}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              className="rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100"
              aria-label="Options year filter"
            >
              {yearRange().map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
        </div>
      </header>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-200" role="alert">{error}</div>}
      {isStale(data.freshness.asOf) && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-100">
          Options Flex sync is stale. Realized P&amp;L remains visible, but refresh before making tax or risk decisions.
        </div>
      )}

      {loading ? <SkeletonDashboard /> : data.accounts.length === 0 ? <EmptyAccountsCard /> : data.months.length === 0 ? <EmptyDataCard /> : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <VarianceGapBadge cumulativeCashFlow={totals.cashFlow} cumulativeRealizedPnl={totals.realized} gap={totals.gap} asOf={totals.asOf} />
            <div className="lg:col-span-2"><EfficiencyGauges data={data.gauges} /></div>
          </div>

          <NetCashFlowVsRealizedChart months={data.months} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2"><TradeLifecycleTimeline groups={data.groups} /></div>
            <RollEfficiencyDonut positive={rollCounts.positive} negative={rollCounts.negative} neutral={rollCounts.neutral} />
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
            Strategy group cash flow in view: <span className="font-semibold text-slate-100">{formatSignedUsd(aggregateCashFlow)}</span>. Classifications are read-only in v1.
          </div>

          <DrillDownTrades trades={data.trades} />
        </>
      )}
    </div>
  );
}
