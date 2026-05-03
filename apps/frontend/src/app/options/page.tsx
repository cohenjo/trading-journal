"use client";

import { createOptionsRecord, getOptionsProjection, listOptionsRecords } from './actions';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    let cancelled = false;

    async function loadOptionsRecords() {
      setLoading(true);
      setError(null);

      try {
        const data = await listOptionsRecords();
        if (!cancelled) setHistoricalData(data);
      } catch (err) {
        console.error("Failed to load options income:", err);
        if (!cancelled) setError("Failed to load options data. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadOptionsRecords();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProjection() {
      try {
        const response = await getOptionsProjection(params);
        if (cancelled) return;

        const hist = response.data.filter((point) => point.type === "historical");
        setAverage(
          hist.length > 0
            ? hist.reduce((sum, point) => sum + point.amount, 0) / hist.length
            : null,
        );

        const points: OptionsChartPoint[] = response.data.map((point) => ({
          time: `${point.year}-01-01`,
          value: point.amount,
          type: point.type,
        }));
        setChartData(points);
      } catch (err) {
        console.error("Failed to fetch options projection:", err);
      }
    }

    void loadProjection();
    return () => {
      cancelled = true;
    };
  }, [historicalData, params]);

  const handleSaveHistory = async (newData: OptionsRecord[]) => {
    try {
      const result = await createOptionsRecord(newData);
      if (result.ok) {
        setHistoricalData(result.records);
      } else {
        console.error("Failed to save options income:", result.error);
      }
    } catch (err) {
      console.error("Failed to save options income:", err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-100">Options Income Projections</h1>

      {error && (
        <div className="bg-red-900/50 border border-red-800 text-red-200 p-4 rounded mb-6">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-400 animate-pulse">Loading options data...</div>
        </div>
      )}

      {!loading && (
        <>
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
      </>
      )}
    </div>
  );
}
