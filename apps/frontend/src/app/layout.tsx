"use client";

import "./globals.css";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SettingsProvider } from "./settings/SettingsContext";

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100">
        <SettingsProvider>
          <div className="relative min-h-screen">
            <header className="fixed top-0 left-0 right-0 h-10 flex items-center px-3 bg-slate-950/90 border-b border-slate-800 z-20">
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-800"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-label="Toggle navigation menu"
              >
                <span className="block w-4 h-0.5 bg-slate-100 mb-0.5" />
                <span className="block w-4 h-0.5 bg-slate-100 mb-0.5" />
                <span className="block w-4 h-0.5 bg-slate-100" />
              </button>
              <span className="ml-3 text-sm text-slate-300">Trading Journal</span>
            </header>

            {menuOpen && (
              <nav className="fixed top-10 left-0 w-48 bg-slate-900 border-r border-slate-800 shadow-lg z-20 text-sm">
                <ul>
                  <li>
                    <Link
                      href="/summary"
                      className="block px-3 py-2 hover:bg-slate-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Summary
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/options"
                      className="block px-3 py-2 hover:bg-slate-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Options income
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/dividends"
                      className="block px-3 py-2 hover:bg-slate-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Dividends
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/ladder"
                      className="block px-3 py-2 hover:bg-slate-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Ladder
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/holdings"
                      className="block px-3 py-2 hover:bg-slate-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Bond holdings
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/day/2025-01-01"
                      className="block px-3 py-2 hover:bg-slate-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Day view
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/tax-condor"
                      className="block px-3 py-2 hover:bg-slate-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Tax Condor
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/backtest"
                      className="block px-3 py-2 hover:bg-slate-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Backtest
                    </Link>
                  </li>
                  <li className="border-t border-slate-800 mt-1 pt-1">
                    <Link
                      href="/settings"
                      className="block px-3 py-2 hover:bg-slate-800 text-slate-300"
                      onClick={() => setMenuOpen(false)}
                    >
                      Settings
                    </Link>
                  </li>
                </ul>
              </nav>
            )}

            <main className="pt-10">{children}</main>
          </div>
        </SettingsProvider>
      </body>
    </html>
  );
}
