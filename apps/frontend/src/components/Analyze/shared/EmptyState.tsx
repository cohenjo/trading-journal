"use client";

import React from "react";

export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-4">
      <div className="text-5xl mb-4" aria-hidden="true">&#x1F4CA;</div>
      <h2 className="text-xl font-semibold text-slate-300 mb-2">
        No ticker selected
      </h2>
      <p className="text-slate-500 max-w-md">
        Enter a ticker symbol above to start analyzing. Get fundamental data,
        valuation metrics, and AI-powered insights.
      </p>
      <div className="mt-6 flex items-center gap-3 text-sm text-slate-600">
        <span className="px-2 py-1 bg-slate-800 rounded font-mono">AAPL</span>
        <span className="px-2 py-1 bg-slate-800 rounded font-mono">MSFT</span>
        <span className="px-2 py-1 bg-slate-800 rounded font-mono">GOOGL</span>
        <span className="text-slate-700">Try one of these</span>
      </div>
    </div>
  );
}
