"use client";

import { useState } from "react";
import { TaxCondorRecommendation } from "./types";
import { RecommendationDetails } from "./RecommendationDetails";

export default function TaxCondorView() {
  const [symbol, setSymbol] = useState("NDX");
  const [budget, setBudget] = useState(2000);
  const [useLiveData, setUseLiveData] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<
    TaxCondorRecommendation[]
  >([]);
  const [selectedRec, setSelectedRec] = useState<TaxCondorRecommendation | null>(null);

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        "/api/tax-condor/recommend",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, budget, use_live_data: useLiveData }),
        }
      );
      const data = await res.json();
      setRecommendations(data);
    } catch (error) {
      console.error("Failed to fetch recommendations", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto text-slate-100">
      <h1 className="text-2xl font-bold mb-6">Tax Condor Recommender</h1>

      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 mb-8 flex gap-4 items-end">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white w-32"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">
            Loss Budget ($)
          </label>
          <input
            type="number"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white w-32"
          />
        </div>
        <div className="flex items-center pb-2">
          <input
            type="checkbox"
            id="useLiveData"
            checked={useLiveData}
            onChange={(e) => setUseLiveData(e.target.checked)}
            className="mr-2 h-4 w-4"
          />
          <label htmlFor="useLiveData" className="text-sm text-slate-400 cursor-pointer">
            Use Live Data (IBKR)
          </label>
        </div>
        <button
          onClick={fetchRecommendations}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Get Recommendations"}
        </button>
      </div>

      <div className="space-y-6">
        {recommendations.map((rec, idx) => (
          <div
            key={idx}
            className="bg-slate-900 border border-slate-800 rounded-lg p-6 cursor-pointer hover:border-blue-500 transition-colors"
            onClick={() => setSelectedRec(rec)}
          >
            <div className="flex justify-between items-start mb-4 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-xl font-semibold text-blue-400">
                  Rank #{idx + 1} (Score: {rec.score.toFixed(1)})
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Theta Coverage: {rec.analysis.theta_coverage.toFixed(2)}x |
                  Net Credit: ${rec.analysis.net_credit.toFixed(2)}
                </p>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-400">Margin Req</div>
                <div className="text-lg font-mono">
                  ${rec.iron_condor.margin_requirement.toFixed(0)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* LEAP Section */}
              <div>
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Long Term (LEAP)
                </h3>
                <div className="bg-slate-950/50 p-4 rounded border border-slate-800/50">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-mono text-green-400">BUY 1</span>
                    <span className="font-mono">
                      {rec.leap.leg.expiration}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-lg">
                      Strike {rec.leap.leg.strike} CALL
                    </span>
                    <span className="text-sm text-slate-400">
                      Δ {rec.leap.leg.greeks.delta.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Iron Condor Section */}
              <div>
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Short Term (Iron Condor)
                </h3>
                <div className="space-y-2">
                  {/* Call Wing */}
                  <div className="flex items-center justify-between bg-slate-950/30 p-2 rounded border border-slate-800/30">
                    <span className="text-red-400 font-mono text-sm">SELL</span>
                    <span className="font-mono">
                      {rec.iron_condor.short_call.strike} Call
                    </span>
                    <span className="text-slate-500 text-xs">
                      Δ {rec.iron_condor.short_call.greeks.delta.toFixed(2)}
                      {rec.iron_condor.short_call.implied_volatility && ` | IV ${(rec.iron_condor.short_call.implied_volatility * 100).toFixed(0)}%`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between bg-slate-950/30 p-2 rounded border border-slate-800/30">
                    <span className="text-green-400 font-mono text-sm">BUY</span>
                    <span className="font-mono">
                      {rec.iron_condor.long_call.strike} Call
                    </span>
                    <span className="text-slate-500 text-xs">
                      Δ {rec.iron_condor.long_call.greeks.delta.toFixed(2)}
                      {rec.iron_condor.long_call.implied_volatility && ` | IV ${(rec.iron_condor.long_call.implied_volatility * 100).toFixed(0)}%`}
                    </span>
                  </div>
                  
                  <div className="h-px bg-slate-800 my-2" />

                  {/* Put Wing */}
                  <div className="flex items-center justify-between bg-slate-950/30 p-2 rounded border border-slate-800/30">
                    <span className="text-red-400 font-mono text-sm">SELL</span>
                    <span className="font-mono">
                      {rec.iron_condor.short_put.strike} Put
                    </span>
                    <span className="text-slate-500 text-xs">
                      Δ {rec.iron_condor.short_put.greeks.delta.toFixed(2)}
                      {rec.iron_condor.short_put.implied_volatility && ` | IV ${(rec.iron_condor.short_put.implied_volatility * 100).toFixed(0)}%`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between bg-slate-950/30 p-2 rounded border border-slate-800/30">
                    <span className="text-green-400 font-mono text-sm">BUY</span>
                    <span className="font-mono">
                      {rec.iron_condor.long_put.strike} Put
                    </span>
                    <span className="text-slate-500 text-xs">
                      Δ {rec.iron_condor.long_put.greeks.delta.toFixed(2)}
                      {rec.iron_condor.long_put.implied_volatility && ` | IV ${(rec.iron_condor.long_put.implied_volatility * 100).toFixed(0)}%`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Analysis Section */}
            <div className="mt-6 pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                <div className="text-slate-500 mb-1">Underlying</div>
                <div className="font-mono">
                    Price: ${rec.underlying_price?.toFixed(2) || 'N/A'}
                </div>
                <div className="font-mono">
                    IV: {(rec.underlying_iv ? (rec.underlying_iv * 100).toFixed(1) : 'N/A')}%
                </div>
                </div>
                <div>
                <div className="text-slate-500 mb-1">Structure</div>
                <div className="font-mono">
                    DTE: {rec.iron_condor.days_to_expiration || 'N/A'} days
                </div>
                </div>
                <div>
                <div className="text-slate-500 mb-1">Portfolio P&L (T+21)</div>
                {rec.portfolio_pnl_simulations?.slice(0, 5).map((sim, i) => (
                    <div key={i} className="font-mono flex justify-between">
                        <span>{sim.price_change_pct > 0 ? '+' : ''}{sim.price_change_pct.toFixed(0)}%:</span>
                        <span className={sim.estimated_pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                            ${sim.estimated_pnl.toFixed(2)}
                        </span>
                    </div>
                ))}
                </div>
            </div>
          </div>
        ))}

        {recommendations.length === 0 && !loading && (
          <div className="text-center text-slate-500 py-12">
            No recommendations found. Try adjusting the budget or symbol.
          </div>
        )}
      </div>

      {selectedRec && (
        <RecommendationDetails 
            recommendation={selectedRec} 
            onClose={() => setSelectedRec(null)} 
        />
      )}
    </div>
  );
}
