"use client";

import { useState, useEffect, useMemo } from "react";
import DividendChart, { DividendChartPoint } from "../../components/Dividends/DividendChart";
import DividendHistory, { DividendRecord } from "../../components/Dividends/DividendHistory";
import DividendSettings, { ProjectionParams } from "../../components/Dividends/DividendSettings";
import { useSettings } from "../settings/SettingsContext";

export default function DividendsPage() {
  const { settings, updateSettings } = useSettings();
  const [historicalData, setHistoricalData] = useState<DividendRecord[]>([]);
  const [chartData, setChartData] = useState<DividendChartPoint[]>([]);

  const params: ProjectionParams = useMemo(() => ({
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

  const handleParamsChange = (newParams: ProjectionParams) => {
    updateSettings({
      dividendYieldRate: newParams.yield_rate,
      dividendGrowthRate: newParams.growth_rate,
      dividendReinvestRate: newParams.reinvest_rate,
      cutoffYear: newParams.cutoff_year,
      dividendFinalYear: newParams.final_year,
    });
  };

  // Fetch historical data on mount
  useEffect(() => {
    fetch("/api/dividends")
      .then((res) => res.json())
      .then((data) => {
        setHistoricalData(data);
      })
      .catch((err) => console.error("Failed to fetch dividends:", err));
  }, []);

  // Fetch projection whenever params or historical data changes
  useEffect(() => {
    if (historicalData.length === 0) return;

    fetch("/api/dividends/projection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
      .then((res) => res.json())
      .then((response) => {
        const points = response.data.map((p: any) => ({
          time: `${p.year}-01-01`, // Format for lightweight-charts
          value: p.amount,
          type: p.type,
        }));
        setChartData(points);
      })
      .catch((err) => console.error("Failed to fetch projection:", err));
  }, [historicalData, params]);

  const handleSaveHistory = async (newData: DividendRecord[]) => {
    try {
      const res = await fetch("/api/dividends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newData),
      });
      if (res.ok) {
        const savedData = await res.json();
        setHistoricalData(savedData);
      }
    } catch (err) {
      console.error("Failed to save dividends:", err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-100">Dividend Growth Estimations</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
             <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 mb-6">
                <h3 className="text-lg font-semibold mb-4 text-slate-200">Projection Chart</h3>
                <DividendChart data={chartData} cutoffYear={params.cutoff_year} />
             </div>
        </div>
        <div>
            <DividendSettings params={params} onChange={handleParamsChange} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            <DividendHistory initialData={historicalData} onSave={handleSaveHistory} />
        </div>
      </div>
    </div>
  );
}
