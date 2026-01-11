"use client";

import { createChart, IChartApi, ISeriesApi, AreaSeries, LineSeries } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { useSettings } from "@/app/settings/SettingsContext";
import type { IncomePoint } from "./types";

type ExpectedIncomeChartProps = {
  data: IncomePoint[];
};

export function ExpectedIncomeChart({ data }: ExpectedIncomeChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const targetLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const { settings } = useSettings();

  useEffect(() => {
    if (!containerRef.current) return;

    chartRef.current = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { color: "#1a1a1a" },
        textColor: "#d1d1d1",
      },
      grid: {
        vertLines: { color: "#2a2a2a" },
        horzLines: { color: "#2a2a2a" },
      },
      rightPriceScale: {
        borderColor: "#2a2a2a",
      },
      timeScale: {
        borderColor: "#2a2a2a",
      },
    });

    seriesRef.current = chartRef.current.addSeries(AreaSeries, {
      topColor: "rgba(33, 150, 243, 0.56)",
      bottomColor: "rgba(33, 150, 243, 0.04)",
      lineColor: "rgba(33, 150, 243, 1)",
      lineWidth: 2,
    });

    // Global target income line (default 40k per year)
    targetLineRef.current = chartRef.current.addSeries(LineSeries, {
      color: "rgba(239, 68, 68, 0.9)",
      lineWidth: 1,
      lineStyle: 2,
    });

    const resize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.resize(containerRef.current.clientWidth, 220);
      }
    };

    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      targetLineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    const seriesData = data.map((p) => ({ time: p.date, value: p.value }));
    seriesRef.current.setData(seriesData);

    if (data.length > 0) {
      const first = data[0];
      const last = data[data.length - 1];
      const timeScale = chartRef.current.timeScale();
      timeScale.setVisibleRange({ from: first.date, to: last.date });

      // Set target income line across the visible years using user setting
      if (targetLineRef.current) {
        targetLineRef.current.setData([
          { time: first.date, value: settings.targetIncome },
          { time: last.date, value: settings.targetIncome },
        ]);
      }
    }
  }, [data, settings.targetIncome]);

  return <div ref={containerRef} className="w-full h-full" />;
}
