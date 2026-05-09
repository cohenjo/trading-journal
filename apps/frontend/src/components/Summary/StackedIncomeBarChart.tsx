"use client";

import { createChart, IChartApi, ISeriesApi, ColorType, HistogramSeries, HistogramData, Time } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

export type YearlyIncomeData = {
  year: number;
  optionsIncome: number;
  dividendsIncome: number;
  bondsIncome: number;
  isProjected: boolean;
};

type Props = {
  data: YearlyIncomeData[];
  cutoffYear?: number;
};

type TooltipData = {
  year: string;
  options: number;
  dividends: number;
  bonds: number;
  total: number;
  isProjected: boolean;
};

export default function StackedIncomeBarChart({ data, cutoffYear }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const optionsSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const dividendsSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bondsSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const currencyFormatter = (price: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(price);

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
        timeVisible: false,
      },
      rightPriceScale: {
        borderColor: "#1e293b",
      },
    });

    // Create three histogram series for stacked bars
    // We'll render them from bottom to top: Options (base) → Dividends → Bonds
    
    // 1. Options (bottom layer - full height)
    optionsSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: "#f59e0b", // Amber 500
      priceFormat: { type: 'custom', formatter: currencyFormatter, minMove: 1 },
    });

    // 2. Dividends (middle layer - on top of options)
    dividendsSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: "#10b981", // Emerald 500
      priceFormat: { type: 'custom', formatter: currencyFormatter, minMove: 1 },
    });

    // 3. Bonds (top layer)
    bondsSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: "#3b82f6", // Blue 500
      priceFormat: { type: 'custom', formatter: currencyFormatter, minMove: 1 },
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
    if (!chartRef.current || !optionsSeriesRef.current || !dividendsSeriesRef.current || !bondsSeriesRef.current) return;

    // For stacked bars, we need to stack the values
    // Bottom series shows cumulative from 0
    // Middle series shows cumulative from 0 to (options + dividends)
    // Top series shows total (options + dividends + bonds)
    
    const optionsData: HistogramData<Time>[] = [];
    const dividendsData: HistogramData<Time>[] = [];
    const bondsData: HistogramData<Time>[] = [];

    for (const point of data) {
      const time = `${point.year}-01-01` as Time;
      const optionsValue = point.optionsIncome;
      const dividendsValue = point.optionsIncome + point.dividendsIncome;
      const bondsValue = point.optionsIncome + point.dividendsIncome + point.bondsIncome;

      // Adjust opacity for projected years
      const baseColor = point.isProjected ? 0.4 : 1.0;

      optionsData.push({ 
        time, 
        value: optionsValue,
        color: `rgba(245, 158, 11, ${baseColor * 0.8})` // amber with opacity
      });
      
      dividendsData.push({ 
        time, 
        value: dividendsValue,
        color: `rgba(16, 185, 129, ${baseColor * 0.8})` // emerald with opacity
      });
      
      bondsData.push({ 
        time, 
        value: bondsValue,
        color: `rgba(59, 130, 246, ${baseColor * 0.8})` // blue with opacity
      });
    }

    optionsSeriesRef.current.setData(optionsData);
    dividendsSeriesRef.current.setData(dividendsData);
    bondsSeriesRef.current.setData(bondsData);

    chartRef.current.timeScale().fitContent();

    // Set up crosshair move handler for tooltip
    chartRef.current.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setTooltip(null);
        return;
      }

      const year = String(param.time).slice(0, 4);
      const dataPoint = data.find(d => d.year === Number(year));
      
      if (dataPoint) {
        setTooltip({
          year,
          options: dataPoint.optionsIncome,
          dividends: dataPoint.dividendsIncome,
          bonds: dataPoint.bondsIncome,
          total: dataPoint.optionsIncome + dataPoint.dividendsIncome + dataPoint.bondsIncome,
          isProjected: dataPoint.isProjected,
        });
      }
    });
  }, [data, cutoffYear]);

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-[400px]" />
      
      {tooltip && (
        <div className="absolute top-4 left-4 bg-slate-800/95 border border-slate-700 rounded-lg p-3 text-sm shadow-lg z-10">
          <div className="font-semibold text-slate-200 mb-2">
            {tooltip.year} {tooltip.isProjected && <span className="text-amber-400 text-xs">(Projected)</span>}
          </div>
          <div className="space-y-1 text-slate-300">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                <div className="w-3 h-3 bg-amber-500 rounded-sm"></div>
                Options
              </span>
              <span className="font-mono">{currencyFormatter(tooltip.options)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div>
                Dividends
              </span>
              <span className="font-mono">{currencyFormatter(tooltip.dividends)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-sm"></div>
                Bonds
              </span>
              <span className="font-mono">{currencyFormatter(tooltip.bonds)}</span>
            </div>
            <div className="pt-2 mt-2 border-t border-slate-600 flex justify-between font-semibold">
              <span>Total</span>
              <span className="font-mono">{currencyFormatter(tooltip.total)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
