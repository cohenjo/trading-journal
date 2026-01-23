'use client';

import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, Time, AreaSeries } from 'lightweight-charts';

interface ProgressChartProps {
  data: {
    time: string; // YYYY-MM-DD
    value: number;
  }[];
}

export const ProgressChart: React.FC<ProgressChartProps> = ({ data }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
      },
      width: chartContainerRef.current.clientWidth,
      height: 300,
      grid: {
        vertLines: { color: '#334155' }, // slate-700
        horzLines: { color: '#334155' },
      },
      timeScale: {
        borderColor: '#475569',
      },
      rightPriceScale: {
        borderColor: '#475569',
      },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#2ca9bc',
      topColor: 'rgba(44, 169, 188, 0.56)',
      bottomColor: 'rgba(44, 169, 188, 0.04)',
    });

    // Ensure data is sorted by time
    const sortedData = [...data].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    series.setData(sortedData.map(d => ({
        time: d.time as Time,
        value: d.value
    })));

    chart.timeScale().fitContent();

    const handleResize = () => {
        if (chartContainerRef.current) {
            chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data]);

  return <div ref={chartContainerRef} className="w-full h-[300px]" />;
};
