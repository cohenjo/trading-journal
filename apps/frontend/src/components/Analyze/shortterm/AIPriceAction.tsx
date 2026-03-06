"use client";

import type { PriceActionSummary } from "./hooks/useSynthesis";

interface AIPriceActionProps {
  summary: PriceActionSummary;
}

function getQualityColor(quality: string): string {
  switch (quality) {
    case "High": return "text-green-400";
    case "Moderate": return "text-yellow-400";
    case "Low": return "text-red-400";
    default: return "text-slate-400";
  }
}

function getQualityBg(quality: string): string {
  switch (quality) {
    case "High": return "bg-green-900/30 border-green-800";
    case "Moderate": return "bg-yellow-900/30 border-yellow-800";
    case "Low": return "bg-red-900/30 border-red-800";
    default: return "bg-slate-800 border-slate-700";
  }
}

function getQualityIcon(quality: string): string {
  switch (quality) {
    case "High": return "🟢";
    case "Moderate": return "🟡";
    case "Low": return "🔴";
    default: return "⚪";
  }
}

export default function AIPriceAction({ summary }: AIPriceActionProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <h3 className="text-sm font-semibold text-amber-400 mb-4">🤖 AI Price Action</h3>
      <div className="space-y-4">
        <div>
          <span className="text-xs text-slate-500 uppercase tracking-wider">Current Support</span>
          <p className="text-2xl font-bold text-white mt-1">
            ${summary.current_support.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <span className="text-xs text-slate-500 uppercase tracking-wider">Setup Quality</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-lg">{getQualityIcon(summary.setup_quality)}</span>
            <span className={`text-2xl font-bold ${getQualityColor(summary.setup_quality)}`}>
              {summary.setup_quality}
            </span>
          </div>
          <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded border ${getQualityBg(summary.setup_quality)} ${getQualityColor(summary.setup_quality)}`}>
            {summary.setup_quality === "High"
              ? "Favorable for CSP entry"
              : summary.setup_quality === "Moderate"
              ? "Wait for better setup"
              : "Avoid — high risk"}
          </span>
        </div>
      </div>
    </div>
  );
}
