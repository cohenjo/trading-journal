"use client";

import React from "react";
import type { StockPosition, TradingAccountConfig } from "@/app/trading/actions";
import { convertCurrency } from "@/lib/currency";

export interface AccountBalance {
  config: TradingAccountConfig;
  positions: StockPosition[];
}

export interface AggregatePortfolioFooterProps {
  accounts: AccountBalance[];
}

const ACCOUNT_COLORS: Record<string, string> = {
  ibkr: "bg-blue-500",
  IBKR: "bg-blue-500",
  schwab: "bg-amber-500",
  SCHWAB: "bg-amber-500",
  ira: "bg-violet-500",
};

function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(value);
}

function accountMarketValue(positions: StockPosition[]): number {
  return positions.reduce((sum, p) => {
    // Use market_value_local as fallback for positions the Yahoo worker hasn't
    // refreshed yet (market_value=null).
    const mv = p.market_value ?? p.market_value_local ?? 0;
    // Normalise broker sub-unit codes to ISO major units before conversion:
    //   ILA (Israeli agorot) → ILS  (market_value is already in ILS)
    //   GBp (pence)          → GBP  (market_value is already in GBP)
    // All other currencies (USD, EUR…) are passed through; convertCurrency
    // handles them via CURRENCY_RATES.
    const sourceCurrency = p.currency === "ILA" ? "ILS"
      : p.currency === "GBp" ? "GBP"
      : p.currency;
    return sum + convertCurrency(mv, sourceCurrency, "USD");
  }, 0);
}

function getAccountLabel(config: TradingAccountConfig): string {
  return config.name ?? config.account_id ?? "Account";
}

function topFiveHoldings(accounts: AccountBalance[]): string {
  const valueByTicker = new Map<string, number>();
  for (const { positions } of accounts) {
    for (const p of positions) {
      const mv = p.market_value ?? p.market_value_local ?? 0;
      const sourceCurrency = p.currency === "ILA" ? "ILS"
        : p.currency === "GBp" ? "GBP"
        : p.currency;
      const usdValue = convertCurrency(mv, sourceCurrency, "USD");
      valueByTicker.set(p.ticker, (valueByTicker.get(p.ticker) ?? 0) + usdValue);
    }
  }
  return Array.from(valueByTicker.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ticker]) => ticker)
    .join(" · ");
}

export default function AggregatePortfolioFooter({ accounts }: AggregatePortfolioFooterProps) {
  const accountTotals = accounts.map(({ config, positions }) => ({
    config,
    total: accountMarketValue(positions),
  }));

  const grandTotal = accountTotals.reduce((sum, a) => sum + a.total, 0);
  const top5 = topFiveHoldings(accounts);

  return (
    <div
      className="mt-6 p-4 bg-slate-900/60 rounded-lg border border-slate-800"
      data-testid="aggregate-footer"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h3 className="text-slate-200 font-semibold">Total Portfolio Value</h3>
        <span className="text-xl font-bold text-slate-100" data-testid="total-value">
          {formatCurrency(grandTotal)}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        {accountTotals.map(({ config, total }) => {
          const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
          const colorClass = ACCOUNT_COLORS[config.account_type] ?? "bg-slate-500";
          const label = getAccountLabel(config);

          return (
            <div key={config.id} className="flex items-center gap-3" data-testid="account-bar">
              <span className="w-20 text-sm text-slate-400 truncate">{label}</span>
              <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${colorClass}`}
                  style={{ width: `${pct.toFixed(1)}%` }}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <span className="text-sm text-slate-300 w-20 text-right">
                {formatCurrency(total)}
              </span>
              <span className="text-xs text-slate-500 w-10 text-right">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>

      {top5 && (
        <p className="text-sm text-slate-500" data-testid="top-holdings">
          Top Holdings:{" "}
          <span className="text-slate-400">{top5}</span>
        </p>
      )}
    </div>
  );
}
