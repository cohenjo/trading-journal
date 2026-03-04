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

interface ShortTermViewProps {
    ticker: string;
}

function SkeletonCard({ className = "" }: { className?: string }) {
    return (
        <div className={`bg-slate-900 border border-slate-800 rounded-xl p-6 animate-pulse ${className}`}>
            <div className="h-4 bg-slate-800 rounded w-1/3 mb-4" />
            <div className="h-8 bg-slate-800 rounded w-1/2 mb-3" />
            <div className="h-3 bg-slate-800 rounded w-2/3 mb-2" />
            <div className="h-3 bg-slate-800 rounded w-1/2" />
        </div>
    );
}

function ErrorBanner({ message }: { message: string }) {
    return (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 text-red-400 text-sm">
            ⚠️ {message}
        </div>
    );
}

export default function ShortTermView({ ticker }: ShortTermViewProps) {
    const technicals = useTechnicals(ticker);
    const options = useOptionChain(ticker);
    const priceHistory = usePriceHistory(ticker);
    const synthesis = useSynthesis(ticker);

    const anyLoading = technicals.loading || options.loading || priceHistory.loading || synthesis.loading;
    const errors = [technicals.error, options.error, priceHistory.error, synthesis.error].filter(Boolean);

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-300">
                Short-Term Analysis — <span className="text-white font-mono">{ticker}</span>
            </h2>

            {errors.length > 0 && (
                <div className="space-y-2">
                    {errors.map((err, i) => <ErrorBanner key={i} message={err!} />)}
                </div>
            )}

            {/* Top pane: Candlestick chart */}
            {priceHistory.loading ? (
                <SkeletonCard className="min-h-[340px]" />
            ) : priceHistory.data.length > 0 ? (
                <CandlestickChart priceData={priceHistory.data} />
            ) : null}

            {/* Middle pane: Momentum + AI Price Action */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    {technicals.loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SkeletonCard />
                            <SkeletonCard />
                        </div>
                    ) : technicals.data ? (
                        <MomentumPanel technicals={technicals.data} />
                    ) : null}
                </div>
                <div>
                    {synthesis.loading ? (
                        <SkeletonCard />
                    ) : synthesis.data?.price_action_summary ? (
                        <AIPriceAction summary={synthesis.data.price_action_summary} />
                    ) : null}
                </div>
            </div>

            {/* Bottom pane: Option Chain + Breakeven */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {options.loading ? (
                    <>
                        <SkeletonCard className="min-h-[300px]" />
                        <SkeletonCard className="min-h-[300px]" />
                    </>
                ) : options.data ? (
                    <>
                        <OptionChainSnapshot
                            data={options.data}
                            expiry={options.expiry}
                            onExpiryChange={options.setExpiry}
                        />
                        <BreakevenVisualizer
                            currentPrice={options.data.current_price}
                            puts={options.data.puts}
                        />
                    </>
                ) : null}
            </div>
        </div>
    );
}
