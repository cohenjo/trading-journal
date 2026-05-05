"use client";

import { useCallback, useEffect, useState } from "react";
import Decimal from "decimal.js";
import { getDashboardSnapshot, type DashboardSnapshot } from "@/app/dashboard/actions";
import { getLatestMonthSummary, getMonthSummary, type DailySummary } from "@/app/summary/actions";
import DashboardFreshnessBadge from "./DashboardFreshnessBadge";
import RefreshNowButton from "./RefreshNowButton";
import TradesList from "./TradesList";
import AddTradeForm from "./AddTradeForm";
import PnLCurve from "./PnLCurve";
import CalendarView from "./Calendar";

export default function Dashboard() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [pnlData, setPnlData] = useState<{ time: string; value: number }[]>([]);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);

  // Load cooked snapshot (freshness state + daily performance)
  const loadSnapshot = useCallback(async () => {
    try {
      const data = await getDashboardSnapshot();
      setSnapshot(data);

      // If cooked daily_performance has rows, prefer them for the PnL curve
      if (data.dailyPerformance.length > 0) {
        const sorted = [...data.dailyPerformance].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
        let cumulative = new Decimal(0);
        const chartData = sorted.map((row) => {
          cumulative = cumulative.plus(new Decimal(row.totalPnl));
          return { time: row.date, value: cumulative.toDecimalPlaces(2).toNumber() };
        });
        setPnlData(chartData);
      }
    } catch (err) {
      console.error("Failed to load dashboard snapshot:", err);
    }
  }, []);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  // Fallback: if cooked data is empty, initialize date from legacy dailysummary
  useEffect(() => {
    if (snapshot === null) return; // wait for snapshot first
    if (snapshot.dailyPerformance.length > 0) return; // cooked data available

    const initLegacyDate = async () => {
      try {
        const latest = await getLatestMonthSummary();
        if (!latest) return;
        setCurrentDate(new Date(latest.year, latest.month - 1, 1));
      } catch (error) {
        console.error("Failed to fetch latest summary month:", error);
      }
    };
    void initLegacyDate();
  }, [snapshot]);

  // Fallback: load legacy PnL data when cooked tables are empty
  useEffect(() => {
    if (snapshot === null) return;
    if (snapshot.dailyPerformance.length > 0) return; // cooked data already loaded

    const fetchLegacyData = async () => {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      try {
        const summaries: DailySummary[] = await getMonthSummary(year, month);
        summaries.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );

        let cumulativePnl = 0;
        const chartData = summaries.map((summary) => {
          cumulativePnl += summary.total_pnl;
          return { time: summary.date, value: cumulativePnl };
        });

        const monthStartDate = new Date(year, month - 1, 1);
        const dayBeforeMonth = new Date(monthStartDate);
        dayBeforeMonth.setDate(dayBeforeMonth.getDate() - 1);

        setPnlData([
          { time: dayBeforeMonth.toISOString().split("T")[0], value: 0 },
          ...chartData,
        ]);
      } catch (error) {
        console.error("Failed to fetch PnL data:", error);
        const firstDayOfMonth = new Date(year, currentDate.getMonth(), 1)
          .toISOString()
          .split("T")[0];
        setPnlData([{ time: firstDayOfMonth, value: 0 }]);
      }
    };

    void fetchLegacyData();
  }, [currentDate, snapshot]);

  return (
    <div>
      {/* Header row with freshness badge and refresh trigger */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex items-center gap-3">
          {snapshot && (
            <DashboardFreshnessBadge
              freshnessStatus={snapshot.freshnessStatus}
              refreshState={snapshot.refreshState}
              stalenessSeconds={snapshot.stalenessSeconds}
            />
          )}
          <RefreshNowButton onRefreshTriggered={loadSnapshot} />
        </div>
      </div>

      {/* First-run empty state */}
      {snapshot?.isFirstRun && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6 mb-4 text-center text-sm text-slate-400">
          <p className="font-medium text-slate-200 mb-1">
            Crunching your data — first refresh in progress
          </p>
          <p>
            Your trading data is being processed. This usually takes less than a minute.
            Hit <strong>Refresh Now</strong> above to enqueue a run.
          </p>
        </div>
      )}

      {/* Dashboard summary KPIs (from cooked.dashboard_summary) */}
      {snapshot?.dashboardSummary && (
        <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
          <div className="rounded-md bg-slate-800 border border-slate-700 p-3">
            <span className="text-slate-400 block text-xs mb-1">Net Worth</span>
            <span className="font-mono text-slate-100 text-lg">
              {snapshot.dashboardSummary.currency}{" "}
              {new Decimal(snapshot.dashboardSummary.netWorth).toFixed(2)}
            </span>
          </div>
          <div className="rounded-md bg-slate-800 border border-slate-700 p-3">
            <span className="text-slate-400 block text-xs mb-1">Daily P&amp;L</span>
            <span
              className={`font-mono text-lg ${
                new Decimal(snapshot.dashboardSummary.dailyPnl).gte(0)
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {new Decimal(snapshot.dashboardSummary.dailyPnl).toFixed(2)}
            </span>
          </div>
          <div className="rounded-md bg-slate-800 border border-slate-700 p-3">
            <span className="text-slate-400 block text-xs mb-1">YTD P&amp;L</span>
            <span
              className={`font-mono text-lg ${
                new Decimal(snapshot.dashboardSummary.ytdPnl).gte(0)
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {new Decimal(snapshot.dashboardSummary.ytdPnl).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      <PnLCurve data={pnlData} />
      <CalendarView date={currentDate} onDateChange={setCurrentDate} />
      <AddTradeForm />
      <TradesList />
    </div>
  );
}
