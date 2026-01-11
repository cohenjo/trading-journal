"use client";

import { useEffect, useState, useMemo } from "react";
import { useSettings } from "../settings/SettingsContext";
import StackedIncomeChart, { StackedChartData } from "../../components/Summary/StackedIncomeChart";

export default function SummaryPage() {
  const { settings } = useSettings();
  const [chartData, setChartData] = useState<StackedChartData[]>([]);

  // Params for projections
  const divParams = useMemo(() => ({
    yield_rate: settings.dividendYieldRate,
    growth_rate: settings.dividendGrowthRate,
    reinvest_rate: settings.dividendReinvestRate,
    cutoff_year: settings.cutoffYear,
    final_year: settings.dividendFinalYear,
  }), [
    settings.dividendYieldRate,
    settings.dividendGrowthRate,
    settings.dividendReinvestRate,
    settings.cutoffYear,
    settings.dividendFinalYear,
  ]);

  const optParams = useMemo(() => ({
    growth_rate: settings.optionsGrowthRate,
    cutoff_year: settings.cutoffYear,
    final_year: settings.optionsFinalYear,
  }), [
    settings.optionsGrowthRate,
    settings.cutoffYear,
    settings.optionsFinalYear,
  ]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Fetch Ladder Income
        const ladderRes = await fetch("/api/ladder/income");
        const ladderJson = await ladderRes.json();
        const ladderSeries = ladderJson.income_series || [];

        // 2. Fetch Dividend Projection
        const divRes = await fetch("/api/dividends/projection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(divParams),
        });
        const divJson = await divRes.json();
        const divData = divJson.data || [];

        // 3. Fetch Options Projection
        const optRes = await fetch("/api/options/projection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(optParams),
        });
        const optJson = await optRes.json();
        const optData = optJson.data || [];

        // Merge Data
        // Find range of years
        const years = new Set<number>();
        ladderSeries.forEach((d: any) => years.add(new Date(d.date).getFullYear()));
        divData.forEach((d: any) => years.add(d.year));
        optData.forEach((d: any) => years.add(d.year));

        const maxYear = Math.min(divParams.final_year, optParams.final_year);
        const sortedYears = Array.from(years)
          .sort((a, b) => a - b)
          .filter((y) => y <= maxYear);

        // Create map for quick lookup
        const ladderMap = new Map(ladderSeries.map((d: any) => [new Date(d.date).getFullYear(), d.value]));
        const divMap = new Map(divData.map((d: any) => [d.year, d.amount]));
        const optMap = new Map(optData.map((d: any) => [d.year, d.amount]));

        const merged: StackedChartData[] = sortedYears.map(year => ({
          time: `${year}-01-01`,
          ladder: ladderMap.get(year) || 0,
          dividends: divMap.get(year) || 0,
          options: optMap.get(year) || 0,
        }));

        setChartData(merged);

      } catch (err) {
        console.error("Failed to fetch summary data", err);
      }
    };

    fetchData();
  }, [divParams, optParams]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-100">Income Summary</h1>
      
      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-slate-200">Projected Income Stacking</h3>
        <div className="flex gap-4 mb-4 text-sm">
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-amber-500 rounded-sm"></div>
                <span>Options</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div>
                <span>Dividends</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-sm"></div>
                <span>Bond Ladder</span>
            </div>
        </div>
        <StackedIncomeChart data={chartData} cutoffYear={settings.cutoffYear} />
      </div>
    </div>
  );
}
