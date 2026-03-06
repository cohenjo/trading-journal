"use client";

import React from "react";
import type { Financials } from "./hooks/useCompanyFundamentals";

interface ValuationBenchmarksProps {
  financials: Financials | null;
  loading: boolean;
}

interface BenchmarkCardProps {
  label: string;
  value: string;
  color: string;
  rating: string;
}

function colorForPE(val: number | null): { color: string; rating: string } {
  if (val === null) return { color: "text-slate-400", rating: "" };
  if (val < 15) return { color: "text-green-400", rating: "Cheap" };
  if (val <= 25) return { color: "text-yellow-400", rating: "Fair" };
  return { color: "text-red-400", rating: "Expensive" };
}

function colorForPEG(val: number | null): { color: string; rating: string } {
  if (val === null) return { color: "text-slate-400", rating: "" };
  if (val < 1) return { color: "text-green-400", rating: "Cheap" };
  if (val <= 2) return { color: "text-yellow-400", rating: "Fair" };
  return { color: "text-red-400", rating: "Expensive" };
}

function colorForEVFCF(val: number | null): { color: string; rating: string } {
  if (val === null) return { color: "text-slate-400", rating: "" };
  if (val < 20) return { color: "text-green-400", rating: "Cheap" };
  if (val <= 35) return { color: "text-yellow-400", rating: "Fair" };
  return { color: "text-red-400", rating: "Expensive" };
}

function BenchmarkCard({ label, value, color, rating }: BenchmarkCardProps) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4">
      <p className="text-sm text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {rating && (
        <span className={`text-xs font-medium mt-1 inline-block px-2 py-0.5 rounded ${color} bg-slate-700/50`}>
          {rating}
        </span>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4 animate-pulse">
      <div className="h-4 w-20 bg-slate-700 rounded mb-2" />
      <div className="h-8 w-14 bg-slate-700 rounded" />
    </div>
  );
}

export default function ValuationBenchmarks({ financials, loading }: ValuationBenchmarksProps) {
  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Valuation Benchmarks</h3>
        <div className="grid grid-cols-1 gap-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (!financials) return null;

  const pe = colorForPE(financials.forward_pe);
  const peg = colorForPEG(financials.peg_ratio);
  const evfcf = colorForEVFCF(financials.ev_fcf);

  const fmt = (v: number | null, suffix: string = "x"): string =>
    v !== null ? `${v.toFixed(1)}${suffix}` : "N/A";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Valuation Benchmarks</h3>
      <div className="grid grid-cols-1 gap-3">
        <BenchmarkCard label="Forward P/E" value={fmt(financials.forward_pe)} color={pe.color} rating={pe.rating} />
        <BenchmarkCard label="PEG Ratio" value={fmt(financials.peg_ratio)} color={peg.color} rating={peg.rating} />
        <BenchmarkCard label="EV / FCF" value={fmt(financials.ev_fcf)} color={evfcf.color} rating={evfcf.rating} />
      </div>
    </div>
  );
}
