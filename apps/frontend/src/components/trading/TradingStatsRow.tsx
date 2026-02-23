"use client";

import React from "react";

interface TradingStatsProps {
    stats: {
        net_liquidation?: number;
        total_cash?: number;
        NetLiquidation?: number; // Legacy/Fallback
        TotalCashValue?: number; // Legacy/Fallback
        currency?: string;
    };
}

export default function TradingStatsRow({ stats }: TradingStatsProps) {
    const netLiq = stats.net_liquidation ?? stats.NetLiquidation ?? 0;
    const totalCash = stats.total_cash ?? stats.TotalCashValue ?? 0;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg shadow-sm">
                <div className="text-slate-400 text-sm font-medium mb-1">Net Liquidation</div>
                <div className="text-2xl font-bold text-emerald-400">
                    {stats.currency === 'ILS' ? '₪' : (stats.currency === 'EUR' ? '€' : '$')}
                    {netLiq.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg shadow-sm">
                <div className="text-slate-400 text-sm font-medium mb-1">Total Cash Value</div>
                <div className="text-2xl font-bold text-blue-400">
                    {stats.currency === 'ILS' ? '₪' : (stats.currency === 'EUR' ? '€' : '$')}
                    {totalCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
            </div>
        </div>
    );
}
