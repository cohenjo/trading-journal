"use client";

import React from "react";
import type { SynthesisData } from "./hooks/useSynthesis";

interface AISynthesisProps {
  data: SynthesisData | null;
  loading: boolean;
}

function SkeletonList() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-4 bg-slate-700 rounded w-full" />
      ))}
    </div>
  );
}

export default function AISynthesis({ data, loading }: AISynthesisProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4">AI Synthesis</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Growth Engine */}
        <div className="border border-green-900/50 rounded-lg p-4 bg-green-950/20">
          <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            The Growth Engine
          </h4>
          {loading ? (
            <SkeletonList />
          ) : data?.growth_engine && data.growth_engine.length > 0 ? (
            <ul className="space-y-2">
              {data.growth_engine.map((item, i) => (
                <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                  <span className="text-green-500 mt-1 shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No growth signals available</p>
          )}
        </div>

        {/* Bear Case */}
        <div className="border border-red-900/50 rounded-lg p-4 bg-red-950/20">
          <h4 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            The Bear Case
          </h4>
          {loading ? (
            <SkeletonList />
          ) : data?.bear_case && data.bear_case.length > 0 ? (
            <ul className="space-y-2">
              {data.bear_case.map((item, i) => (
                <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                  <span className="text-red-500 mt-1 shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No bear signals available</p>
          )}
        </div>
      </div>
    </div>
  );
}
