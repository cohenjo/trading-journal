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
import {
  ErrorBanner,
  SectionErrorBoundary,
} from "../shared";

interface LongTermViewProps {
  ticker: string;
}

function formatRefresh(refreshedAt: string | null): string {
  if (!refreshedAt) return "Analysis not refreshed yet";
  const diffMs = Date.now() - Date.parse(refreshedAt);
  if (!Number.isFinite(diffMs)) return "Analysis not refreshed yet";
  const hours = Math.max(0, Math.round(diffMs / (60 * 60 * 1000)));
  return hours < 1 ? "Last refreshed less than 1 hour ago" : `Last refreshed ${hours}h ago`;
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

  // Full-page error only for invalid/unknown tickers (404)
  if (fundamentals.error && !fundamentals.loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-300">
          Long-Term Analysis — <span className="text-white font-mono">{ticker}</span>
        </h2>
        <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">&#x1F50D;</div>
          <p className="text-red-400 font-medium mb-1">{fundamentals.error}</p>
          <p className="text-slate-500 text-sm mb-4">
            Check the ticker symbol and try again. If the issue persists, the data source may be temporarily unavailable.
          </p>
          <button
            onClick={fundamentals.refetch}
            className="px-5 py-2.5 text-sm bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-300">
          Long-Term Analysis — <span className="text-white font-mono">{ticker}</span>
          {fundamentals.data?.name && (
            <span className="text-slate-500 font-normal text-base ml-2">
              {fundamentals.data.name} · {fundamentals.data.sector}
            </span>
          )}
        </h2>
        <p className={fundamentals.isStale ? "text-sm text-amber-300" : "text-sm text-slate-500"}>
          {formatRefresh(fundamentals.refreshedAt)}{fundamentals.isStale ? " · Backend offline or stale" : ""}
        </p>
      </div>

      {/* Per-section errors for non-critical data */}
      {priceHistory.error && <ErrorBanner message={priceHistory.error} onRetry={priceHistory.refetch} />}
      {synthesis.error && <ErrorBanner message={synthesis.error} onRetry={synthesis.refetch} />}

      {/* Top row: Price chart + AI Synthesis / Growth Story */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SectionErrorBoundary sectionName="Price Chart">
            <PriceChartWithFairValue
            priceData={priceHistory.data}
            fairValue={dcfFairValue}
            currentPrice={currentPrice}
            loading={priceHistory.loading || fundamentals.loading}
            period={period}
            onPeriodChange={setPeriod}
          />
          </SectionErrorBoundary>
        </div>
        <div>
          <SectionErrorBoundary sectionName="AI Synthesis">
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
          </SectionErrorBoundary>
        </div>
      </div>

      {/* Middle row: Financial Scorecard */}
      <SectionErrorBoundary sectionName="Financial Scorecard">
        <FinancialScorecard
          financials={fundamentals.data?.financials ?? null}
          loading={fundamentals.loading}
        />
      </SectionErrorBoundary>

      {/* Bottom row: Valuation + DCF Calculator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionErrorBoundary sectionName="Valuation Benchmarks">
          <ValuationBenchmarks
            financials={fundamentals.data?.financials ?? null}
            loading={fundamentals.loading}
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary sectionName="DCF Calculator">
          <DCFCalculator
            dcfInputs={fundamentals.data?.dcf_inputs ?? null}
            currentPrice={currentPrice}
            loading={fundamentals.loading}
          />
        </SectionErrorBoundary>
      </div>
    </div>
  );
}
