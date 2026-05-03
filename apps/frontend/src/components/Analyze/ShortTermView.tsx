"use client";

import React from "react";
import { useTechnicals } from "./shortterm/hooks/useTechnicals";
import { useOptionChain } from "./shortterm/hooks/useOptionChain";
import { usePriceHistory } from "./shortterm/hooks/usePriceHistory";
import { useSynthesis } from "./shortterm/hooks/useSynthesis";
import CandlestickChart from "./shortterm/CandlestickChart";
import MomentumPanel from "./shortterm/MomentumPanel";
import AIPriceAction from "./shortterm/AIPriceAction";
import OptionChainSnapshot from "./shortterm/OptionChainSnapshot";
import BreakevenVisualizer from "./shortterm/BreakevenVisualizer";
import { SkeletonCard, ErrorBanner, SectionErrorBoundary } from "./shared";

interface ShortTermViewProps {
    ticker: string;
}

function formatRefresh(refreshedAt: string | null): string {
    if (!refreshedAt) return "Analysis not refreshed yet";
    const diffMs = Date.now() - Date.parse(refreshedAt);
    if (!Number.isFinite(diffMs)) return "Analysis not refreshed yet";
    const hours = Math.max(0, Math.round(diffMs / (60 * 60 * 1000)));
    return hours < 1 ? "Last refreshed less than 1 hour ago" : `Last refreshed ${hours}h ago`;
}

export default function ShortTermView({ ticker }: ShortTermViewProps) {
    const technicals = useTechnicals(ticker);
    const options = useOptionChain(ticker);
    const priceHistory = usePriceHistory(ticker);
    const synthesis = useSynthesis(ticker);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-slate-300">
                    Short-Term Analysis — <span className="text-white font-mono">{ticker}</span>
                </h2>
                <p className={technicals.isStale ? "text-sm text-amber-300" : "text-sm text-slate-500"}>
                    {formatRefresh(technicals.refreshedAt)}{technicals.isStale ? " · Backend offline or stale" : ""}
                </p>
            </div>

            {/* Per-section errors with retry */}
            {technicals.error && <ErrorBanner message={technicals.error} onRetry={technicals.refetch} />}
            {priceHistory.error && <ErrorBanner message={priceHistory.error} onRetry={priceHistory.refetch} />}
            {options.error && <ErrorBanner message={options.error} onRetry={options.refetch} />}
            {synthesis.error && <ErrorBanner message={synthesis.error} onRetry={synthesis.refetch} />}

            {/* Top pane: Candlestick chart */}
            <SectionErrorBoundary sectionName="Candlestick Chart">
                {priceHistory.loading ? (
                    <SkeletonCard className="min-h-[340px]" />
                ) : priceHistory.data.length > 0 ? (
                    <CandlestickChart priceData={priceHistory.data} />
                ) : null}
            </SectionErrorBoundary>

            {/* Middle pane: Momentum + AI Price Action */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <SectionErrorBoundary sectionName="Momentum Panel">
                        {technicals.loading ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <SkeletonCard />
                                <SkeletonCard />
                            </div>
                        ) : technicals.data ? (
                            <MomentumPanel technicals={technicals.data} />
                        ) : null}
                    </SectionErrorBoundary>
                </div>
                <div>
                    <SectionErrorBoundary sectionName="AI Price Action">
                        {synthesis.loading ? (
                            <SkeletonCard />
                        ) : synthesis.data?.price_action_summary ? (
                            <AIPriceAction summary={synthesis.data.price_action_summary} />
                        ) : null}
                    </SectionErrorBoundary>
                </div>
            </div>

            {/* Bottom pane: Option Chain + Breakeven */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SectionErrorBoundary sectionName="Option Chain">
                    {options.loading ? (
                        <SkeletonCard className="min-h-[300px]" />
                    ) : options.data ? (
                        <OptionChainSnapshot
                            data={options.data}
                            expiry={options.expiry}
                            onExpiryChange={options.setExpiry}
                        />
                    ) : null}
                </SectionErrorBoundary>
                <SectionErrorBoundary sectionName="Breakeven Visualizer">
                    {options.loading ? (
                        <SkeletonCard className="min-h-[300px]" />
                    ) : options.data ? (
                        <BreakevenVisualizer
                            currentPrice={options.data.current_price}
                            puts={options.data.puts}
                        />
                    ) : null}
                </SectionErrorBoundary>
            </div>
        </div>
    );
}
