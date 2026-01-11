import React, { useState, useEffect, useRef } from 'react';
import { createChart, ColorType, Time, SeriesMarker, createSeriesMarkers, BaselineSeries } from 'lightweight-charts';
import { TaxCondorRecommendation, PnLSimulation, OptionLeg } from './types';

interface Props {
  recommendation: TaxCondorRecommendation;
  onClose: () => void;
}

const PnLChart: React.FC<{ 
    data: PnLSimulation[], 
    strikes: { price: number, label: string, type: 'call' | 'put' | 'current' }[],
    currentPrice?: number
}> = ({ data, strikes, currentPrice }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        textColor: '#94a3b8',
        background: { type: ColorType.Solid, color: 'transparent' },
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#334155',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: '#334155',
        tickMarkFormatter: (time: number | string) => Number(time).toFixed(2),
      },
      localization: {
        timeFormatter: (time: number | string) => Number(time).toFixed(2),
        priceFormatter: (price: number) => '$' + price.toFixed(2),
      },
      height: 320,
      autoSize: true,
    });

    const baselineSeries = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#4ade80',
      topFillColor1: 'rgba(74, 222, 128, 0.2)',
      topFillColor2: 'rgba(74, 222, 128, 0.0)',
      bottomLineColor: '#f87171',
      bottomFillColor1: 'rgba(248, 113, 113, 0.0)',
      bottomFillColor2: 'rgba(248, 113, 113, 0.2)',
    });

    // 1. Sort original data
    const sortedData = [...data].sort((a, b) => (a.underlying_price || 0) - (b.underlying_price || 0));

    // 2. Interpolate and insert points for strikes and current price
    const pointsOfInterest = [
        ...strikes.map(s => ({ price: s.price, label: s.label, color: s.type === 'call' ? '#60a5fa' : '#f472b6' })),
        ...(currentPrice ? [{ price: currentPrice, label: 'Current', color: '#fbbf24' }] : [])
    ].sort((a, b) => a.price - b.price);

    const finalData: { time: Time; value: number }[] = [];
    const markers: SeriesMarker<Time>[] = [];

    // Helper to interpolate Y for a given X
    const interpolate = (x: number, p1: { time: number, value: number }, p2: { time: number, value: number }) => {
        if (p1.time === p2.time) return p1.value;
        const ratio = (x - p1.time) / (p2.time - p1.time);
        return p1.value + (p2.value - p1.value) * ratio;
    };
    
    // Convert sortedData to { time, value } format
    const basePoints = sortedData.map(d => ({ time: d.underlying_price || 0, value: d.estimated_pnl }));

    // Merge loop
    const allX = new Set(basePoints.map(p => p.time));
    pointsOfInterest.forEach(poi => allX.add(poi.price));
    const sortedX = Array.from(allX).sort((a, b) => a - b);

    sortedX.forEach(x => {
        // Find if x exists in basePoints
        const existing = basePoints.find(p => Math.abs(p.time - x) < 0.001);
        let value = 0;

        if (existing) {
            value = existing.value;
        } else {
            // Interpolate
            // Find surrounding points in basePoints
            const left = basePoints.filter(p => p.time < x).pop();
            const right = basePoints.find(p => p.time > x);
            
            if (left && right) {
                value = interpolate(x, left, right);
            } else if (left) {
                value = left.value; // Extrapolate flat
            } else if (right) {
                value = right.value; // Extrapolate flat
            }
        }

        // Use the number directly as time. 
        // lightweight-charts supports numbers as UTCTimestamp (seconds).
        // Since we use custom formatter, it should display correctly.
        finalData.push({ time: x as Time, value });

        // Check if this x corresponds to a POI
        const poi = pointsOfInterest.find(p => Math.abs(p.price - x) < 0.001);
        if (poi) {
            markers.push({
                time: x as Time,
                position: 'aboveBar',
                color: poi.color,
                shape: 'arrowDown',
                text: poi.label,
                size: 1, // Small arrow
            });
        }
    });

    baselineSeries.setData(finalData);
    createSeriesMarkers(baselineSeries, markers);

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [data, strikes, currentPrice]);

  return <div ref={chartContainerRef} className="w-full h-full" />;
};

const LegRow: React.FC<{ leg: OptionLeg, role: string }> = ({ leg, role }) => (
    <tr className="border-b border-slate-800 hover:bg-slate-800/50">
        <td className={`py-2 px-3 font-mono ${leg.action === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
            {leg.action.toUpperCase()}
        </td>
        <td className="py-2 px-3 font-mono">{Math.abs(leg.quantity)}</td>
        <td className="py-2 px-3">{leg.symbol}</td>
        <td className="py-2 px-3 font-mono">{leg.expiration}</td>
        <td className="py-2 px-3 font-mono">{leg.strike}</td>
        <td className="py-2 px-3 uppercase">{leg.option_type}</td>
        <td className="py-2 px-3 font-mono text-slate-400">{leg.bid?.toFixed(2) || '-'}</td>
        <td className="py-2 px-3 font-mono text-slate-400">{leg.ask?.toFixed(2) || '-'}</td>
        <td className="py-2 px-3 font-mono text-white">{leg.mid?.toFixed(2) || leg.price.toFixed(2)}</td>
        <td className="py-2 px-3 font-mono text-slate-400">{(leg.implied_volatility ? (leg.implied_volatility * 100).toFixed(1) : '-')}</td>
        <td className="py-2 px-3 font-mono text-slate-400">{leg.greeks.delta.toFixed(2)}</td>
        <td className="py-2 px-3 text-xs text-slate-500">{role}</td>
    </tr>
);

export const RecommendationDetails: React.FC<Props> = ({ recommendation, onClose }) => {
  const { leap, iron_condor } = recommendation;
  const [showLeap, setShowLeap] = useState(true);

  const chartData = showLeap 
    ? recommendation.portfolio_chart_data 
    : iron_condor.chart_data;

  const strikes = [
      { price: iron_condor.short_call.strike, label: 'SC', type: 'call' as const },
      { price: iron_condor.long_call.strike, label: 'LC', type: 'call' as const },
      { price: iron_condor.short_put.strike, label: 'SP', type: 'put' as const },
      { price: iron_condor.long_put.strike, label: 'LP', type: 'put' as const },
  ];
  
  if (showLeap) {
      strikes.push({ price: leap.leg.strike, label: 'LEAP', type: 'call' as const });
  }
  
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
       <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center p-6 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
             <div>
                <h2 className="text-2xl font-bold text-white">Strategy Details</h2>
                <p className="text-slate-400 text-sm">Score: {recommendation.score.toFixed(1)} | Net Credit: ${recommendation.analysis.net_credit.toFixed(2)}</p>
             </div>
             <button 
                onClick={onClose}
                className="text-slate-400 hover:text-white p-2 rounded-full hover:bg-slate-800 transition-colors"
             >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
             </button>
          </div>

          <div className="p-6 space-y-8">
            {/* Legs Table */}
            <section>
                <h3 className="text-lg font-semibold text-blue-400 mb-4">Leg Configuration</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-950 text-slate-400 uppercase text-xs">
                            <tr>
                                <th className="py-3 px-3">Action</th>
                                <th className="py-3 px-3">Qty</th>
                                <th className="py-3 px-3">Symbol</th>
                                <th className="py-3 px-3">Expiry</th>
                                <th className="py-3 px-3">Strike</th>
                                <th className="py-3 px-3">Type</th>
                                <th className="py-3 px-3">Bid</th>
                                <th className="py-3 px-3">Ask</th>
                                <th className="py-3 px-3">Mid</th>
                                <th className="py-3 px-3">IV %</th>
                                <th className="py-3 px-3">Delta</th>
                                <th className="py-3 px-3">Role</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                            <LegRow leg={leap.leg} role="LEAP (Long Term)" />
                            <LegRow leg={iron_condor.short_call} role="IC Short Call" />
                            <LegRow leg={iron_condor.long_call} role="IC Long Call" />
                            <LegRow leg={iron_condor.short_put} role="IC Short Put" />
                            <LegRow leg={iron_condor.long_put} role="IC Long Put" />
                        </tbody>
                    </table>
                </div>
            </section>

            {/* PnL Chart */}
            <section>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-blue-400">
                        {showLeap ? "Portfolio PnL Profile (LEAP + IC)" : "Iron Condor PnL Profile (IC Only)"}
                    </h3>
                    <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
                        <button
                            onClick={() => setShowLeap(true)}
                            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                                showLeap 
                                ? 'bg-blue-600 text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            With LEAP
                        </button>
                        <button
                            onClick={() => setShowLeap(false)}
                            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                                !showLeap 
                                ? 'bg-blue-600 text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            IC Only
                        </button>
                    </div>
                </div>
                <div className="h-80 w-full bg-slate-950 rounded-lg border border-slate-800 p-4">
                    <PnLChart 
                        data={chartData || []} 
                        strikes={strikes}
                        currentPrice={recommendation.underlying_price}
                    />
                </div>
                <p className="text-xs text-slate-500 mt-2 text-center">
                    *Chart shows estimated PnL at the Iron Condor&apos;s expiration date.
                </p>
            </section>

            {/* Simulation Table */}
            <section>
                <h3 className="text-lg font-semibold text-blue-400 mb-4">PnL Simulation Scenarios</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-950 text-slate-400 uppercase text-xs">
                            <tr>
                                <th className="py-3 px-4">Scenario</th>
                                <th className="py-3 px-4">Underlying Price</th>
                                <th className="py-3 px-4 text-right">Est. PnL</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                            {recommendation.portfolio_pnl_simulations?.map((sim, i) => (
                                <tr key={i} className="hover:bg-slate-800/50">
                                    <td className="py-3 px-4 font-mono">
                                        {sim.price_change_pct > 0 ? '+' : ''}{sim.price_change_pct.toFixed(0)}%
                                    </td>
                                    <td className="py-3 px-4 font-mono">
                                        ${sim.underlying_price?.toFixed(2)}
                                    </td>
                                    <td className={`py-3 px-4 font-mono text-right font-bold ${sim.estimated_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        ${sim.estimated_pnl.toFixed(2)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
          </div>
       </div>
    </div>
  );
};
