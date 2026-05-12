"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useMemo } from "react";
import OptionsEstimationChart, {
  type OptionsChartPoint,
} from "../../../components/Options/OptionsEstimationChart";
import OptionsEstimationSettings, {
  type OptionsProjectionParams,
} from "../../../components/Options/OptionsEstimationSettings";
import { useSettings } from "../../settings/SettingsContext";
import {
  getOptionsYearlyCashFlow,
  getOptionsIncomeEstimation,
  type OptionsIncomeEstimationResult,
} from "../actions";
import { formatCurrency } from "@/lib/currency";

type ActualYear = { year: number; amount: number; isProjected: boolean };

export default function OptionsEstimationsPage() {
  const { settings, updateSettings } = useSettings();

  const [actuals, setActuals] = useState<ActualYear[]>([]);
  const [estimation, setEstimation] = useState<OptionsIncomeEstimationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const params: OptionsProjectionParams = useMemo(
    () => ({
      growth_rate: settings.optionsGrowthRate,
      final_year: settings.optionsFinalYear,
    }),
    [settings.optionsGrowthRate, settings.optionsFinalYear],
  );

  const handleParamsChange = (newParams: OptionsProjectionParams) => {
    updateSettings({
      optionsGrowthRate: newParams.growth_rate,
      optionsFinalYear: newParams.final_year,
    });
  };

  // Re-fetch estimation whenever settings change so the chart stays live.
  useEffect(() => {
    let cancelled = false;

    const loadEstimation = async () => {
      const result = await getOptionsIncomeEstimation({
        growthRate: params.growth_rate,
        finalYear: params.final_year,
      });
      if (!cancelled) setEstimation(result);
    };

    loadEstimation();
    return () => {
      cancelled = true;
    };
  }, [params.growth_rate, params.final_year]);

  // Load actuals once on mount.
  useEffect(() => {
    const loadActuals = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await getOptionsYearlyCashFlow();
        setActuals(data);
      } catch (err) {
        setErrorMessage(
          `Failed to load options cash flow: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setIsLoading(false);
      }
    };
    loadActuals();
  }, []);

  // Merge actuals + projections into chart points. Actuals win for overlapping years.
  const chartData = useMemo<OptionsChartPoint[]>(() => {
    const actualsMap = new Map<number, number>(actuals.map((a) => [a.year, a.amount]));

    const historicalPoints: OptionsChartPoint[] = actuals.map((a) => ({
      time: `${a.year}-01-01`,
      value: a.amount,
      type: "historical",
    }));

    const projectedPoints: OptionsChartPoint[] = (estimation?.projections ?? [])
      .filter((p) => !actualsMap.has(p.year)) // actuals win for overlapping years
      .map((p) => ({
        time: `${p.year}-01-01`,
        value: p.expectedIncome,
        type: "projected",
      }));

    return [...historicalPoints, ...projectedPoints];
  }, [actuals, estimation]);

  const baselineAverage = estimation?.baselineAverage ?? 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-100">Options Income Estimations</h1>

      {/* Summary tile */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div
          className="bg-slate-900 border border-slate-700 rounded-lg p-4"
          data-testid="options-baseline-tile"
        >
          <p className="text-sm text-slate-400 mb-1">3-Year Baseline Average</p>
          <p className="text-2xl font-semibold text-green-400">
            {formatCurrency(baselineAverage, "USD")}
          </p>
          <p className="text-xs text-slate-500 mt-1">per year · from realized options cash flow</p>
        </div>
        <div
          className="bg-slate-900 border border-slate-700 rounded-lg p-4"
          data-testid="options-growth-tile"
        >
          <p className="text-sm text-slate-400 mb-1">Configured Growth Rate</p>
          <p className="text-2xl font-semibold text-blue-400">
            {(params.growth_rate * 100).toFixed(1)}%
          </p>
          <p className="text-xs text-slate-500 mt-1">annual · applied to baseline</p>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-200">
          {errorMessage}
        </div>
      )}

      {/* Chart + settings — 2/3 + 1/3 grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
            <h3 className="text-lg font-semibold mb-4 text-slate-200">Projection Chart</h3>
            {isLoading ? (
              <div className="flex items-center justify-center h-[400px] text-slate-400">
                Loading chart data…
              </div>
            ) : (
              <OptionsEstimationChart data={chartData} />
            )}
            <div className="flex gap-6 mt-3 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-[#26a69a]" />
                Historical actuals
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-[#2196f3]" />
                Projected
              </span>
            </div>
          </div>
        </div>
        <div>
          <OptionsEstimationSettings params={params} onChange={handleParamsChange} />
        </div>
      </div>

      {/* History table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
              <p className="text-slate-400">Loading history…</p>
            </div>
          ) : (
            <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
              <h3 className="text-lg font-semibold mb-4 text-slate-200">Yearly Cash Flow History</h3>
              {actuals.length === 0 ? (
                <p className="text-slate-400 text-sm">No historical options cash flow data found.</p>
              ) : (
                <table className="w-full text-sm text-slate-300">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-700">
                      <th className="pb-2 pr-4">Year</th>
                      <th className="pb-2 text-right">Cash Flow (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...actuals]
                      .sort((a, b) => b.year - a.year)
                      .map((row) => (
                        <tr key={row.year} className="border-b border-slate-800">
                          <td className="py-2 pr-4 font-medium">{row.year}</td>
                          <td className="py-2 text-right">
                            <span
                              className={
                                row.amount >= 0 ? "text-green-400" : "text-red-400"
                              }
                            >
                              {formatCurrency(row.amount, "USD")}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
