"use client";

import { useState, useMemo } from "react";
import type { PutOption } from "./hooks/useOptionChain";

interface BreakevenVisualizerProps {
  currentPrice: number;
  puts: PutOption[];
}

export default function BreakevenVisualizer({ currentPrice, puts }: BreakevenVisualizerProps) {
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [manualStrike, setManualStrike] = useState("");

  const activeStrike = selectedStrike ?? (manualStrike ? parseFloat(manualStrike) : null);

  const selectedPut = useMemo(() => {
    if (!activeStrike) return null;
    return puts.find((p) => p.strike === activeStrike) ?? null;
  }, [activeStrike, puts]);

  const premium = selectedPut ? ((selectedPut.bid ?? 0) + (selectedPut.ask ?? 0)) / 2 : 0;
  const breakeven = activeStrike ? activeStrike - premium : 0;
  const maxProfit = premium * 100;
  const maxRisk = activeStrike ? (activeStrike - premium) * 100 : 0;
  const returnOnCapital = activeStrike && activeStrike > 0 ? (premium / activeStrike) * 100 : 0;

  // Visual bar calculation
  const allValues = activeStrike
    ? [currentPrice, activeStrike, breakeven, activeStrike * 0.9]
    : [currentPrice];
  const barMin = Math.min(...allValues) * 0.95;
  const barMax = Math.max(...allValues) * 1.05;
  const barRange = barMax - barMin || 1;

  const toPercent = (val: number) => ((val - barMin) / barRange) * 100;

  // Near-the-money strikes for quick selection
  const nearStrikes = puts
    .filter((p) => Math.abs(p.strike - currentPrice) <= currentPrice * 0.10)
    .sort((a, b) => b.strike - a.strike);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <h3 className="text-sm font-semibold text-amber-400 mb-4">💰 CSP Breakeven Visualizer</h3>

      {/* Strike selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex-1 min-w-[140px]">
          <label className="text-xs text-slate-500 block mb-1">Select Strike</label>
          <select
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            value={selectedStrike ?? ""}
            onChange={(e) => {
              setSelectedStrike(e.target.value ? parseFloat(e.target.value) : null);
              setManualStrike("");
            }}
          >
            <option value="">Choose a strike</option>
            {nearStrikes.map((p) => (
              <option key={p.strike} value={p.strike}>
                ${p.strike.toFixed(0)} — bid ${p.bid?.toFixed(2) ?? '–'}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <label className="text-xs text-slate-500 block mb-1">Manual</label>
          <input
            type="number"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            placeholder="$"
            value={manualStrike}
            onChange={(e) => {
              setManualStrike(e.target.value);
              setSelectedStrike(null);
            }}
          />
        </div>
      </div>

      {activeStrike ? (
        <>
          {/* Visual bar */}
          <div className="relative h-10 bg-slate-800 rounded-lg overflow-hidden mb-4">
            {/* Loss zone (below breakeven) */}
            <div
              className="absolute top-0 bottom-0 bg-red-900/40"
              style={{ left: "0%", width: `${toPercent(breakeven)}%` }}
            />
            {/* At-risk zone (breakeven to strike) */}
            <div
              className="absolute top-0 bottom-0 bg-yellow-900/30"
              style={{ left: `${toPercent(breakeven)}%`, width: `${toPercent(activeStrike) - toPercent(breakeven)}%` }}
            />
            {/* Profit zone (above strike) */}
            <div
              className="absolute top-0 bottom-0 bg-green-900/30"
              style={{ left: `${toPercent(activeStrike)}%`, right: "0%" }}
            />

            {/* Breakeven marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500"
              style={{ left: `${toPercent(breakeven)}%` }}
            >
              <div className="absolute -top-5 -translate-x-1/2 text-[10px] text-red-400 whitespace-nowrap">
                BE ${breakeven.toFixed(0)}
              </div>
            </div>

            {/* Strike marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-500"
              style={{ left: `${toPercent(activeStrike)}%` }}
            >
              <div className="absolute -bottom-5 -translate-x-1/2 text-[10px] text-amber-400 whitespace-nowrap">
                Strike ${activeStrike.toFixed(0)}
              </div>
            </div>

            {/* Current price marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white"
              style={{ left: `${toPercent(currentPrice)}%` }}
            >
              <div className="absolute -top-5 -translate-x-1/2 text-[10px] text-white whitespace-nowrap">
                Spot ${currentPrice.toFixed(0)}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex gap-3 text-[10px] text-slate-500 mb-4">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Loss</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" /> At Risk</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Profit</span>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <span className="text-xs text-slate-500">Premium (mid)</span>
              <p className="text-lg font-bold text-green-400">${premium.toFixed(2)}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <span className="text-xs text-slate-500">Max Profit</span>
              <p className="text-lg font-bold text-green-400">${maxProfit.toFixed(0)}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <span className="text-xs text-slate-500">Max Risk (assigned)</span>
              <p className="text-lg font-bold text-red-400">${maxRisk.toFixed(0)}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <span className="text-xs text-slate-500">Return on Capital</span>
              <p className="text-lg font-bold text-amber-400">{returnOnCapital.toFixed(2)}%</p>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center min-h-[120px] border border-dashed border-slate-700 rounded-lg">
          <span className="text-slate-600 text-sm">Select a put strike to visualize breakeven</span>
        </div>
      )}
    </div>
  );
}
