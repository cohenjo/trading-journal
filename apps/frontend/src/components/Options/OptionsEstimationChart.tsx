"use client";

import { createChart, IChartApi, ISeriesApi, AreaSeries, HistogramSeries } from "lightweight-charts";
import { useEffect, useRef } from "react";

export type OptionsChartPoint = {
  time: string;
  value: number;
  type: "historical" | "projected";
};

type OptionsEstimationChartProps = {
  data: OptionsChartPoint[];
};

export default function OptionsEstimationChart({ data }: OptionsEstimationChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const historicalSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const projectedSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const priceLinesRef = useRef<ReturnType<ISeriesApi<"Area">["createPriceLine"]>[]>([]);

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

    // Historical actuals — histogram bars in teal
    historicalSeriesRef.current = chartRef.current.addSeries(HistogramSeries, {
      color: "#26a69a",
      priceFormat: { type: "volume" },
    });

    // Projected future years — shaded area in blue
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

    historicalSeriesRef.current.setData(historicalData);
    projectedSeriesRef.current.setData(projectedData);

    // Clear previous price lines
    priceLinesRef.current.forEach((line) => projectedSeriesRef.current?.removePriceLine(line));
    priceLinesRef.current = [];

    const lastHistorical = historicalData[historicalData.length - 1];
    if (lastHistorical) {
      priceLinesRef.current.push(
        projectedSeriesRef.current.createPriceLine({
          price: lastHistorical.value,
          color: "#26a69a",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "Last Actual",
        }),
      );
    }

    const lastProjected = projectedData[projectedData.length - 1];
    if (lastProjected) {
      priceLinesRef.current.push(
        projectedSeriesRef.current.createPriceLine({
          price: lastProjected.value,
          color: "#2196f3",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "Final",
        }),
      );
    }

    chartRef.current.timeScale().fitContent();
  }, [data]);

  return <div ref={chartContainerRef} className="w-full" />;
}
