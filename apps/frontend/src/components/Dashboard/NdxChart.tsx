'use client';

import { useEffect, useRef } from 'react';
import { getNdxChartData, type NdxChartData } from '@/app/ndx/actions';
import { createChart, IChartApi, CandlestickData, UTCTimestamp, SeriesMarker, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';

// Using the same MatchedTrade interface from DayPage
interface MatchedTrade {
  id: number;
  symbol: string;
  open_date: string;
  close_date: string;
  open_price: number;
  close_price: number;
  pnl: number;
  notes?: string | null;
}

export default function NdxChart({ date, trades }: { date: string, trades: MatchedTrade[] }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let chart: IChartApi | undefined;
    if (chartContainerRef.current) {
      chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 400,
        layout: {
          background: { color: '#1f2937' },
          textColor: 'white',
        },
        grid: {
          vertLines: { color: '#4B5563' },
          horzLines: { color: '#4B5563' },
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
      });

      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        wickUpColor: '#22c55e',
      });

      if (date) {
        getNdxChartData(date)
          .then((data: NdxChartData[]) => {
            const formattedData: CandlestickData[] = data.map(item => ({
                time: item.time as UTCTimestamp,
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
            }));
            candlestickSeries.setData(formattedData);

            if (trades && trades.length > 0) {
              const markers: SeriesMarker<UTCTimestamp>[] = [];
              trades.forEach(trade => {
                markers.push({
                  time: (new Date(trade.open_date).getTime() / 1000) as UTCTimestamp,
                  position: 'aboveBar',
                  color: '#22c55e',
                  shape: 'arrowDown',
                  text: `Open ${trade.symbol}`,
                });
                markers.push({
                  time: (new Date(trade.close_date).getTime() / 1000) as UTCTimestamp,
                  position: 'belowBar',
                  color: '#ef4444',
                  shape: 'arrowUp',
                  text: `Close ${trade.symbol}`,
                });
              });
              createSeriesMarkers(candlestickSeries, markers);
            }
          })
          .catch((error: unknown) => console.error('Failed to load NDX chart data:', error));
      }
    }

    return () => {
      chart?.remove();
    };
  }, [date, trades]);

  return (
    <div className="bg-gray-800 p-4 rounded-lg mt-4">
      <h2 className="text-xl font-bold mb-2">NDX 1-Min Chart</h2>
      <div ref={chartContainerRef} />
    </div>
  );
}
