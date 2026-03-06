"use client";

import type { TechnicalsData } from "./hooks/useTechnicals";

interface MomentumPanelProps {
  technicals: TechnicalsData;
}

function getRsiColor(rsi: number): string {
  if (rsi < 30) return "text-green-400";
  if (rsi > 70) return "text-red-400";
  return "text-yellow-400";
}

function getRsiLabel(rsi: number): string {
  if (rsi < 30) return "Oversold ✓";
  if (rsi > 70) return "Overbought";
  return "Neutral";
}

function getRsiBg(rsi: number): string {
  if (rsi < 30) return "bg-green-900/30 border-green-800";
  if (rsi > 70) return "bg-red-900/30 border-red-800";
  return "bg-yellow-900/30 border-yellow-800";
}

function getMacdSignal(macd: number, signal: number): { label: string; color: string; bg: string } {
  if (macd > signal) return { label: "Bullish Crossover", color: "text-green-400", bg: "bg-green-900/30 border-green-800" };
  if (macd < signal) return { label: "Bearish Crossover", color: "text-red-400", bg: "bg-red-900/30 border-red-800" };
  return { label: "Neutral", color: "text-slate-400", bg: "bg-slate-800 border-slate-700" };
}

export default function MomentumPanel({ technicals }: MomentumPanelProps) {
  const rsi_14 = technicals.indicators?.rsi_14 ?? 50;
  const macd = technicals.indicators?.macd ?? { macd_line: 0, signal_line: 0, histogram: 0 };
  const macdSignal = getMacdSignal(macd.macd_line ?? 0, macd.signal_line ?? 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* RSI Card */}
      <div className={`bg-slate-900 border border-slate-800 rounded-xl p-6`}>
        <h3 className="text-sm font-semibold text-amber-400 mb-4">📊 RSI (14)</h3>
        <div className="flex items-baseline gap-3 mb-2">
          <span className={`text-3xl font-bold ${getRsiColor(rsi_14)}`}>
            {rsi_14.toFixed(1)}
          </span>
          <span className={`text-sm font-medium px-2 py-0.5 rounded border ${getRsiBg(rsi_14)} ${getRsiColor(rsi_14)}`}>
            {getRsiLabel(rsi_14)}
          </span>
        </div>
        <div className="mt-4 w-full bg-slate-800 rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all ${
              rsi_14 < 30 ? "bg-green-500" : rsi_14 > 70 ? "bg-red-500" : "bg-yellow-500"
            }`}
            style={{ width: `${Math.min(100, rsi_14)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-600 mt-1">
          <span>0 — Oversold</span>
          <span>70 — Overbought</span>
          <span>100</span>
        </div>
      </div>

      {/* MACD Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-amber-400 mb-4">📉 MACD</h3>
        <div className="flex items-baseline gap-3 mb-3">
          <span className={`text-sm font-medium px-2 py-0.5 rounded border ${macdSignal.bg} ${macdSignal.color}`}>
            {macdSignal.label}
          </span>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">MACD Line</span>
            <span className="text-white font-mono">{(macd.macd_line ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Signal Line</span>
            <span className="text-white font-mono">{(macd.signal_line ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Histogram</span>
            <span className={`font-mono ${(macd.histogram ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
              {(macd.histogram ?? 0).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
