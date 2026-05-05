'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getDayDetails, type DayDetails } from '@/app/day/actions';

import TradesTable from '@/components/Dashboard/TradesTable';
import SummaryGauges from '@/components/Dashboard/SummaryGauges';
import NdxChart from '@/components/Dashboard/NdxChart';


export default function DayPage() {
  const params = useParams();
  const date = params.date as string;
  const [dayDetails, setDayDetails] = useState<DayDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (date) {
      getDayDetails(date)
        .then((data) => {
          setDayDetails(data);
          setLoading(false);
        })
        .catch((error: unknown) => {
          console.error('Failed to load day details:', error);
          setLoading(false);
        });
    }
  }, [date]);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!dayDetails) {
    return <div>No data found for this day.</div>;
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-3xl font-bold">Daily Summary for {date}</h1>
        {dayDetails.market_data && (
            <div className="flex gap-4 text-sm bg-slate-800 p-2 rounded border border-slate-700">
                <div className="flex flex-col">
                    <span className="text-slate-400 text-xs">Open</span>
                    <span className="font-mono">{dayDetails.market_data.open.toFixed(2)}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-slate-400 text-xs">High</span>
                    <span className="font-mono text-green-400">{dayDetails.market_data.high.toFixed(2)}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-slate-400 text-xs">Low</span>
                    <span className="font-mono text-red-400">{dayDetails.market_data.low.toFixed(2)}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-slate-400 text-xs">Close</span>
                    <span className="font-mono">{dayDetails.market_data.close.toFixed(2)}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-slate-400 text-xs">Volume</span>
                    <span className="font-mono">{dayDetails.market_data.volume.toLocaleString()}</span>
                </div>
            </div>
        )}
      </div>
      <TradesTable trades={dayDetails.matched_trades} />
      <SummaryGauges summary={dayDetails.summary} />
      <NdxChart date={date} trades={dayDetails.matched_trades} />
    </div>
  );
}
