"use client";

import React from "react";

interface StatsProps {
    stats: {
        portfolio_yield: number;
        annual_income: number;
        dgr_5y: number;
        currency?: string;
    };
}

export default function StatsRow({ stats }: StatsProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg shadow-sm">
                <div className="text-slate-400 text-sm font-medium mb-1">Annual Income</div>
                <div className="text-2xl font-bold text-emerald-400">
                    {stats.currency === 'ILS' ? '₪' : (stats.currency === 'EUR' ? '€' : '$')}
                    {stats.annual_income.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg shadow-sm">
                <div className="text-slate-400 text-sm font-medium mb-1">Portfolio Yield</div>
                <div className="text-2xl font-bold text-blue-400">
                    {(stats.portfolio_yield * 100).toFixed(2)}%
                </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg shadow-sm">
                <div className="text-slate-400 text-sm font-medium mb-1">5 Year DGR</div>
                <div className="text-2xl font-bold text-purple-400">
                    {stats.dgr_5y ? (stats.dgr_5y * 100).toFixed(2) : "0.00"}%
                </div>
            </div>
        </div>
    );
}
