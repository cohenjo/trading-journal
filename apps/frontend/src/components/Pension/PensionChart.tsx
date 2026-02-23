"use client";

import { createChart, IChartApi, ISeriesApi, ColorType, SeriesMarker, AreaSeries, createSeriesMarkers, ISeriesMarkersPluginApi, LineStyle } from "lightweight-charts";
import { useEffect, useRef } from "react";

export type PensionDataPoint = {
    date: string;
    [key: string]: string | number;
};

type AccountDef = {
    owner: string;
    name: string;
};

type MilestoneDef = {
    owner: string;
    name: string;
    date: string;
    year: number;
};

type Props = {
    history: PensionDataPoint[];
    projections: PensionDataPoint[];
    accounts: AccountDef[];
    milestones: MilestoneDef[];
};

const COLORS = [
    { line: "#3b82f6", bg: "rgba(59, 130, 246, 0.4)" }, // Blue
    { line: "#10b981", bg: "rgba(16, 185, 129, 0.4)" }, // Emerald
    { line: "#f59e0b", bg: "rgba(245, 158, 11, 0.4)" }, // Amber
    { line: "#8b5cf6", bg: "rgba(139, 92, 246, 0.4)" },  // Violet
    { line: "#ec4899", bg: "rgba(236, 72, 153, 0.4)" }   // Pink
];

export default function PensionChart({ history, projections, accounts, milestones }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    const historySeriesRefs = useRef<ISeriesApi<"Area">[]>([]);
    const projSeriesRefs = useRef<ISeriesApi<"Area">[]>([]);
    const markersPluginRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: "#020617" }, // slate-950
                textColor: "#e2e8f0", // slate-200
            },
            grid: {
                vertLines: { color: "#1e293b" }, // slate-800
                horzLines: { color: "#1e293b" },
            },
            width: containerRef.current.clientWidth,
            height: 400,
            timeScale: {
                borderColor: "#1e293b",
            },
            rightPriceScale: {
                borderColor: "#1e293b",
            },
            localization: {
                priceFormatter: (price: number) => {
                    if (price >= 1000000) {
                        return (price / 1000000).toFixed(2) + 'M';
                    }
                    if (price >= 1000) {
                        return (price / 1000).toFixed(0) + 'K';
                    }
                    return price.toString();
                }
            }
        });

        chartRef.current = chart;

        const handleResize = () => {
            if (containerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
            }
        };

        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            chart.remove();
            chartRef.current = null;
            historySeriesRefs.current = [];
            projSeriesRefs.current = [];
        };
    }, []);

    useEffect(() => {
        if (!chartRef.current) return;
        const chart = chartRef.current;

        // Clean up old series safely
        historySeriesRefs.current.forEach(s => {
            if (s) try { chart.removeSeries(s); } catch (e) { }
        });
        projSeriesRefs.current.forEach(s => {
            if (s) try { chart.removeSeries(s); } catch (e) { }
        });
        historySeriesRefs.current = [];
        projSeriesRefs.current = [];

        // Sort accounts to maintain consistent stacking order
        const sortedAccounts = [...accounts].sort((a, b) => `${a.owner}_${a.name}`.localeCompare(`${b.owner}_${b.name}`));

        // We draw from top to bottom, so the 'Total' (all accounts) is drawn first so it sits behind the lower accounts.
        // Therefore, we iterate reversed for creating series, but compute cumulative sums.

        // Create Series
        for (let i = sortedAccounts.length - 1; i >= 0; i--) {
            const colorIdx = i % COLORS.length;

            // History Series (Solid)
            const hSeries = chart.addSeries(AreaSeries, {
                lineColor: COLORS[colorIdx].line,
                topColor: COLORS[colorIdx].bg,
                bottomColor: "rgba(0,0,0,0)",
                lineWidth: 2,
            });
            historySeriesRefs.current.push(hSeries);

            // Projection Series (Dashed)
            const pSeries = chart.addSeries(AreaSeries, {
                lineColor: COLORS[colorIdx].line,
                lineStyle: LineStyle.Dashed,
                topColor: COLORS[colorIdx].bg.replace('0.4', '0.15'), // Lighter fill for projection
                bottomColor: "rgba(0,0,0,0)",
                lineWidth: 2,
            });
            projSeriesRefs.current.push(pSeries);

            // If it's the top layer (i.e. 'Total'), we add the markers plugin to the projection series
            // because retirement milestones are in the future
            if (i === sortedAccounts.length - 1) {
                markersPluginRef.current = createSeriesMarkers(pSeries, []);
            }
        }

        // Prepare Data
        const computeStack = (dataPoint: PensionDataPoint, upToIndex: number) => {
            let sum = 0;
            // Sum up to index (inclusive)
            for (let j = 0; j <= upToIndex; j++) {
                const acc = sortedAccounts[j];
                const key = `${acc.owner}_${acc.name}`;
                sum += Number(dataPoint[key] || 0);
            }
            return sum;
        };

        // Populate Data (Note: refs were pushed in reverse order!)
        // So refs[0] corresponds to the top layer (upToIndex = sortedAccounts.length - 1)
        for (let idx = 0; idx < sortedAccounts.length; idx++) {
            const upToIndex = sortedAccounts.length - 1 - idx;

            let hasStarted = false;
            const hData = history.reduce((acc, d) => {
                const val = computeStack(d, upToIndex);
                if (val > 0) hasStarted = true;
                if (hasStarted) {
                    acc.push({ time: d.date, value: val });
                }
                return acc;
            }, [] as any[]);

            const pData = projections.map(d => ({
                time: d.date,
                value: computeStack(d, upToIndex)
            }));

            // Connect projection to the last history point for seamless line
            if (history.length > 0 && pData.length > 0) {
                pData.unshift(hData[hData.length - 1]);
            }

            historySeriesRefs.current[idx].setData(hData);
            projSeriesRefs.current[idx].setData(pData);
        }

        // Add Markers for milestones
        const markers: SeriesMarker<any>[] = [];
        milestones.forEach(m => {
            markers.push({
                time: m.date.startsWith(m.year.toString()) ? m.date : `${m.year}-01-01`, // Rough approximation if date is weird
                position: "aboveBar",
                color: "#10b981", // Emerald
                shape: "arrowDown",
                text: `${m.owner}'s Retirement`,
            });
        });

        if (markersPluginRef.current) {
            markersPluginRef.current.setMarkers(markers);
        }

        chart.timeScale().fitContent();

    }, [history, projections, accounts, milestones]);

    return (
        <div className="w-full h-full min-h-[400px]" ref={containerRef} />
    );
}
