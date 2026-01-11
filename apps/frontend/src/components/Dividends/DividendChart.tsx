"use client";

import { createChart, IChartApi, ISeriesApi, AreaSeries, HistogramSeries } from "lightweight-charts";
import { useEffect, useRef } from "react";

export type DividendChartPoint = {
  time: string;
  value: number;
  type: 'historical' | 'projected';
};

type DividendChartProps = {
  data: DividendChartPoint[];
  cutoffYear: number;
};

export default function DividendChart({ data, cutoffYear }: DividendChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const historicalSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const projectedSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const priceLinesRef = useRef<any[]>([]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    chartRef.current = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: "#1a1a1a" },
        textColor: "#d1d1d1",
      },
      grid: {
        vertLines: { color: "#2a2a2a" },
        horzLines: { color: "#2a2a2a" },
      },
      timeScale: {
        borderVisible: false,
      },
    });

    // Historical Data - Histogram
    historicalSeriesRef.current = chartRef.current.addSeries(HistogramSeries, {
      color: "#26a69a",
      priceFormat: {
        type: "volume",
      },
    });

    // Projected Data - Area
    projectedSeriesRef.current = chartRef.current.addSeries(AreaSeries, {
      topColor: "rgba(33, 150, 243, 0.56)",
      bottomColor: "rgba(33, 150, 243, 0.04)",
      lineColor: "rgba(33, 150, 243, 1)",
      lineWidth: 2,
    });

    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.resize(chartContainerRef.current.clientWidth, 400);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !historicalSeriesRef.current || !projectedSeriesRef.current) return;

    const historicalData = data
      .filter((d) => d.type === "historical")
      .map((d) => ({ time: d.time, value: d.value }));

    const projectedData = data
      .filter((d) => d.type === "projected")
      .map((d) => ({ time: d.time, value: d.value }));

    // If we have projected data, we might want to connect it to the last historical point
    // But for now let's keep them separate or maybe overlap the last historical point
    if (historicalData.length > 0 && projectedData.length > 0) {
        // Add the last historical point to projected to make it continuous if needed
        // But since one is histogram and other is area, it might look weird if they overlap too much.
        // Let's just set data.
    }

    historicalSeriesRef.current.setData(historicalData);
    projectedSeriesRef.current.setData(projectedData);
    
    // Clear previous price lines
    priceLinesRef.current.forEach((line) => projectedSeriesRef.current?.removePriceLine(line));
    priceLinesRef.current = [];

    // 1. Current (Last Historical)
    const lastHistorical = data.filter((d) => d.type === "historical").pop();
    if (lastHistorical) {
      const line = projectedSeriesRef.current.createPriceLine({
        price: lastHistorical.value,
        color: "#26a69a",
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: "Current",
      });
      priceLinesRef.current.push(line);
    }

    // 2. Final (Last Projected)
    const lastProjected = data.filter((d) => d.type === "projected").pop();
    if (lastProjected) {
      const line = projectedSeriesRef.current.createPriceLine({
        price: lastProjected.value,
        color: "#2196f3",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Final",
      });
      priceLinesRef.current.push(line);
    }

    // 3. Cutoff
    const cutoffPoint = data.find((d) => d.time.startsWith(cutoffYear.toString()));
    if (cutoffPoint) {
      const line = projectedSeriesRef.current.createPriceLine({
        price: cutoffPoint.value,
        color: "#ff9800",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Cutoff",
      });
      priceLinesRef.current.push(line);
    }

    chartRef.current.timeScale().fitContent();

  }, [data, cutoffYear]);

  return <div ref={chartContainerRef} className="w-full" />;
}
