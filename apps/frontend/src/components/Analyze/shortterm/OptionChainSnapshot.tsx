"use client";

import type { OptionChainData } from "./hooks/useOptionChain";

interface OptionChainSnapshotProps {
  data: OptionChainData;
  expiry: string | null;
  onExpiryChange: (expiry: string) => void;
}

export default function OptionChainSnapshot({ data, expiry, onExpiryChange }: OptionChainSnapshotProps) {
  const nearMoneyRange = data.current_price * 0.10;
  const nearMoneyPuts = data.puts.filter(
    (p) => Math.abs(p.strike - data.current_price) <= nearMoneyRange
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-amber-400">🔗 Option Chain — Puts</h3>
        <select
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
          value={expiry ?? ""}
          onChange={(e) => onExpiryChange(e.target.value)}
        >
          {data.expirations.map((exp) => (
            <option key={exp} value={exp}>{exp}</option>
          ))}
        </select>
      </div>

      {/* IV Metrics */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-800/50 rounded-lg p-3">
          <span className="text-xs text-slate-500 uppercase tracking-wider">IV Percentile</span>
          <p className={`text-2xl font-bold mt-1 ${(data.iv_percentile ?? 0) > 50 ? "text-green-400" : "text-slate-300"}`}>
            {data.iv_percentile != null ? data.iv_percentile.toFixed(0) + '%' : '–'}
          </p>
          {(data.iv_percentile ?? 0) > 50 && (
            <span className="text-xs text-green-500">Ideal for selling premium</span>
          )}
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <span className="text-xs text-slate-500 uppercase tracking-wider">IV Rank</span>
          <p className={`text-2xl font-bold mt-1 ${(data.iv_rank ?? 0) > 50 ? "text-green-400" : "text-slate-300"}`}>
            {data.iv_rank != null ? data.iv_rank.toFixed(0) + '%' : '–'}
          </p>
        </div>
      </div>

      {/* Spot price reference */}
      <div className="text-xs text-slate-500 mb-2">
        Spot: <span className="text-white font-mono">${data.current_price?.toFixed(2) ?? '–'}</span>
        {" · "}{nearMoneyPuts.length} strikes within ±10%
      </div>

      {/* Puts table */}
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-900">
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left py-2 pr-2">Strike</th>
              <th className="text-right py-2 px-2">Bid</th>
              <th className="text-right py-2 px-2">Ask</th>
              <th className="text-right py-2 px-2">IV</th>
              <th className="text-right py-2 px-2">Delta</th>
              <th className="text-right py-2 px-2">Vol</th>
              <th className="text-right py-2 pl-2">OI</th>
            </tr>
          </thead>
          <tbody>
            {nearMoneyPuts.map((put) => {
              const isNearSpot = Math.abs(put.strike - data.current_price) <= data.current_price * 0.02;
              return (
                <tr
                  key={put.strike}
                  className={`border-b border-slate-800/50 ${isNearSpot ? "bg-amber-900/20" : "hover:bg-slate-800/30"}`}
                >
                  <td className={`py-1.5 pr-2 font-mono ${isNearSpot ? "text-amber-400 font-semibold" : "text-white"}`}>
                    ${put.strike.toFixed(0)}
                  </td>
                  <td className="text-right py-1.5 px-2 text-green-400 font-mono">{put.bid?.toFixed(2) ?? '–'}</td>
                  <td className="text-right py-1.5 px-2 text-red-400 font-mono">{put.ask?.toFixed(2) ?? '–'}</td>
                  <td className="text-right py-1.5 px-2 text-slate-300 font-mono">{put.iv != null ? (put.iv * 100).toFixed(1) + '%' : '–'}</td>
                  <td className="text-right py-1.5 px-2 text-slate-300 font-mono">{put.delta?.toFixed(2) ?? '–'}</td>
                  <td className="text-right py-1.5 px-2 text-slate-400">{put.volume?.toLocaleString() ?? '–'}</td>
                  <td className="text-right py-1.5 pl-2 text-slate-400">{put.open_interest?.toLocaleString() ?? '–'}</td>
                </tr>
              );
            })}
            {nearMoneyPuts.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-slate-600">
                  No puts found near current price
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
