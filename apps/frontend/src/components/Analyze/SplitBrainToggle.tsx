"use client";

import React from "react";

export type AnalysisMode = "long-term" | "short-term";

interface SplitBrainToggleProps {
    mode: AnalysisMode;
    onModeChange: (mode: AnalysisMode) => void;
}

export default function SplitBrainToggle({ mode, onModeChange }: SplitBrainToggleProps) {
    return (
        <div className="inline-flex rounded-full bg-slate-900 border border-slate-700 p-1">
            <button
                type="button"
                onClick={() => onModeChange("long-term")}
                className={`relative px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                    mode === "long-term"
                        ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25"
                        : "text-slate-400 hover:text-slate-200"
                }`}
                aria-pressed={mode === "long-term"}
            >
                Long-Term Investor
            </button>
            <button
                type="button"
                onClick={() => onModeChange("short-term")}
                className={`relative px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                    mode === "short-term"
                        ? "bg-amber-600 text-white shadow-lg shadow-amber-600/25"
                        : "text-slate-400 hover:text-slate-200"
                }`}
                aria-pressed={mode === "short-term"}
            >
                Short-Term Income
            </button>
        </div>
    );
}
