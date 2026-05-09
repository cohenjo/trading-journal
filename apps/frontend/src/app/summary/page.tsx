"use client";
export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo } from "react";
import { useSettings } from "../settings/SettingsContext";
import { getDividendDashboard } from "@/app/dividends/actions";
import StackedIncomeBarChart, { YearlyIncomeData } from "../../components/Summary/StackedIncomeBarChart";
import { getLadderIncome } from "../ladder/actions";
import { getOptionsYearlyCashFlow } from "../options/actions";
import type { IncomePoint } from "@/components/Ladder/types";

export default function SummaryPage() {
  const { settings } = useSettings();
  const [chartData, setChartData] = useState<YearlyIncomeData[]>([]);

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

  const optionsFinalYear = settings.optionsFinalYear;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const currentYear = new Date().getFullYear();

        // 1. Fetch Options yearly cumulative cash flow (actuals only)
        const optionsYearly = await getOptionsYearlyCashFlow();
        const optionsMap = new Map(optionsYearly.map(o => [o.year, o.amount]));

        // 2. Fetch Ladder Income (bonds - future cash flows)
        const ladderResult = await getLadderIncome();
        if (!ladderResult.ok) throw new Error(ladderResult.error);
        const ladderSeries: IncomePoint[] = ladderResult.data.income_series;
        const ladderMap = new Map<number, number>();
        for (const point of ladderSeries) {
          const year = new Date(point.date).getFullYear();
          ladderMap.set(year, (ladderMap.get(year) || 0) + point.value);
        }

        // 3. Project dividends from current dashboard annual income
        const dividendDashboard = await getDividendDashboard(settings.mainCurrency);
        let projectedDividendAmount = dividendDashboard.stats.annual_income;
        const divMap = new Map<number, number>();
        for (let year = currentYear; year <= divParams.final_year; year += 1) {
          if (year > currentYear) {
            projectedDividendAmount *= 1 + divParams.growth_rate + (divParams.yield_rate * divParams.reinvest_rate);
          }
          divMap.set(year, Math.round(projectedDividendAmount * 100) / 100);
        }

        // 4. Merge all data sources
        const allYears = new Set<number>();
        optionsYearly.forEach(o => allYears.add(o.year));
        ladderSeries.forEach(l => allYears.add(new Date(l.date).getFullYear()));
        for (let year = currentYear; year <= Math.min(divParams.final_year, optionsFinalYear); year++) {
          allYears.add(year);
        }

        const maxYear = Math.min(divParams.final_year, optionsFinalYear);
        const sortedYears = Array.from(allYears)
          .filter(y => y <= maxYear)
          .sort((a, b) => a - b);

        const merged: YearlyIncomeData[] = sortedYears.map(year => {
          const hasOptionsData = optionsMap.has(year);
          const isProjected = year > currentYear;

          return {
            year,
            // Options: use actual for past/current, 0 for future (conservative projection)
            optionsIncome: hasOptionsData ? optionsMap.get(year)! : 0,
            // Dividends: projected growth
            dividendsIncome: divMap.get(year) || 0,
            // Bonds: scheduled payments
            bondsIncome: ladderMap.get(year) || 0,
            isProjected,
          };
        });

        setChartData(merged);

      } catch (err) {
        console.error("Failed to fetch summary data", err);
      }
    };

    fetchData();
  }, [divParams, optionsFinalYear, settings.mainCurrency]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-100">Income Summary</h1>

      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-slate-200">Projected Income Stacking (Yearly)</h3>
        <div className="flex gap-4 mb-4 text-sm">
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-amber-500 rounded-sm"></div>
                <span>Options (Cumulative Cash Flow)</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div>
                <span>Dividends (Projected)</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-sm"></div>
                <span>Bond Ladder (Scheduled)</span>
            </div>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          <strong>Projection assumptions:</strong> Options show actual cumulative cash flow for past years,
          0 for future (conservative). Dividends project with {(divParams.growth_rate * 100).toFixed(1)}% growth rate.
          Bonds show scheduled coupon and maturity payments. Projected years are shown with reduced opacity.
        </p>
        <StackedIncomeBarChart data={chartData} cutoffYear={settings.cutoffYear} />
      </div>
    </div>
  );
}
