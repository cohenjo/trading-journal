"use client";

import React from "react";

export interface Position {
    id: number;
    account: string;
    ticker: string;
    shares: number;
    price: number;
    dividend_yield: number;
    annual_income: number;
    dgr_3y: number;
    dgr_5y: number;
    currency?: string;
}

interface PositionsTableProps {
    positions: Position[];
    onDelete: (id: number) => void;
    onEdit: (position: Position) => void;
}

export default function PositionsTable({ positions, onDelete, onEdit }: PositionsTableProps) {
    return (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="min-w-full bg-slate-900 text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-medium">
                    <tr>
                        <th className="px-4 py-3">Ticker</th>
                        <th className="px-4 py-3 text-right">Shares</th>
                        <th className="px-4 py-3 text-right">Price</th>
                        <th className="px-4 py-3 text-right">Div Yield</th>
                        <th className="px-4 py-3 text-right">Annual Income</th>
                        <th className="px-4 py-3 text-right">3y DGR</th>
                        <th className="px-4 py-3 text-right">5y DGR</th>
                        <th className="px-4 py-3 text-center">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                    {positions.length === 0 ? (
                        <tr>
                            <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                                No positions found. Add one to get started.
                            </td>
                        </tr>
                    ) : (
                        positions.map((pos) => (
                            <tr key={pos.id} className="hover:bg-slate-800/50 transition-colors">
                                <td className="px-4 py-3 font-semibold text-slate-200">{pos.ticker}</td>
                                <td className="px-4 py-3 text-right">{pos.shares}</td>
                                <td className="px-4 py-3 text-right">
                                    {pos.currency === 'ILS' ? '₪' : (pos.currency === 'EUR' ? '€' : '$')}
                                    {pos.price.toFixed(2)}
                                </td>
                                <td className="px-4 py-3 text-right text-blue-400">{(pos.dividend_yield * 100).toFixed(2)}%</td>
                                <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                                    {pos.currency === 'ILS' ? '₪' : (pos.currency === 'EUR' ? '€' : '$')}
                                    {pos.annual_income.toFixed(2)}
                                </td>
                                <td className={`px-4 py-3 text-right ${pos.dgr_3y >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {(pos.dgr_3y * 100).toFixed(2)}%
                                </td>
                                <td className={`px-4 py-3 text-right ${pos.dgr_5y >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {(pos.dgr_5y * 100).toFixed(2)}%
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <button
                                        onClick={() => onEdit(pos)}
                                        className="text-slate-400 hover:text-blue-400 mr-3"
                                        title="Edit"
                                        aria-label="Edit position"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                                    </button>
                                    <button
                                        onClick={() => onDelete(pos.id)}
                                        className="text-slate-400 hover:text-red-400"
                                        title="Delete"
                                        aria-label="Delete position"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                    </button>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
