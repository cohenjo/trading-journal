"use client";

import React from "react";

interface Position {
    symbol: string;
    amount: number;
    sec_type: string;
    avg_cost: number;
}

interface TradingPositionsTableProps {
    positions: Position[];
}

export default function TradingPositionsTable({ positions }: TradingPositionsTableProps) {
    return (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="min-w-full bg-slate-900 text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-medium">
                    <tr>
                        <th className="px-4 py-3">Ticker</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-4 py-3 text-right">Type</th>
                        <th className="px-4 py-3 text-right">Avg Cost</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                    {positions.length === 0 ? (
                        <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                                No positions found. Make sure the broker is connected and synced.
                            </td>
                        </tr>
                    ) : (
                        positions.map((pos, idx) => (
                            <tr key={`${pos.symbol}-${idx}`} className="hover:bg-slate-800/50 transition-colors">
                                <td className="px-4 py-3 font-semibold text-slate-200">{pos.symbol}</td>
                                <td className="px-4 py-3 text-right">{pos.amount}</td>
                                <td className="px-4 py-3 text-right">
                                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${pos.sec_type === 'STK' ? 'bg-blue-900/40 text-blue-400 border border-blue-800' :
                                        pos.sec_type === 'OPT' ? 'bg-purple-900/40 text-purple-400 border border-purple-800' :
                                            pos.sec_type === 'IND' ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800' :
                                                'bg-slate-800 text-slate-400 border border-slate-700'
                                        }`}>
                                        {pos.sec_type}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    ${pos.avg_cost.toFixed(2)}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
