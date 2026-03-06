"use client";

import React, { useState, type ReactNode } from "react";
import Link from "next/link";

export default function MainLayout({ children }: { children: ReactNode }) {
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <div className="relative min-h-screen">
            <header className="fixed top-0 left-0 right-0 h-14 flex items-center px-4 bg-slate-950 border-b border-slate-800 z-30">
                <button
                    type="button"
                    className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors text-slate-200"
                    onClick={() => setMenuOpen((prev) => !prev)}
                    aria-label="Toggle navigation menu"
                >
                    {menuOpen ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    )}
                </button>
                <span className="ml-4 text-lg font-semibold text-slate-100">Trading Journal</span>
            </header>

            {menuOpen && (
                <nav className="fixed top-14 left-0 w-64 h-[calc(100vh-3.5rem)] bg-slate-900 border-r border-slate-800 shadow-xl z-20 overflow-y-auto">
                    {/* Using a distinct background for menu to separate it from body */}
                    <div className="flex flex-col py-2">
                        <div className="mb-2 px-6 pt-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Financial Planning
                        </div>
                        <Link
                            href="/current-finances"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Net Worth
                        </Link>
                        <Link
                            href="/cash-flow"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Cash Flow
                        </Link>
                        <Link
                            href="/plan"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Financial Plan
                        </Link>
                        <Link
                            href="/progress"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Progress
                        </Link>

                        <div className="mt-4 mb-2 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider border-t border-slate-800 pt-4">
                            Income &amp; Yield
                        </div>
                        <Link
                            href="/summary"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Income Summary
                        </Link>
                        <Link
                            href="/pension"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Pension
                        </Link>
                        <Link
                            href="/dividends"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Dividends
                        </Link>
                        <Link
                            href="/dividends/estimations"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Dividend Estimations
                        </Link>
                        <Link
                            href="/holdings"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Bonds
                        </Link>
                        <Link
                            href="/ladder"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Bond Ladder
                        </Link>
                        <Link
                            href="/options"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Options Income
                        </Link>

                        <div className="mt-4 mb-2 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider border-t border-slate-800 pt-4">
                            Trading
                        </div>
                        <Link
                            href="/trading/accounts"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Accounts
                        </Link>
                        <Link
                            href="/day/2025-01-01"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Day View
                        </Link>
                        <Link
                            href="/analyze"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Stock Analyzer
                        </Link>
                        <Link
                            href="/tax-condor"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Tax Condor
                        </Link>
                        <Link
                            href="/backtest"
                            className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                            onClick={() => setMenuOpen(false)}
                        >
                            Backtest
                        </Link>

                        <div className="mt-2 border-t border-slate-800 pt-2">
                            <Link
                                href="/settings"
                                className="block px-6 py-3 text-base font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                                onClick={() => setMenuOpen(false)}
                            >
                                Settings
                            </Link>
                        </div>
                    </div>
                </nav>
            )}

            <main className="pt-14">{children}</main>
        </div>
    );
}
