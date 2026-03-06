"use client";

import React from "react";
import type { Financials } from "./hooks/useCompanyFundamentals";

interface FinancialScorecardProps {
  financials: Financials | null;
  loading: boolean;
}

interface MetricCardProps {
  label: string;
  value: string;
  color: string;
  sublabel?: string;
}

function MetricCard({ label, value, color, sublabel }: MetricCardProps) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4">
      <p className="text-sm text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sublabel && <p className="text-xs text-slate-500 mt-1">{sublabel}</p>}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4 animate-pulse">
      <div className="h-4 w-24 bg-slate-700 rounded mb-2" />
      <div className="h-8 w-16 bg-slate-700 rounded" />
    </div>
  );
}

function fmt(val: number | null, suffix: string = ""): string {
  if (val === null || val === undefined) return "N/A";
  return `${val.toFixed(1)}${suffix}`;
}

export default function FinancialScorecard({ financials, loading }: FinancialScorecardProps) {
  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Financial Scorecard</h3>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (!financials) return null;

  const { roic, wacc, revenue_cagr_5y, fcf_cagr_5y, net_debt_ebitda } = financials;

  const roicSpread = roic !== null && wacc !== null ? roic - wacc : null;
  const roicColor = roicSpread !== null
    ? roicSpread > 0 ? "text-green-400" : "text-red-400"
    : "text-slate-400";

  const debtColor = net_debt_ebitda !== null
    ? net_debt_ebitda > 3 ? "text-red-400" : net_debt_ebitda > 2 ? "text-yellow-400" : "text-green-400"
    : "text-slate-400";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Financial Scorecard</h3>
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="ROIC vs WACC"
          value={roicSpread !== null ? `${roicSpread > 0 ? "+" : ""}${fmt(roicSpread, "pp")}` : "N/A"}
          color={roicColor}
          sublabel={roic !== null && wacc !== null ? `${fmt(roic, "%")} ROIC / ${fmt(wacc, "%")} WACC` : undefined}
        />
        <MetricCard
          label="5Y Revenue CAGR"
          value={fmt(revenue_cagr_5y, "%")}
          color={revenue_cagr_5y !== null && revenue_cagr_5y > 10 ? "text-green-400" : "text-slate-200"}
        />
        <MetricCard
          label="5Y FCF CAGR"
          value={fmt(fcf_cagr_5y, "%")}
          color={fcf_cagr_5y !== null && fcf_cagr_5y > 10 ? "text-green-400" : "text-slate-200"}
        />
        <MetricCard
          label="Net Debt / EBITDA"
          value={net_debt_ebitda !== null ? `${net_debt_ebitda.toFixed(1)}x` : "N/A"}
          color={debtColor}
          sublabel={net_debt_ebitda !== null && net_debt_ebitda > 3 ? "⚠ High leverage" : undefined}
        />
      </div>
    </div>
  );
}
