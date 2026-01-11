"use client";

import { createChart, IChartApi, ISeriesApi, ColorType, SeriesMarker, AreaSeries, createSeriesMarkers, ISeriesMarkersPluginApi } from "lightweight-charts";
import { useEffect, useRef } from "react";

export type StackedChartData = {
  time: string;
  ladder: number;
  dividends: number;
  options: number;
};

type Props = {
  data: StackedChartData[];
  cutoffYear?: number;
};

export default function StackedIncomeChart({ data, cutoffYear }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  
  const totalSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const ladderDivsSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const ladderSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<string> | null>(null);

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
    });

    // 1. Total (Ladder + Divs + Options) - Drawn first (background layer)
    // Represents Options when others are drawn on top
    totalSeriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: "#f59e0b", // Amber 500
      topColor: "rgba(245, 158, 11, 0.4)",
      bottomColor: "rgba(245, 158, 11, 0.0)",
      lineWidth: 2,
    });
    markersPluginRef.current = createSeriesMarkers(totalSeriesRef.current, []);

    // 2. Ladder + Divs - Drawn second
    // Represents Dividends when Ladder is drawn on top
    ladderDivsSeriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: "#10b981", // Emerald 500
      topColor: "rgba(16, 185, 129, 0.4)",
      bottomColor: "rgba(16, 185, 129, 0.0)",
      lineWidth: 2,
    });

    // 3. Ladder - Drawn last (top layer)
    // Represents Ladder
    ladderSeriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: "#3b82f6", // Blue 500
      topColor: "rgba(59, 130, 246, 0.4)",
      bottomColor: "rgba(59, 130, 246, 0.0)",
      lineWidth: 2,
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
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !totalSeriesRef.current || !ladderDivsSeriesRef.current || !ladderSeriesRef.current) return;

    const totalData = data.map(d => ({ time: d.time, value: d.ladder + d.dividends + d.options }));
    const ladderDivsData = data.map(d => ({ time: d.time, value: d.ladder + d.dividends }));
    const ladderData = data.map(d => ({ time: d.time, value: d.ladder }));

    totalSeriesRef.current.setData(totalData);
    ladderDivsSeriesRef.current.setData(ladderDivsData);
    ladderSeriesRef.current.setData(ladderData);

    // Cutoff Marker
    const markers: SeriesMarker<string>[] = [];
    if (cutoffYear && data.length > 0) {
      const cutoffTime = `${cutoffYear}-01-01`;
      const point = data.find(d => d.time === cutoffTime);
      if (point) {
        markers.push({
          time: cutoffTime,
          position: "aboveBar",
          color: "#ef4444",
          shape: "arrowDown",
          text: "Cutoff",
        });
      }
    }
    if (markersPluginRef.current) {
      markersPluginRef.current.setMarkers(markers);
    }

    chartRef.current.timeScale().fitContent();
  }, [data, cutoffYear]);

  return <div ref={containerRef} className="w-full h-[400px]" />;
}
