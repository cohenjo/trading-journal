"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BacktestChart } from "@/components/Backtest/BacktestChart";
import { subscribeToComputeJob, type ComputeJob } from "@/lib/compute-job-subscriptions";
import { enqueueBacktest, getBacktestRun, type BacktestConfig } from "./actions";

interface Trade {
  date: string;
  action: string;
  symbol: string;
  quantity: number;
  price: number;
  commission: number;
  equity: number;
  conid: number;
  realized_pnl?: number;
}

interface Metrics {
  total_return: number;
  cagr: number;
  volatility: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
}

interface BacktestResponse {
  year: number;
  initial_capital: number;
  final_equity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  trades: Trade[];
  metrics?: Metrics;
}

interface ChartPoint {
  time: string;
  value: number;
}

type BacktestViewState =
  | { status: "idle" }
  | { status: "running"; jobId: string | null; message: string }
  | { status: "done"; result: BacktestResponse }
  | { status: "failed"; error: string };

interface BacktestJobResult {
  backtest_run_id: string;
}

function yearsSince2018(): number[] {
  const currentYear = new Date().getUTCFullYear();
  return Array.from({ length: currentYear - 2018 + 1 }, (_, index) => 2018 + index);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeTrade(value: unknown): Trade | null {
  if (!isRecord(value)) return null;
  const date = toStringValue(value.date);
  if (!date) return null;
  return {
    date,
    action: toStringValue(value.action, "UNKNOWN"),
    symbol: toStringValue(value.symbol, "UNK"),
    quantity: toNumber(value.quantity),
    price: toNumber(value.price),
    commission: toNumber(value.commission),
    equity: toNumber(value.equity),
    conid: Math.trunc(toNumber(value.conid)),
    realized_pnl: value.realized_pnl == null ? undefined : toNumber(value.realized_pnl),
  };
}

function normalizeMetrics(value: unknown): Metrics | undefined {
  if (!isRecord(value)) return undefined;
  return {
    total_return: toNumber(value.total_return),
    cagr: toNumber(value.cagr),
    volatility: toNumber(value.volatility),
    sharpe_ratio: toNumber(value.sharpe_ratio),
    max_drawdown: toNumber(value.max_drawdown),
    win_rate: toNumber(value.win_rate),
  };
}

function normalizeBacktestResult(value: unknown): BacktestResponse {
  if (!isRecord(value)) throw new Error("Backtest run did not include a result payload.");
  const trades = Array.isArray(value.trades)
    ? value.trades.map(normalizeTrade).filter((trade): trade is Trade => trade !== null)
    : [];
  return {
    year: Math.trunc(toNumber(value.year)),
    initial_capital: toNumber(value.initial_capital),
    final_equity: toNumber(value.final_equity),
    realized_pnl: toNumber(value.realized_pnl),
    unrealized_pnl: toNumber(value.unrealized_pnl),
    trades,
    metrics: normalizeMetrics(value.metrics),
  };
}

function isBacktestJobResult(value: unknown): value is BacktestJobResult {
  return isRecord(value) && typeof value.backtest_run_id === "string" && value.backtest_run_id.length > 0;
}

function buildChartData(results: BacktestResponse | null, showRealizedOnly: boolean): ChartPoint[] {
  const chartData = (results?.trades ?? [])
    .map((trade) => ({
      time: trade.date.split("T")[0],
      value: showRealizedOnly ? -(trade.realized_pnl ?? 0) : trade.equity,
    }))
    .sort((a, b) => (a.time > b.time ? 1 : -1));

  if (results && chartData.length > 0) {
    const firstDate = new Date(`${chartData[0].time}T00:00:00Z`);
    firstDate.setUTCDate(firstDate.getUTCDate() - 1);
    const initialPoint: ChartPoint = {
      time: firstDate.toISOString().split("T")[0],
      value: showRealizedOnly ? 0 : results.initial_capital,
    };
    if (initialPoint.time < chartData[0].time) chartData.unshift(initialPoint);
  }

  const uniqueChartData: ChartPoint[] = [];
  for (const point of chartData) {
    const previous = uniqueChartData[uniqueChartData.length - 1];
    if (previous?.time === point.time) uniqueChartData[uniqueChartData.length - 1] = point;
    else uniqueChartData.push(point);
  }
  return uniqueChartData;
}

export default function BacktestPage() {
  const years = useMemo(yearsSince2018, []);
  const [selectedYear, setSelectedYear] = useState<number>(years[years.length - 1] ?? 2024);
  const [stepDays, setStepDays] = useState<number>(1);
  const [underlying, setUnderlying] = useState<string>("NDX");
  const [leapUnderlying, setLeapUnderlying] = useState<string>("NDX");
  const [strategy, setStrategy] = useState<string>("IRON_CONDOR");
  const [showRealizedOnly, setShowRealizedOnly] = useState(false);
  const [viewState, setViewState] = useState<BacktestViewState>({ status: "idle" });
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const loading = viewState.status === "running";
  const results = viewState.status === "done" ? viewState.result : null;
  const error = viewState.status === "failed" ? viewState.error : null;
  const uniqueChartData = useMemo(() => buildChartData(results, showRealizedOnly), [results, showRealizedOnly]);

  const cleanupSubscription = () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  };

  const handleCompletedJob = async (job: ComputeJob) => {
    cleanupSubscription();
    if (!isBacktestJobResult(job.result)) {
      setViewState({ status: "failed", error: "Backtest job finished without a result row." });
      return;
    }
    try {
      const run = await getBacktestRun(job.result.backtest_run_id);
      if (!run?.result) throw new Error("Backtest result row was not found.");
      setViewState({ status: "done", result: normalizeBacktestResult(run.result) });
    } catch (err) {
      setViewState({ status: "failed", error: err instanceof Error ? err.message : "Failed to load backtest result." });
    }
  };

  const runBacktest = async () => {
    cleanupSubscription();
    setViewState({ status: "running", jobId: null, message: "Enqueuing backtest…" });
    try {
      const config: BacktestConfig = {
        year: selectedYear,
        initial_capital: "100000",
        step_days: stepDays,
        underlying,
        leap_underlying: leapUnderlying,
        strategy,
      };
      const jobId = await enqueueBacktest(config);
      setViewState({ status: "running", jobId, message: "Running…" });
      unsubscribeRef.current = subscribeToComputeJob(jobId, (job) => {
        if (job.status === "done") void handleCompletedJob(job);
        if (job.status === "failed") {
          cleanupSubscription();
          setViewState({ status: "failed", error: job.error ?? "Backtest failed." });
        }
      });
    } catch (err) {
      cleanupSubscription();
      setViewState({ status: "failed", error: err instanceof Error ? err.message : "An error occurred" });
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Strategy Backtest</h1>

      <div className="flex items-center gap-4 mb-8 bg-slate-900 p-4 rounded-lg border border-slate-800">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Select Year</label>
          <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Step (Days)</label>
          <select value={stepDays} onChange={(e) => setStepDays(Number(e.target.value))} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value={1}>1 Day (Daily PnL)</option><option value={7}>7 Days (Weekly)</option><option value={14}>14 Days (Bi-Weekly)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1"><label className="text-xs text-slate-400">Strategy Underlying</label><select value={underlying} onChange={(e) => setUnderlying(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="NDX">NDX</option><option value="SPX">SPX</option><option value="QQQ">QQQ</option><option value="SPY">SPY</option></select></div>
        <div className="flex flex-col gap-1"><label className="text-xs text-slate-400">LEAP Underlying</label><select value={leapUnderlying} onChange={(e) => setLeapUnderlying(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="NDX">NDX</option><option value="SPX">SPX</option><option value="QQQ">QQQ</option><option value="SPY">SPY</option></select></div>
        <div className="flex flex-col gap-1"><label className="text-xs text-slate-400">Strategy</label><select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="IRON_CONDOR">Iron Condor</option></select></div>
        <button onClick={runBacktest} disabled={loading} className={`mt-auto px-6 py-2 rounded font-medium transition-colors ${loading ? "bg-slate-700 text-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500 text-white"}`}>{loading ? "Running…" : "Run Backtest"}</button>
        {loading && <div className="text-sm text-slate-400 animate-pulse">{viewState.message}{viewState.jobId ? ` job ${viewState.jobId.slice(0, 8)}` : ""}</div>}
      </div>

      {error && <div className="bg-red-900/50 border border-red-800 text-red-200 p-4 rounded mb-6">Error: {error}</div>}

      {results && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900 p-4 rounded border border-slate-800"><div className="text-slate-400 text-sm mb-1">Final Equity</div><div className={`text-2xl font-bold ${results.final_equity >= results.initial_capital ? "text-green-400" : "text-red-400"}`}>${results.final_equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div><div className="text-xs text-slate-500 mt-1">Return: {(((results.final_equity - results.initial_capital) / results.initial_capital) * 100).toFixed(2)}%</div></div>
            <div className="bg-slate-900 p-4 rounded border border-slate-800"><div className="text-slate-400 text-sm mb-1">Realized PnL</div><div className={`text-2xl font-bold ${results.realized_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>${results.realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
            <div className="bg-slate-900 p-4 rounded border border-slate-800"><div className="text-slate-400 text-sm mb-1">Unrealized PnL</div><div className={`text-2xl font-bold ${results.unrealized_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>${results.unrealized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
          </div>
          {results.metrics && <div className="grid grid-cols-2 md:grid-cols-4 gap-4"><div className="bg-slate-900 p-3 rounded border border-slate-800"><div className="text-slate-500 text-xs uppercase">Sharpe Ratio</div><div className="text-lg font-mono">{results.metrics.sharpe_ratio.toFixed(2)}</div></div><div className="bg-slate-900 p-3 rounded border border-slate-800"><div className="text-slate-500 text-xs uppercase">Max Drawdown</div><div className="text-lg font-mono text-red-400">{(results.metrics.max_drawdown * 100).toFixed(2)}%</div></div><div className="bg-slate-900 p-3 rounded border border-slate-800"><div className="text-slate-500 text-xs uppercase">Volatility</div><div className="text-lg font-mono">{(results.metrics.volatility * 100).toFixed(2)}%</div></div><div className="bg-slate-900 p-3 rounded border border-slate-800"><div className="text-slate-500 text-xs uppercase">Win Rate</div><div className="text-lg font-mono">{(results.metrics.win_rate * 100).toFixed(1)}%</div></div></div>}
          <div className="bg-slate-900 p-4 rounded border border-slate-800"><div className="flex justify-between items-center mb-4"><h3 className="text-lg font-medium">{showRealizedOnly ? "Accumulated Harvested Loss" : "Equity Curve"}</h3><div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700"><button onClick={() => setShowRealizedOnly(false)} className={`px-3 py-1 text-xs font-medium rounded transition-colors ${!showRealizedOnly ? "bg-blue-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"}`}>Total Equity</button><button onClick={() => setShowRealizedOnly(true)} className={`px-3 py-1 text-xs font-medium rounded transition-colors ${showRealizedOnly ? "bg-blue-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"}`}>Harvested Loss</button></div></div><BacktestChart data={uniqueChartData} /></div>
          <div className="bg-slate-900 rounded border border-slate-800 overflow-hidden"><h3 className="text-lg font-medium p-4 border-b border-slate-800">Trade Log</h3><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-slate-950 text-slate-400 uppercase text-xs"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Symbol</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Comm</th><th className="px-4 py-3 text-right">Equity</th></tr></thead><tbody className="divide-y divide-slate-800">{results.trades.map((trade, index) => <tr key={`${trade.date}-${trade.conid}-${index}`} className="hover:bg-slate-800/50"><td className="px-4 py-3">{new Date(trade.date).toLocaleDateString()}</td><td className={`px-4 py-3 font-medium ${trade.action === "BUY" ? "text-green-400" : "text-red-400"}`}>{trade.action}</td><td className="px-4 py-3">{trade.symbol}</td><td className="px-4 py-3 text-right">{trade.quantity}</td><td className="px-4 py-3 text-right">${trade.price.toFixed(2)}</td><td className="px-4 py-3 text-right">${trade.commission.toFixed(2)}</td><td className="px-4 py-3 text-right font-mono">${trade.equity.toLocaleString()}</td></tr>)}</tbody></table></div></div>
        </div>
      )}
    </div>
  );
}
