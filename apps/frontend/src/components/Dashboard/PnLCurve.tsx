"use client";

import { createChart, IChartApi, ISeriesApi, AreaSeries } from "lightweight-charts";
import { useEffect, useRef } from "react";

type PnLCurveProps = {
  data: { time: string; value: number }[];
};

export default function PnLCurve({ data }: PnLCurveProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    chartRef.current = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 300,
      layout: {
        background: { color: "#1a1a1a" },
        textColor: "#d1d1d1",
      },
      grid: {
        vertLines: {
          color: "#2a2a2a",
        },
        horzLines: {
          color: "#2a2a2a",
        },
      },
    });

    seriesRef.current = chartRef.current.addSeries(AreaSeries, {
      topColor: "rgba(33, 150, 243, 0.56)",
      bottomColor: "rgba(33, 150, 243, 0.04)",
      lineColor: "rgba(33, 150, 243, 1)",
      lineWidth: 2,
    });
    if (seriesRef.current) {
        seriesRef.current.setData(data);
    }

    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.resize(chartContainerRef.current.clientWidth, 300);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartRef.current?.remove();
    };
  }, [data]);

  return <div ref={chartContainerRef} />;
}