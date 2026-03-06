"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import type { PricePoint } from "./hooks/usePriceHistory";

interface PriceChartWithFairValueProps {
  priceData: PricePoint[];
  fairValue: number | null;
  currentPrice: number;
  loading: boolean;
  period: string;
  onPeriodChange: (period: string) => void;
}

const periods = [
  { label: "1Y", value: "1y" },
  { label: "5Y", value: "5y" },
];

export default function PriceChartWithFairValue({
  priceData,
  fairValue,
  currentPrice,
  loading,
  period,
  onPeriodChange,
}: PriceChartWithFairValueProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

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
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale: { borderColor: "#1e293b" },
    });

    const series = chart.addSeries(LineSeries, {
      color: "#38bdf8",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    chartRef.current = chart;
    seriesRef.current = series;

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
    if (!seriesRef.current || !chartRef.current || priceData.length === 0) return;

    const lineData = priceData.map((p) => ({ time: p.time, value: p.close }));
    seriesRef.current.setData(lineData);

    // Remove existing price lines by re-creating series options
    if (fairValue !== null && fairValue > 0) {
      const isUndervalued = fairValue > currentPrice;
      seriesRef.current.createPriceLine({
        price: fairValue,
        color: isUndervalued ? "#22c55e" : "#ef4444",
        lineStyle: LineStyle.Dashed,
        lineWidth: 2,
        axisLabelVisible: true,
        title: `DCF Fair Value: $${fairValue.toFixed(2)}`,
      });
    }

    chartRef.current.timeScale().fitContent();
  }, [priceData, fairValue, currentPrice]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Price & Fair Value</h3>
        <div className="flex gap-1">
          {periods.map((p) => (
            <button
              key={p.value}
              onClick={() => onPeriodChange(p.value)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                period === p.value
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="w-full h-72 bg-slate-800/50 rounded-lg animate-pulse" />
      ) : (
        <div ref={containerRef} className="w-full h-72" />
      )}
    </div>
  );
}
