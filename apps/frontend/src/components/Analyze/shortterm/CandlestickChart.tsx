"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import type { OHLCVBar } from "./hooks/usePriceHistory";

/* ── Client-side indicator calculations ──────────────────────────── */

/** Compute Exponential Moving Average per bar. Returns null for bars before convergence. */
function computeEMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return result;

  // Seed with SMA of the first `period` closes
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  let ema = sum / period;
  result[period - 1] = ema;

  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

/** Compute Bollinger Bands (SMA ± stdDev multiplier) per bar. */
function computeBollinger(
  closes: number[],
  period = 20,
  stdDevMult = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const len = closes.length;
  const upper: (number | null)[] = new Array(len).fill(null);
  const middle: (number | null)[] = new Array(len).fill(null);
  const lower: (number | null)[] = new Array(len).fill(null);

  for (let i = period - 1; i < len; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const sma = sum / period;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - sma) ** 2;
    const sd = Math.sqrt(sqSum / period);

    middle[i] = sma;
    upper[i] = sma + stdDevMult * sd;
    lower[i] = sma - stdDevMult * sd;
  }
  return { upper, middle, lower };
}

/* ── Chart component ─────────────────────────────────────────────── */

interface CandlestickChartProps {
  priceData: OHLCVBar[];
}

const VISIBLE_BARS = 25;

export default function CandlestickChart({ priceData }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || priceData.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

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
    chartRef.current = chart;

    // ── Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleSeries.setData(
      priceData.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }))
    );

    // ── Volume histogram
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(
      priceData.map((bar) => ({
        time: bar.time,
        value: bar.volume,
        color: bar.close >= bar.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      }))
    );

    // ── Compute indicators from price data
    const closes = priceData.map((b) => b.close);
    const ema50 = computeEMA(closes, 50);
    const ema200 = computeEMA(closes, 200);
    const bollinger = computeBollinger(closes);

    type LinePoint = { time: string; value: number };
    const toSeries = (values: (number | null)[]): LinePoint[] =>
      priceData.reduce<LinePoint[]>((acc, bar, i) => {
        if (values[i] != null) acc.push({ time: bar.time, value: values[i] as number });
        return acc;
      }, []);

    // EMA 50
    const ema50Data = toSeries(ema50);
    if (ema50Data.length > 0) {
      const ema50Series = chart.addSeries(LineSeries, {
        color: "#3b82f6",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ema50Series.setData(ema50Data);
    }

    // EMA 200
    const ema200Data = toSeries(ema200);
    if (ema200Data.length > 0) {
      const ema200Series = chart.addSeries(LineSeries, {
        color: "#f97316",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ema200Series.setData(ema200Data);
    }

    // Bollinger Bands
    const bbUpperData = toSeries(bollinger.upper);
    const bbMiddleData = toSeries(bollinger.middle);
    const bbLowerData = toSeries(bollinger.lower);

    if (bbUpperData.length > 0) {
      const bbUpperSeries = chart.addSeries(LineSeries, {
        color: "#9ca3af",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbUpperSeries.setData(bbUpperData);
    }

    if (bbLowerData.length > 0) {
      const bbLowerSeries = chart.addSeries(LineSeries, {
        color: "#9ca3af",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbLowerSeries.setData(bbLowerData);
    }

    if (bbMiddleData.length > 0) {
      const bbMiddleSeries = chart.addSeries(LineSeries, {
        color: "#ffffff",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbMiddleSeries.setData(bbMiddleData);
    }

    // Zoom to last ~25 bars so the chart feels like a 1-month view
    const totalBars = priceData.length;
    if (totalBars > VISIBLE_BARS) {
      chart.timeScale().setVisibleLogicalRange({
        from: totalBars - VISIBLE_BARS,
        to: totalBars - 1,
      });
    } else {
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [priceData]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-amber-400 mb-3">📈 Tactical Chart — Daily</h3>
      <div className="flex gap-4 text-xs text-slate-500 mb-2">
        <span className="flex items-center gap-1">
          <span className="w-4 h-px bg-blue-500 inline-block" style={{ borderTop: "1px dashed #3b82f6" }} /> EMA 50
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-px bg-orange-500 inline-block" style={{ borderTop: "1px dashed #f97316" }} /> EMA 200
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-px bg-gray-400 inline-block" /> Bollinger
        </span>
      </div>
      <div ref={containerRef} className="w-full h-80" />
    </div>
  );
}
