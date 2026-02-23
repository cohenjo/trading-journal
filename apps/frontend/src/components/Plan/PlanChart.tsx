'use client';
import { createChart, ColorType, IChartApi, SeriesMarker, Time, LineSeries, createSeriesMarkers, MouseEventParams, LineStyle } from 'lightweight-charts';
import React, { useEffect, useRef, useState } from 'react';

// Lightweight Charts expects specific time formats. We'll use 'YYYY-MM-DD' strings.
interface ChartDataPoint {
    time: string;
    value: number;
}

interface Props {
    data: ChartDataPoint[];
    secondaryData?: ChartDataPoint[];
    markers?: SeriesMarker<Time>[];
    height?: number;
    birthYear?: number;
    onCrosshairMove?: (year: number | null) => void;
}

export const PlanChart: React.FC<Props> = ({ data, secondaryData = [], markers = [], height = 400, birthYear = 1980, onCrosshairMove }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const [visibleRange, setVisibleRange] = useState<{ from: number; to: number } | null>(null);
    const [chartWidth, setChartWidth] = useState(0);

    // Derived ticks for custom X-axis
    const ticks = React.useMemo(() => {
        if (!visibleRange || !data.length || chartWidth === 0) return [];

        const startYear = parseInt(data[0].time.split('-')[0]);
        const endYear = parseInt(data[data.length - 1].time.split('-')[0]);

        const yearRange = endYear - startYear;
        // Simple logic to decide how many ticks to show based on zoom
        const span = visibleRange.to - visibleRange.from;
        let step = 1;
        if (span > 50) step = 10;
        else if (span > 20) step = 5;
        else if (span > 10) step = 2;

        const result = [];
        for (let y = startYear; y <= endYear; y += step) {
            // Percent position in data range
            const pos = (y - startYear) / yearRange;
            // Logical position mapping (approximation for now, 
            // lightweight charts logical range is usually data indices)
            const logicalPos = (y - startYear); // Year index if data is yearly

            if (logicalPos >= visibleRange.from && logicalPos <= visibleRange.to) {
                const pixelPos = ((logicalPos - visibleRange.from) / span) * chartWidth;
                result.push({ year: y, age: y - birthYear, left: pixelPos });
            }
        }
        return result;
    }, [visibleRange, data, birthYear, chartWidth]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#94a3b8', // Slate-400
            },
            localization: {
                priceFormatter: (price: number) => {
                    const millions = price / 1_000_000;
                    return `${millions.toFixed(1)}M`;
                },
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
                fixLeftEdge: true,
                tickMarkFormatter: () => '',
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

        if (secondaryData.length > 0) {
            const liquidSeries = chart.addSeries(LineSeries, {
                color: '#64748b', // Slate-500
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                crosshairMarkerVisible: true,
            });
            const sortedLiquid = [...secondaryData].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
            liquidSeries.setData(sortedLiquid as any);
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

        // 25-Year Initial Zoom
        if (sortedData.length > 0) {
            const startYear = parseInt(sortedData[0].time.split('-')[0]);
            const targetEndYear = startYear + 25;
            chart.timeScale().setVisibleRange({
                from: `${startYear}-01-01` as any,
                to: `${targetEndYear}-01-01` as any,
            });
        }

        setChartWidth(chartContainerRef.current.clientWidth);

        // Sync logical range for custom labels
        const timeScale = chart.timeScale();
        const handleVisibleRangeChange = () => {
            const range = timeScale.getVisibleLogicalRange();
            if (range) {
                setVisibleRange({ from: range.from, to: range.to });
            }
        };

        timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
        handleVisibleRangeChange(); // Initial sync

        const handleResize = () => {
            if (chartContainerRef.current) {
                const width = chart.timeScale().width();
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
                setChartWidth(width);
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [data, secondaryData, markers, height, onCrosshairMove]);

    return (
        <div className="w-full relative">
            <div ref={chartContainerRef} className="w-full" />

            {/* Custom Multi-line X-Axis Labels */}
            <div
                className="relative h-12 mt-4 mb-2 overflow-hidden pointer-events-none"
                style={{ width: chartWidth }}
            >
                {ticks.map((tick, i) => (
                    <div
                        key={i}
                        className="absolute text-[10px] text-slate-500 text-center leading-tight transition-all duration-75"
                        style={{
                            left: tick.left,
                            transform: 'translateX(-50%)',
                            width: 60
                        }}
                    >
                        <div className="font-bold text-slate-400">{tick.year}</div>
                        <div className="opacity-70">age {tick.age}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};
