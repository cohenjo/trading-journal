"use client";

import React, { useState } from "react";
import TickerSearch from "./TickerSearch";
import SplitBrainToggle, { type AnalysisMode } from "./SplitBrainToggle";
import LongTermView from "./LongTermView";
import ShortTermView from "./ShortTermView";

export default function AnalyzePage() {
    const [ticker, setTicker] = useState<string | null>(null);
    const [mode, setMode] = useState<AnalysisMode>("long-term");

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 pb-24">
            <div className="max-w-7xl mx-auto space-y-8">
                <header>
                    <h1 className="text-2xl font-bold text-white">Company Analysis</h1>
                    <p className="text-slate-400 mt-2">
                        Research any company through two lenses — long-term fundamentals or short-term tactical setups.
                    </p>
                </header>

                <div className="space-y-6">
                    <TickerSearch onSearch={setTicker} currentTicker={ticker} />
                    <SplitBrainToggle mode={mode} onModeChange={setMode} />
                </div>

                {ticker && (
                    <div className="mt-8">
                        {mode === "long-term" ? (
                            <LongTermView ticker={ticker} />
                        ) : (
                            <ShortTermView ticker={ticker} />
                        )}
                    </div>
                )}

                {!ticker && (
                    <div className="flex items-center justify-center min-h-[300px]">
                        <p className="text-slate-600 text-lg">Enter a ticker symbol above to start analyzing.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
