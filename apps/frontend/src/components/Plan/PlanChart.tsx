'use client';
import { createChart, ColorType, IChartApi, SeriesMarker, Time, LineSeries, createSeriesMarkers, MouseEventParams } from 'lightweight-charts';
import React, { useEffect, useRef } from 'react';

// Lightweight Charts expects specific time formats. We'll use 'YYYY-MM-DD' strings.
interface ChartDataPoint {
    time: string; 
    value: number;
}

interface Props {
    data: ChartDataPoint[];
    markers?: SeriesMarker<Time>[];
    height?: number;
    onCrosshairMove?: (year: number | null) => void;
}

export const PlanChart: React.FC<Props> = ({ data, markers = [], height = 400, onCrosshairMove }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#94a3b8', // Slate-400
            },
            width: chartContainerRef.current.clientWidth,
            height: height,
            grid: {
                vertLines: { color: 'rgba(51, 65, 85, 0.3)' },
                horzLines: { color: 'rgba(51, 65, 85, 0.3)' },
            },
            rightPriceScale: {
                borderColor: '#475569',
                scaleMargins: {
                    top: 0.2, // Leave space for markers
                    bottom: 0.1,
                },
            },
            timeScale: {
                borderColor: '#475569',
            },
            crosshair: {
                vertLine: {
                    labelVisible: false,
                },
            },
        });
        chartRef.current = chart;

        const newSeries = chart.addSeries(LineSeries, {
            color: '#8b5cf6', // Violet-500 matching the screenshot somewhat
            lineWidth: 3,
            crosshairMarkerVisible: true,
        });
        
        // Format data: ensure sorted by time
        const sortedData = [...data].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
        
        // Cast to any because TS sometimes complains about rigid Time type
        newSeries.setData(sortedData as any); 
        
        if (markers.length > 0) {
            createSeriesMarkers(newSeries, markers);
        }

        // Subscribe to crosshair moves
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!onCrosshairMove) return;

            if (
                param.point === undefined ||
                !param.time ||
                param.point.x < 0 ||
                param.point.x > chart.timeScale().width() ||
                param.point.y < 0 ||
                param.point.y > chart.timeScale().height()
            ) {
                // Determine if we should clear selection or keep last valid?
                // Usually clearer to keep last valid or allow null.
                // onCrosshairMove(null); 
                return;
            }

            // Extract year from YYYY-MM-DD
            const dateStr = param.time as string;
            const year = parseInt(dateStr.split('-')[0]);
            onCrosshairMove(year);
        });

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
    }, [data, markers, height, onCrosshairMove]);

    return (
        <div ref={chartContainerRef} className="w-full relative" />
    );
};
