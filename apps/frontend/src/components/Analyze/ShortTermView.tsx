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

export default function ShortTermView({ ticker }: ShortTermViewProps) {
    const technicals = useTechnicals(ticker);
    const options = useOptionChain(ticker);
    const priceHistory = usePriceHistory(ticker);
    const synthesis = useSynthesis(ticker);

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-300">
                Short-Term Analysis — <span className="text-white font-mono">{ticker}</span>
            </h2>

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
