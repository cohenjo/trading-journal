"use client";
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from "react";
import DividendChart, { DividendChartPoint } from "../../../components/Dividends/DividendChart";
import DividendHistory, { DividendRecord } from "../../../components/Dividends/DividendHistory";
import DividendSettings, { ProjectionParams } from "../../../components/Dividends/DividendSettings";
import { useSettings } from "../../settings/SettingsContext";

export default function DividendEstimationsPage() {
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

    // Projection is computed client-side now that the legacy FastAPI XLSX
    // endpoints have been removed from the frontend path.
    useEffect(() => {
        const historicalPoints: DividendChartPoint[] = historicalData.map((record) => ({
            time: `${record.year}-01-01`,
            value: record.amount,
            type: 'historical',
        }));

        if (historicalData.length === 0) {
            setChartData([]);
            return;
        }

        const sortedHistory = [...historicalData].sort((a, b) => a.year - b.year);
        const lastHistorical = sortedHistory[sortedHistory.length - 1];
        const projectedPoints: DividendChartPoint[] = [];
        let projectedAmount = lastHistorical.amount;

        for (let year = lastHistorical.year + 1; year <= params.final_year; year += 1) {
            const reinvestedGrowth = params.yield_rate * params.reinvest_rate;
            projectedAmount *= 1 + params.growth_rate + reinvestedGrowth;
            projectedPoints.push({
                time: `${year}-01-01`,
                value: Math.round(projectedAmount * 100) / 100,
                type: 'projected',
            });
        }

        setChartData([...historicalPoints, ...projectedPoints]);
    }, [historicalData, params]);

    const handleSaveHistory = (newData: DividendRecord[]) => {
        setHistoricalData(newData);
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
