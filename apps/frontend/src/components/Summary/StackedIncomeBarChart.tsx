"use client";

import { createChart, IChartApi, ISeriesApi, ColorType, HistogramSeries, HistogramData, Time } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

/**
 * Single source of truth for income-series colors.
 * Both chart bars and legend swatches in summary/page.tsx reference this constant
 * so they can never drift apart.
 *
 * Hex values use Tailwind palette tokens — could be centralized into a
 * design-token file later if the project adopts a token system.
 */
export const SERIES_COLORS = {
  options:      "#f59e0b", // Tailwind amber-500 (Options — Cumulative Cash Flow)
  dividends:    "#10b981", // Tailwind emerald-500 (Dividends — Projected/Estimated)
  bonds:        "#3b82f6", // Tailwind blue-500 (Bond Ladder — Scheduled)
  bondInterest: "#a855f7", // Tailwind purple-500 (Bond Interest — Realized)
} as const;

/** Convert a hex color + alpha into an rgba() string for opacity variants. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type YearlyIncomeData = {
  year: number;
  optionsIncome: number;
  dividendsIncome: number;
  bondsIncome: number;
  /** Realized bond coupon interest (4th stacked series). Optional for backward compat. */
  bondInterestIncome?: number;
  isProjected: boolean;
  dividendsSource?: 'estimation' | 'projection';
  /** Distinguishes projected options income from historical actuals. */
  optionsSource?: 'actual' | 'projection';
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
  bondInterest: number;
  total: number;
  isProjected: boolean;
  dividendsSource?: 'estimation' | 'projection';
};

export default function StackedIncomeBarChart({ data, cutoffYear }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const optionsSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const dividendsSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bondsSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bondInterestSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
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

    // Create four histogram series for stacked bars.
    // Render order: the LAST series added is drawn on top.
    // Stack bottom-to-top: bond interest (violet) → bonds (blue) → dividends (green) → options (amber).
    // Each series holds a cumulative value from 0; later series "paint over" earlier ones.

    // 0. Bond Interest Realized (bottommost layer)
    bondInterestSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: SERIES_COLORS.bondInterest,
      priceFormat: { type: 'custom', formatter: currencyFormatter, minMove: 1 },
    });

    // 1. Bonds (second layer)
    bondsSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: SERIES_COLORS.bonds,
      priceFormat: { type: 'custom', formatter: currencyFormatter, minMove: 1 },
    });

    // 2. Dividends (third layer)
    dividendsSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: SERIES_COLORS.dividends,
      priceFormat: { type: 'custom', formatter: currencyFormatter, minMove: 1 },
    });

    // 3. Options (top layer — drawn last)
    optionsSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: SERIES_COLORS.options,
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
    if (!chartRef.current || !optionsSeriesRef.current || !dividendsSeriesRef.current || !bondsSeriesRef.current || !bondInterestSeriesRef.current) return;

    // Stacked bar construction (cumulative heights):
    // Bottom series: bondInterest (violet)
    // Layer 2: bondInterest + bonds (blue)
    // Layer 3: bondInterest + bonds + dividends (green)
    // Top series: bondInterest + bonds + dividends + options (amber)

    const bondInterestData: HistogramData<Time>[] = [];
    const optionsData: HistogramData<Time>[] = [];
    const dividendsData: HistogramData<Time>[] = [];
    const bondsData: HistogramData<Time>[] = [];

    for (const point of data) {
      const time = `${point.year}-01-01` as Time;
      const bondInterestAmount = point.bondInterestIncome ?? 0;
      const bondsValue = bondInterestAmount + point.bondsIncome;
      const dividendsValue = bondsValue + point.dividendsIncome;
      const optionsValue = dividendsValue + point.optionsIncome;

      // Projected years are dimmed to 40 % opacity; actuals use 80 %.
      const opacity = point.isProjected ? 0.4 * 0.8 : 0.8;

      bondInterestData.push({
        time,
        value: bondInterestAmount,
        color: hexToRgba(SERIES_COLORS.bondInterest, opacity),
      });

      bondsData.push({
        time,
        value: bondsValue,
        color: hexToRgba(SERIES_COLORS.bonds, opacity),
      });

      dividendsData.push({
        time,
        value: dividendsValue,
        color: hexToRgba(SERIES_COLORS.dividends, opacity),
      });

      optionsData.push({
        time,
        value: optionsValue,
        color: hexToRgba(SERIES_COLORS.options, opacity),
      });
    }

    bondInterestSeriesRef.current.setData(bondInterestData);
    bondsSeriesRef.current.setData(bondsData);
    dividendsSeriesRef.current.setData(dividendsData);
    optionsSeriesRef.current.setData(optionsData);

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
        const bondInterestIncome = dataPoint.bondInterestIncome ?? 0;
        setTooltip({
          year,
          options: dataPoint.optionsIncome,
          dividends: dataPoint.dividendsIncome,
          bonds: dataPoint.bondsIncome,
          bondInterest: bondInterestIncome,
          total: dataPoint.optionsIncome + dataPoint.dividendsIncome + dataPoint.bondsIncome + bondInterestIncome,
          isProjected: dataPoint.isProjected,
          dividendsSource: dataPoint.dividendsSource,
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
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: SERIES_COLORS.options }}></div>
                Options
              </span>
              <span className="font-mono">{currencyFormatter(tooltip.options)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: SERIES_COLORS.dividends }}></div>
                Dividends
                {tooltip.dividendsSource === 'estimation' && (
                  <span className="text-xs text-emerald-400">(est.)</span>
                )}
              </span>
              <span className="font-mono">{currencyFormatter(tooltip.dividends)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: SERIES_COLORS.bonds }}></div>
                Bonds
              </span>
              <span className="font-mono">{currencyFormatter(tooltip.bonds)}</span>
            </div>
            {tooltip.bondInterest > 0 && (
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: SERIES_COLORS.bondInterest }}></div>
                  Bond Interest
                </span>
                <span className="font-mono">{currencyFormatter(tooltip.bondInterest)}</span>
              </div>
            )}
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
