"use client";

import { useEffect, useMemo, useState } from "react";
import OptionsChart, { OptionsChartPoint } from "../../components/Options/OptionsChart";
import OptionsHistory, { OptionsRecord } from "../../components/Options/OptionsHistory";
import OptionsSettings, { OptionsProjectionParams } from "../../components/Options/OptionsSettings";
import { useSettings } from "../settings/SettingsContext";

export default function OptionsPage() {
  const { settings, updateSettings } = useSettings();
  const [historicalData, setHistoricalData] = useState<OptionsRecord[]>([]);
  const [chartData, setChartData] = useState<OptionsChartPoint[]>([]);
  const [average, setAverage] = useState<number | null>(null);

  const params: OptionsProjectionParams = useMemo(
    () => ({
      growth_rate: settings.optionsGrowthRate,
      cutoff_year: settings.cutoffYear,
      final_year: settings.optionsFinalYear,
    }),
    [settings.optionsGrowthRate, settings.cutoffYear, settings.optionsFinalYear],
  );

  const handleParamsChange = (newParams: OptionsProjectionParams) => {
    updateSettings({
      optionsGrowthRate: newParams.growth_rate,
      cutoffYear: newParams.cutoff_year,
      optionsFinalYear: newParams.final_year,
    });
  };

  useEffect(() => {
    fetch("/api/options")
      .then((res) => res.json())
      .then((data) => {
        setHistoricalData(data);
      })
      .catch((err) => console.error("Failed to fetch options income:", err));
  }, []);

  useEffect(() => {
    if (historicalData.length === 0) return;

    fetch("/api/options/projection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
      .then((res) => res.json())
      .then((response) => {
        if (Array.isArray(response.data) && response.data.length > 0) {
          const hist = response.data.filter((p: any) => p.type === "historical");
          if (hist.length > 0) {
            const avg =
              hist.reduce((sum: number, p: any) => sum + p.amount, 0) / hist.length;
            setAverage(avg);
          } else {
            setAverage(null);
          }
        } else {
          setAverage(null);
        }
        const points: OptionsChartPoint[] = response.data.map((p: any) => ({
          time: `${p.year}-01-01`,
          value: p.amount,
          type: p.type,
        }));
        setChartData(points);
      })
      .catch((err) => console.error("Failed to fetch options projection:", err));
  }, [historicalData, params]);

  const handleSaveHistory = async (newData: OptionsRecord[]) => {
    try {
      const res = await fetch("/api/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newData),
      });
      if (res.ok) {
        const saved = await res.json();
        setHistoricalData(saved);
      }
    } catch (err) {
      console.error("Failed to save options income:", err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-100">Options Income Projections</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 mb-6">
            <h3 className="text-lg font-semibold mb-4 text-slate-200">Projection Chart</h3>
            <OptionsChart data={chartData} average={average ?? undefined} />
          </div>
        </div>
        <div>
          <OptionsSettings params={params} onChange={handleParamsChange} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <OptionsHistory initialData={historicalData} onSave={handleSaveHistory} />
        </div>
      </div>
    </div>
  );
}
