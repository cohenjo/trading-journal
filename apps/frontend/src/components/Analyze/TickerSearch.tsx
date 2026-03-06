"use client";

import React, { useState } from "react";

interface TickerSearchProps {
    onSearch: (ticker: string) => void;
    currentTicker: string | null;
}

export default function TickerSearch({ onSearch, currentTicker }: TickerSearchProps) {
    const [input, setInput] = useState("");
    const [error, setError] = useState<string | null>(null);

    const validate = (value: string): boolean => {
        const trimmed = value.trim().toUpperCase();
        if (trimmed.length === 0) {
            setError("Enter a ticker symbol");
            return false;
        }
        if (trimmed.length > 5) {
            setError("Ticker must be 1–5 characters");
            return false;
        }
        if (!/^[A-Z]+$/.test(trimmed)) {
            setError("Ticker must be alphabetic only");
            return false;
        }
        setError(null);
        return true;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const ticker = input.trim().toUpperCase();
        if (validate(ticker)) {
            onSearch(ticker);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => {
                        setInput(e.target.value.toUpperCase());
                        setError(null);
                    }}
                    placeholder="Enter ticker (e.g. AAPL)"
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg font-mono tracking-wider"
                    maxLength={5}
                    aria-label="Ticker symbol"
                />
                {error && (
                    <p className="absolute -bottom-6 left-0 text-xs text-red-400">{error}</p>
                )}
            </div>
            <button
                type="submit"
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
                Analyze
            </button>
            {currentTicker && (
                <span className="text-slate-400 text-sm ml-2">
                    Viewing: <span className="text-white font-mono font-semibold">{currentTicker}</span>
                </span>
            )}
        </form>
    );
}
