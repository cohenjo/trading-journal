'use client';

import Decimal from 'decimal.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import type { MonthlyMetric } from '@/types/options';
import { formatSignedUsd, monthLabel, toDecimal } from './options-format';

export interface OptionsChartComputedPoint {
  time: string;
  cashFlow: string;
  realizedPnl: string;
  cumulativeCashFlow: string;
  cumulativeRealizedPnl: string;
  varianceGap: string;
  taxEstimate: string;
}

interface Props {
  months: MonthlyMetric[];
}

interface VisibilityState {
  cashFlow: boolean;
  realized: boolean;
  tax: boolean;
}

export function buildOptionsChartSeries(months: MonthlyMetric[]): OptionsChartComputedPoint[] {
  const byMonth = new Map<string, { cashFlow: Decimal; realizedPnl: Decimal }>();

  for (const month of months) {
    const key = month.periodStart;
    const existing = byMonth.get(key) ?? { cashFlow: new Decimal(0), realizedPnl: new Decimal(0) };
    byMonth.set(key, {
      cashFlow: existing.cashFlow.plus(month.cashFlow),
      realizedPnl: existing.realizedPnl.plus(month.realizedPnl),
    });
  }

  let cumulativeCashFlow = new Decimal(0);
  let cumulativeRealizedPnl = new Decimal(0);

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, values]) => {
      cumulativeCashFlow = cumulativeCashFlow.plus(values.cashFlow);
      cumulativeRealizedPnl = cumulativeRealizedPnl.plus(values.realizedPnl);
      const varianceGap = cumulativeCashFlow.minus(cumulativeRealizedPnl);
      const taxEstimate = Decimal.max(cumulativeRealizedPnl, 0).times('0.25');

      return {
        time,
        cashFlow: values.cashFlow.toFixed(2),
        realizedPnl: values.realizedPnl.toFixed(2),
        cumulativeCashFlow: cumulativeCashFlow.toFixed(2),
        cumulativeRealizedPnl: cumulativeRealizedPnl.toFixed(2),
        varianceGap: varianceGap.toFixed(2),
        taxEstimate: taxEstimate.toFixed(2),
      };
    });
}

function isPointLookup(value: unknown): value is Map<unknown, unknown> {
  return value instanceof Map;
}

export default function NetCashFlowVsRealizedChart({ months }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const cashFlowRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const realizedRef = useRef<ISeriesApi<'Line'> | null>(null);
  const taxRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [visibility, setVisibility] = useState<VisibilityState>({ cashFlow: true, realized: true, tax: true });
  const computed = useMemo(() => buildOptionsChartSeries(months), [months]);
  const [hovered, setHovered] = useState<OptionsChartComputedPoint | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height: 360,
      layout: { background: { type: ColorType.Solid, color: '#020617' }, textColor: '#cbd5e1' },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155' },
    });

    const cashFlow = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      priceScaleId: 'right',
    });
    const realized = chart.addSeries(LineSeries, {
      color: '#60a5fa',
      lineWidth: 3,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });
    const tax = chart.addSeries(LineSeries, {
      color: '#94a3b8',
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });

    chartRef.current = chart;
    cashFlowRef.current = cashFlow;
    realizedRef.current = realized;
    taxRef.current = tax;

    chart.subscribeCrosshairMove((param: unknown) => {
      if (!param || typeof param !== 'object') return;
      const pointData = (param as { seriesData?: unknown }).seriesData;
      if (!isPointLookup(pointData)) return;
      const cashPoint = pointData.get(cashFlow) as { time?: Time } | undefined;
      const realizedPoint = pointData.get(realized) as { time?: Time } | undefined;
      const targetTime = String(cashPoint?.time ?? realizedPoint?.time ?? '');
      const match = computed.find((point) => point.time === targetTime);
      if (match) setHovered(match);
    });

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth, height: 360 });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [computed]);

  useEffect(() => {
    const cashData: HistogramData[] = computed.map((point) => ({
      time: point.time as Time,
      value: toDecimal(point.cashFlow).toNumber(),
      color: toDecimal(point.cashFlow).isNegative() ? '#ef4444' : '#22c55e',
    }));
    const realizedData: LineData[] = computed.map((point) => ({
      time: point.time as Time,
      value: toDecimal(point.cumulativeRealizedPnl).toNumber(),
    }));
    const taxData: LineData[] = computed.map((point) => ({
      time: point.time as Time,
      value: toDecimal(point.taxEstimate).toNumber(),
    }));

    cashFlowRef.current?.setData(cashData);
    realizedRef.current?.setData(realizedData);
    taxRef.current?.setData(taxData);
    chartRef.current?.timeScale().fitContent();
    setHovered(computed.at(-1) ?? null);
  }, [computed]);

  useEffect(() => {
    cashFlowRef.current?.applyOptions({ visible: visibility.cashFlow });
    realizedRef.current?.applyOptions({ visible: visibility.realized });
    taxRef.current?.applyOptions({ visible: visibility.tax });
  }, [visibility]);

  const tooltip = hovered ?? computed.at(-1) ?? null;

  return (
    <section className="rounded-3xl border border-slate-700/80 bg-slate-950/80 p-5" data-testid="net-cash-flow-chart">
      <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Income quality</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-100">Net Cash Flow vs Realized P&amp;L</h2>
          <p className="mt-2 max-w-2xl text-xs text-slate-500">
            Includes synthetic assignment adjustments: when an option is assigned, the unrealized loss (strike − market) × shares is recorded as cash flow even though the underlying stock leg itself is not tracked.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {([
            ['cashFlow', 'Monthly cash flow', 'bg-emerald-500'],
            ['realized', 'Cumulative realized P&L', 'bg-blue-400'],
            ['tax', '25% tax estimate', 'bg-slate-400'],
          ] as const).map(([key, label, swatch]) => (
            <button
              key={key}
              type="button"
              onClick={() => setVisibility((current) => ({ ...current, [key]: !current[key] }))}
              className={`rounded-full border px-3 py-1.5 ${visibility[key] ? 'border-slate-500 text-slate-100' : 'border-slate-800 text-slate-500'}`}
            >
              <span className={`mr-2 inline-block h-2 w-2 rounded-full ${swatch}`} />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <div ref={containerRef} className="h-[360px] w-full" />
        {tooltip && (
          <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-slate-700 bg-slate-950/95 p-3 text-xs shadow-xl" data-testid="options-chart-tooltip">
            <p className="font-semibold text-slate-100">{monthLabel(tooltip.time)}</p>
            <p className="mt-1 text-emerald-300">Cash flow: {formatSignedUsd(tooltip.cashFlow)}</p>
            <p className="text-blue-300">Realized P&amp;L: {formatSignedUsd(tooltip.cumulativeRealizedPnl)}</p>
            <p className="text-amber-200">Variance gap: {formatSignedUsd(tooltip.varianceGap)}</p>
          </div>
        )}
      </div>
    </section>
  );
}
