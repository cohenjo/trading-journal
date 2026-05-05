"use client";
export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo } from "react";
import { useSettings } from "../settings/SettingsContext";
import { getDividendDashboard } from "@/app/dividends/actions";
import StackedIncomeChart, { StackedChartData } from "../../components/Summary/StackedIncomeChart";
import { getLadderIncome } from "../ladder/actions";
import Decimal from "decimal.js";
import { getOptionsMonthlyMetrics } from "../options/actions";
import type { IncomePoint } from "@/components/Ladder/types";

interface YearAmountPoint {
  year: number;
  amount: number;
}

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

  const optionsFinalYear = settings.optionsFinalYear;

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Fetch Ladder Income
        const ladderResult = await getLadderIncome();
        if (!ladderResult.ok) throw new Error(ladderResult.error);
        const ladderSeries: IncomePoint[] = ladderResult.data.income_series;

        // 2. Project dividends from the current dashboard annual income.
        const dividendDashboard = await getDividendDashboard(settings.mainCurrency);
        let projectedDividendAmount = dividendDashboard.stats.annual_income;
        const divData: YearAmountPoint[] = [];
        const currentYear = new Date().getFullYear();
        for (let year = currentYear; year <= divParams.final_year; year += 1) {
          if (year > currentYear) {
            projectedDividendAmount *= 1 + divParams.growth_rate + (divParams.yield_rate * divParams.reinvest_rate);
          }
          divData.push({ year, amount: Math.round(projectedDividendAmount * 100) / 100 });
        }

        // 3. Read cooked options metrics. The legacy options_income projection is replaced;
        // use current-year realized P&L as the annual options income signal until Phase 4 forecasting.
        const optionsMetrics = await getOptionsMonthlyMetrics(currentYear);
        const currentOptionsRealized = optionsMetrics.reduce(
          (sum, month) => sum.plus(month.realizedPnl),
          new Decimal(0),
        );
        const optData: YearAmountPoint[] = [];
        for (let year = currentYear; year <= optionsFinalYear; year += 1) {
          optData.push({ year, amount: currentOptionsRealized.toDecimalPlaces(2).toNumber() });
        }

        // Merge Data
        // Find range of years
        const years = new Set<number>();
        ladderSeries.forEach((d) => years.add(new Date(d.date).getFullYear()));
        divData.forEach((d) => years.add(d.year));
        optData.forEach((d) => years.add(d.year));

        const maxYear = Math.min(divParams.final_year, optionsFinalYear);
        const sortedYears = Array.from(years)
          .sort((a, b) => a - b)
          .filter((y) => y <= maxYear);

        // Create map for quick lookup
        const ladderMap = new Map(ladderSeries.map((d) => [new Date(d.date).getFullYear(), d.value]));
        const divMap = new Map(divData.map((d) => [d.year, d.amount]));
        const optMap = new Map(optData.map((d) => [d.year, d.amount]));

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
  }, [divParams, optionsFinalYear, settings.mainCurrency]);

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
