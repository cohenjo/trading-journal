"use client";

import { useState, useEffect } from "react";

export type ProjectionParams = {
  yield_rate: number;
  growth_rate: number;
  reinvest_rate: number;
  cutoff_year: number;
  final_year: number;
};

type DividendSettingsProps = {
  params: ProjectionParams;
  onChange: (params: ProjectionParams) => void;
};

export default function DividendSettings({ params, onChange }: DividendSettingsProps) {
  const handleChange = (field: keyof ProjectionParams, value: number) => {
    onChange({ ...params, [field]: value });
  };

  return (
    <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 h-full">
      <h3 className="text-lg font-semibold mb-4 text-slate-200">Projection Settings</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">
            Portfolio Yield (%)
          </label>
          <input
            type="number"
            step="0.1"
            value={(params.yield_rate * 100).toFixed(1)}
            onChange={(e) => handleChange("yield_rate", parseFloat(e.target.value) / 100)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">
            Dividend Growth Rate (%)
          </label>
          <input
            type="number"
            step="0.1"
            value={(params.growth_rate * 100).toFixed(1)}
            onChange={(e) => handleChange("growth_rate", parseFloat(e.target.value) / 100)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">
            Re-invest Rate (%)
          </label>
          <input
            type="number"
            step="1"
            value={(params.reinvest_rate * 100).toFixed(0)}
            onChange={(e) => handleChange("reinvest_rate", parseFloat(e.target.value) / 100)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">
            Cutoff Year (Retirement)
          </label>
          <input
            type="number"
            value={params.cutoff_year}
            onChange={(e) => handleChange("cutoff_year", parseInt(e.target.value))}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
          />
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">
            Final Year
          </label>
          <input
            type="number"
            value={params.final_year}
            onChange={(e) => handleChange("final_year", parseInt(e.target.value))}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        </div>
      </div>
    </div>
  );
}
