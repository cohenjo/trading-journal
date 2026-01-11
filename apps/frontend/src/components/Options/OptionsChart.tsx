"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  HistogramSeries,
  AreaSeries,
} from "lightweight-charts";

export type OptionsChartPoint = {
  time: string; // YYYY-MM-DD
  value: number;
  type: "historical" | "projected";
};

type Props = {
  data: OptionsChartPoint[];
  average?: number | null;
};

export default function OptionsChart({ data, average }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const histSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const projSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const priceLinesRef = useRef<any[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#020617" },
        textColor: "#e2e8f0",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      rightPriceScale: {
        borderColor: "#1e293b",
      },
      timeScale: {
        borderColor: "#1e293b",
      },
    });

    const histSeries = chart.addSeries(HistogramSeries, {
      color: "#22c55e",
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });

    const projSeries = chart.addSeries(AreaSeries, {
      lineColor: "#38bdf8",
      topColor: "rgba(56, 189, 248, 0.4)",
      bottomColor: "rgba(15, 23, 42, 0.0)",
    });

    chartRef.current = chart;
    histSeriesRef.current = histSeries;
    projSeriesRef.current = projSeries;

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      chartRef.current.applyOptions({ width: clientWidth, height: clientHeight });
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!histSeriesRef.current || !projSeriesRef.current || !chartRef.current) return;

    const historical = data.filter((p) => p.type === "historical");
    const projected = data.filter((p) => p.type === "projected");

    histSeriesRef.current.setData(historical);
    projSeriesRef.current.setData(projected);

    // Clear previous price lines
    priceLinesRef.current.forEach((line) => {
      try {
        projSeriesRef.current?.removePriceLine(line);
      } catch {
        // ignore
      }
    });
    priceLinesRef.current = [];

    if (historical.length > 0) {
      const lastHist = historical[historical.length - 1];
      const currentLine = projSeriesRef.current.createPriceLine({
        price: lastHist.value,
        color: "#22c55e",
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: "Current",
      });
      priceLinesRef.current.push(currentLine);
    }

    if (projected.length > 0) {
      const lastProj = projected[projected.length - 1];
      const finalLine = projSeriesRef.current.createPriceLine({
        price: lastProj.value,
        color: "#38bdf8",
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: "Final",
      });
      priceLinesRef.current.push(finalLine);
    }

    // Average line across the chart, using provided average when available
    if (typeof average === "number") {
      const avg = average;
      const avgLine = projSeriesRef.current.createPriceLine({
        price: avg,
        color: "#f97316",
        lineStyle: LineStyle.Solid,
        lineWidth: 1,
        axisLabelVisible: true,
        title: "Average",
      });
      priceLinesRef.current.push(avgLine);
    }

    chartRef.current.timeScale().fitContent();
  }, [data, average]);

  return <div ref={containerRef} className="w-full h-72" />;
}
