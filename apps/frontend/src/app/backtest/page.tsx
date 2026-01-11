"use client";

import { useEffect, useState } from "react";
import { BacktestChart } from "@/components/Backtest/BacktestChart";

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

export default function BacktestPage() {
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(2024);
  const [stepDays, setStepDays] = useState<number>(1);
  const [underlying, setUnderlying] = useState<string>("NDX");
  const [leapUnderlying, setLeapUnderlying] = useState<string>("NDX");
  const [strategy, setStrategy] = useState<string>("IRON_CONDOR");
  const [loading, setLoading] = useState(false);
  const [showRealizedOnly, setShowRealizedOnly] = useState(false);
  const [results, setResults] = useState<BacktestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/backtest/years")
      .then((res) => res.json())
      .then((data) => {
        setYears(data);
        if (data.length > 0 && !data.includes(selectedYear)) {
          setSelectedYear(data[data.length - 1]);
        }
      })
      .catch((err) => console.error("Failed to fetch years", err));
  }, []);

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            year: selectedYear, 
            initial_capital: 100000,
            step_days: stepDays,
            underlying: underlying,
            leap_underlying: leapUnderlying,
            strategy: strategy
        }),
      });
      
      if (!res.ok) {
        throw new Error("Backtest failed");
      }
      
      const data = await res.json();
      setResults(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Prepare Chart Data
  const chartData = results?.trades
    .map((t) => ({
      time: t.date.split("T")[0], // YYYY-MM-DD
      value: showRealizedOnly ? -(t.realized_pnl || 0) : t.equity,
    }))
    .sort((a, b) => (a.time > b.time ? 1 : -1)) || [];
  
  // Add initial point
  if (results && chartData.length > 0) {
      const firstDate = new Date(chartData[0].time);
      firstDate.setDate(firstDate.getDate() - 1);
      const initialPoint = {
          time: firstDate.toISOString().split("T")[0],
          value: showRealizedOnly ? 0 : results.initial_capital
      };
      // Only add if not already present (or earlier)
      if (initialPoint.time < chartData[0].time) {
          chartData.unshift(initialPoint);
      }
  }

  // Deduplicate by time (keep last value for the day)
  const uniqueChartData = [];
  if (chartData.length > 0) {
      let current = chartData[0];
      for (let i = 1; i < chartData.length; i++) {
          if (chartData[i].time === current.time) {
              current = chartData[i]; // Update to latest value for this day
          } else {
              uniqueChartData.push(current);
              current = chartData[i];
          }
      }
      uniqueChartData.push(current);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Strategy Backtest</h1>

      {/* Controls */}
      <div className="flex items-center gap-4 mb-8 bg-slate-900 p-4 rounded-lg border border-slate-800">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Select Year</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Step (Days)</label>
          <select
            value={stepDays}
            onChange={(e) => setStepDays(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={1}>1 Day (Daily PnL)</option>
            <option value={7}>7 Days (Weekly)</option>
            <option value={14}>14 Days (Bi-Weekly)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Strategy Underlying</label>
          <select
            value={underlying}
            onChange={(e) => setUnderlying(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="NDX">NDX</option>
            <option value="SPX">SPX</option>
            <option value="QQQ">QQQ</option>
            <option value="SPY">SPY</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">LEAP Underlying</label>
          <select
            value={leapUnderlying}
            onChange={(e) => setLeapUnderlying(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="NDX">NDX</option>
            <option value="SPX">SPX</option>
            <option value="QQQ">QQQ</option>
            <option value="SPY">SPY</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="IRON_CONDOR">Iron Condor</option>
          </select>
        </div>

        <button
          onClick={runBacktest}
          disabled={loading}
          className={`mt-auto px-6 py-2 rounded font-medium transition-colors ${
            loading
              ? "bg-slate-700 text-slate-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500 text-white"
          }`}
        >
          {loading ? "Running Simulation..." : "Run Backtest"}
        </button>
        
        {loading && (
            <div className="text-sm text-slate-400 animate-pulse">
                Verifying data & simulating...
            </div>
        )}
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-800 text-red-200 p-4 rounded mb-6">
          Error: {error}
        </div>
      )}

      {results && (
        <div className="space-y-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900 p-4 rounded border border-slate-800">
              <div className="text-slate-400 text-sm mb-1">Final Equity</div>
              <div className={`text-2xl font-bold ${results.final_equity >= results.initial_capital ? 'text-green-400' : 'text-red-400'}`}>
                ${results.final_equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Return: {((results.final_equity - results.initial_capital) / results.initial_capital * 100).toFixed(2)}%
              </div>
            </div>
            
            <div className="bg-slate-900 p-4 rounded border border-slate-800">
              <div className="text-slate-400 text-sm mb-1">Realized PnL</div>
              <div className={`text-2xl font-bold ${results.realized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${results.realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            
            <div className="bg-slate-900 p-4 rounded border border-slate-800">
              <div className="text-slate-400 text-sm mb-1">Unrealized PnL</div>
              <div className={`text-2xl font-bold ${results.unrealized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${results.unrealized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          {results.metrics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                    <div className="text-slate-500 text-xs uppercase">Sharpe Ratio</div>
                    <div className="text-lg font-mono">{results.metrics.sharpe_ratio.toFixed(2)}</div>
                </div>
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                    <div className="text-slate-500 text-xs uppercase">Max Drawdown</div>
                    <div className="text-lg font-mono text-red-400">{(results.metrics.max_drawdown * 100).toFixed(2)}%</div>
                </div>
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                    <div className="text-slate-500 text-xs uppercase">Volatility</div>
                    <div className="text-lg font-mono">{(results.metrics.volatility * 100).toFixed(2)}%</div>
                </div>
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                    <div className="text-slate-500 text-xs uppercase">Win Rate</div>
                    <div className="text-lg font-mono">{(results.metrics.win_rate * 100).toFixed(1)}%</div>
                </div>
            </div>
          )}

          {/* Chart */}
          <div className="bg-slate-900 p-4 rounded border border-slate-800">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">
                    {showRealizedOnly ? "Accumulated Harvested Loss" : "Equity Curve"}
                </h3>
                <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
                    <button
                        onClick={() => setShowRealizedOnly(false)}
                        className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                            !showRealizedOnly 
                            ? 'bg-blue-600 text-white shadow-sm' 
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        Total Equity
                    </button>
                    <button
                        onClick={() => setShowRealizedOnly(true)}
                        className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                            showRealizedOnly 
                            ? 'bg-blue-600 text-white shadow-sm' 
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        Harvested Loss
                    </button>
                </div>
            </div>
            <BacktestChart data={uniqueChartData} />
          </div>

          {/* Trade Log */}
          <div className="bg-slate-900 rounded border border-slate-800 overflow-hidden">
            <h3 className="text-lg font-medium p-4 border-b border-slate-800">Trade Log</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-950 text-slate-400 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Symbol</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3 text-right">Comm</th>
                    <th className="px-4 py-3 text-right">Equity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {results.trades.map((t, i) => (
                    <tr key={i} className="hover:bg-slate-800/50">
                      <td className="px-4 py-3">{new Date(t.date).toLocaleDateString()}</td>
                      <td className={`px-4 py-3 font-medium ${t.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                        {t.action}
                      </td>
                      <td className="px-4 py-3">{t.symbol}</td>
                      <td className="px-4 py-3 text-right">{t.quantity}</td>
                      <td className="px-4 py-3 text-right">${t.price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">${t.commission.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono">${t.equity.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
