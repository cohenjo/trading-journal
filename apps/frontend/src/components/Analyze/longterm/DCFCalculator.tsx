"use client";

import React, { useState, useMemo } from "react";
import type { DcfInputs } from "./hooks/useCompanyFundamentals";

interface DCFCalculatorProps {
  dcfInputs: DcfInputs | null;
  currentPrice: number;
  loading: boolean;
}

function calculateDCF(
  currentFcf: number,
  growthRate: number,
  discountRate: number,
  terminalGrowth: number,
  projectionYears: number,
  sharesOutstanding: number
): { fairValue: number; marginOfSafety: number; currentPrice: number } & { fairValue: number } {
  let sumPV = 0;
  let lastFcf = currentFcf;

  for (let year = 1; year <= projectionYears; year++) {
    const projectedFcf = currentFcf * Math.pow(1 + growthRate, year);
    const pv = projectedFcf / Math.pow(1 + discountRate, year);
    sumPV += pv;
    lastFcf = projectedFcf;
  }

  // Terminal value using Gordon Growth Model
  const terminalValue = lastFcf * (1 + terminalGrowth) / (discountRate - terminalGrowth);
  const pvTerminal = terminalValue / Math.pow(1 + discountRate, projectionYears);

  const enterpriseValue = sumPV + pvTerminal;
  const fairValue = sharesOutstanding > 0 ? enterpriseValue / sharesOutstanding : 0;

  return { fairValue, marginOfSafety: 0, currentPrice: 0 };
}

export default function DCFCalculator({ dcfInputs, currentPrice, loading }: DCFCalculatorProps) {
  const [growthRate, setGrowthRate] = useState<number | null>(null);
  const [discountRate, setDiscountRate] = useState<number | null>(null);

  // Use API defaults when inputs load, allow user overrides
  const effectiveGrowth = growthRate ?? (dcfInputs?.growth_rate_default ?? 0.1);
  const effectiveDiscount = discountRate ?? (dcfInputs?.discount_rate_default ?? 0.1);

  const result = useMemo(() => {
    if (!dcfInputs) return null;
    const dcf = calculateDCF(
      dcfInputs.current_fcf,
      effectiveGrowth,
      effectiveDiscount,
      dcfInputs.terminal_growth,
      dcfInputs.projection_years,
      dcfInputs.shares_outstanding
    );
    const marginOfSafety = dcf.fairValue > 0
      ? ((dcf.fairValue - currentPrice) / dcf.fairValue) * 100
      : 0;
    return { fairValue: dcf.fairValue, marginOfSafety };
  }, [dcfInputs, effectiveGrowth, effectiveDiscount, currentPrice]);

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">DCF Calculator</h3>
        <div className="space-y-4 animate-pulse">
          <div className="h-6 w-40 bg-slate-700 rounded" />
          <div className="h-6 w-40 bg-slate-700 rounded" />
          <div className="h-12 w-32 bg-slate-700 rounded" />
        </div>
      </div>
    );
  }

  if (!dcfInputs || !result) return null;

  const mosColor = result.marginOfSafety > 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4">DCF What-If Calculator</h3>

      <div className="space-y-5">
        {/* Growth Rate Slider */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-400">Growth Rate</span>
            <span className="text-white font-medium">{(effectiveGrowth * 100).toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={0.3}
            step={0.005}
            value={effectiveGrowth}
            onChange={(e) => setGrowthRate(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-slate-600 mt-0.5">
            <span>0%</span>
            <span>30%</span>
          </div>
        </div>

        {/* Discount Rate Slider */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-400">Discount Rate</span>
            <span className="text-white font-medium">{(effectiveDiscount * 100).toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min={0.05}
            max={0.2}
            step={0.005}
            value={effectiveDiscount}
            onChange={(e) => setDiscountRate(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-slate-600 mt-0.5">
            <span>5%</span>
            <span>20%</span>
          </div>
        </div>

        {/* Results */}
        <div className="border-t border-slate-800 pt-4 space-y-3">
          <div>
            <p className="text-sm text-slate-400 mb-1">Fair Value Per Share</p>
            <p className="text-3xl font-bold text-white">
              ${result.fairValue.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-400 mb-1">Margin of Safety</p>
            <p className={`text-2xl font-bold ${mosColor}`}>
              {result.marginOfSafety > 0 ? "+" : ""}{result.marginOfSafety.toFixed(1)}%
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Current: ${currentPrice.toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
