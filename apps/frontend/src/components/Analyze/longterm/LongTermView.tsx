"use client";

import React, { useState, useMemo } from "react";
import { useCompanyFundamentals } from "./hooks/useCompanyFundamentals";
import { usePriceHistory } from "./hooks/usePriceHistory";
import { useSynthesis } from "./hooks/useSynthesis";
import PriceChartWithFairValue from "./PriceChartWithFairValue";
import FinancialScorecard from "./FinancialScorecard";
import ValuationBenchmarks from "./ValuationBenchmarks";
import DCFCalculator from "./DCFCalculator";
import AISynthesis from "./AISynthesis";
import GrowthStory from "./GrowthStory";

interface LongTermViewProps {
  ticker: string;
}

export default function LongTermView({ ticker }: LongTermViewProps) {
  const [period, setPeriod] = useState("1y");
  const [showGrowthStory, setShowGrowthStory] = useState(false);
  const interval = period === "5y" ? "1wk" : "1d";

  const fundamentals = useCompanyFundamentals(ticker);
  const priceHistory = usePriceHistory(ticker, period, interval);
  const synthesis = useSynthesis(ticker);

  // Compute DCF fair value for the chart overlay
  const dcfFairValue = useMemo(() => {
    const inputs = fundamentals.data?.dcf_inputs;
    if (!inputs || !inputs.current_fcf || !inputs.shares_outstanding) return null;

    const { current_fcf, growth_rate_default, discount_rate_default, terminal_growth, projection_years, shares_outstanding } = inputs;
    if (discount_rate_default <= terminal_growth) return null;

    let sumPV = 0;
    let lastFcf = current_fcf;
    for (let year = 1; year <= projection_years; year++) {
      const projected = current_fcf * Math.pow(1 + growth_rate_default, year);
      sumPV += projected / Math.pow(1 + discount_rate_default, year);
      lastFcf = projected;
    }
    const tv = lastFcf * (1 + terminal_growth) / (discount_rate_default - terminal_growth);
    const pvTv = tv / Math.pow(1 + discount_rate_default, projection_years);
    return (sumPV + pvTv) / shares_outstanding;
  }, [fundamentals.data]);

  const currentPrice = fundamentals.data?.current_price ?? 0;

  // Show error state
  if (fundamentals.error) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-300">
          Long-Term Analysis — <span className="text-white font-mono">{ticker}</span>
        </h2>
        <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-6 text-center">
          <p className="text-red-400">{fundamentals.error}</p>
          <button
            onClick={fundamentals.refetch}
            className="mt-3 px-4 py-2 text-sm bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-slate-300">
        Long-Term Analysis — <span className="text-white font-mono">{ticker}</span>
        {fundamentals.data?.name && (
          <span className="text-slate-500 font-normal text-base ml-2">
            {fundamentals.data.name} · {fundamentals.data.sector}
          </span>
        )}
      </h2>

      {/* Top row: Price chart + AI Synthesis / Growth Story */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PriceChartWithFairValue
            priceData={priceHistory.data}
            fairValue={dcfFairValue}
            currentPrice={currentPrice}
            loading={priceHistory.loading || fundamentals.loading}
            period={period}
            onPeriodChange={setPeriod}
          />
        </div>
        <div>
          {!showGrowthStory ? (
            <div className="space-y-3">
              <AISynthesis data={synthesis.data} loading={synthesis.loading} />
              <button
                onClick={() => setShowGrowthStory(true)}
                className="w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white rounded-xl transition-colors text-sm font-medium flex items-center justify-center gap-2"
              >
                🔍 Deep Analysis with AI
              </button>
            </div>
          ) : (
            <GrowthStory ticker={ticker} />
          )}
        </div>
      </div>

      {/* Middle row: Financial Scorecard */}
      <FinancialScorecard
        financials={fundamentals.data?.financials ?? null}
        loading={fundamentals.loading}
      />

      {/* Bottom row: Valuation + DCF Calculator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ValuationBenchmarks
          financials={fundamentals.data?.financials ?? null}
          loading={fundamentals.loading}
        />
        <DCFCalculator
          dcfInputs={fundamentals.data?.dcf_inputs ?? null}
          currentPrice={currentPrice}
          loading={fundamentals.loading}
        />
      </div>
    </div>
  );
}
