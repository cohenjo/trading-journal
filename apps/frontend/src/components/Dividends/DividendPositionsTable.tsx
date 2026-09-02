"use client";

import { useState, useMemo } from "react";
import type { DividendPosition, PaymentFrequency, DividendRating } from "@/types/dividends";
import { formatCurrency } from "@/lib/currency";

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtMoney(val: number | null, currency = "USD"): string {
  if (val === null || val === undefined) return "—";
  return formatCurrency(val, currency);
}

function fmtPct(val: number | null): string {
  if (val === null || val === undefined) return "—";
  return `${val.toFixed(2)}%`;
}

function fmtQty(val: number): string {
  return val.toLocaleString("en-US");
}

export function fmtFrequency(freq: PaymentFrequency): string {
  switch (freq) {
    case "monthly":     return "Monthly";
    case "quarterly":   return "Quarterly";
    case "semi-annual": return "Semi-Annual";
    case "annual":      return "Annual";
    case "irregular":   return "Irregular";
    default:            return "—";
  }
}

function getRatingBadge(rating: DividendRating | undefined) {
  switch (rating) {
    case "good":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700/60 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          Good
        </span>
      );
    case "ok":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-700/60 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          Watch
        </span>
      );
    case "bad":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-950 text-rose-300 border border-rose-700/60 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
          At Risk
        </span>
      );
    default:
      return <span className="text-slate-500 text-xs">—</span>;
  }
}

function getRatingTooltip(row: DividendPosition): string {
  const parts: string[] = [];
  if (row.dividend_rating === "good") {
    parts.push("Health: Good (Passes dividend growth momentum & revenue growth)");
  } else if (row.dividend_rating === "ok") {
    parts.push("Health: Watch (Misses 1 of dividend momentum or revenue growth)");
  } else if (row.dividend_rating === "bad") {
    parts.push("Health: At Risk (Misses both dividend momentum and revenue growth)");
  }

  if (row.dgr_3y != null && row.dgr_5y != null) {
    const cmp = row.dgr_3y >= row.dgr_5y ? "≥" : "<";
    parts.push(`Dividend Growth: 3Y (${(row.dgr_3y * 100).toFixed(1)}%) ${cmp} 5Y (${(row.dgr_5y * 100).toFixed(1)}%)`);
  } else if (row.dgr_3y != null) {
    parts.push(`3Y DGR: ${(row.dgr_3y * 100).toFixed(1)}%`);
  }

  if (row.revenue_growth != null) {
    const sign = row.revenue_growth > 0 ? "+" : "";
    parts.push(`Revenue Growth: ${sign}${(row.revenue_growth * 100).toFixed(1)}% YoY`);
  } else if (row.dividend_rating_details?.quote_type === "ETF" || row.dividend_rating_details?.quote_type === "MUTUALFUND") {
    parts.push("Fund / ETF (no corporate revenue)");
  }

  if (row.payout_ratio != null) {
    parts.push(`Payout Ratio: ${(row.payout_ratio * 100).toFixed(1)}%`);
  }

  return parts.join(" • ");
}

function getRowStyle(rating: DividendRating | undefined): string {
  switch (rating) {
    case "good":
      return "border-l-4 border-l-emerald-500 bg-emerald-950/15 hover:bg-emerald-950/30";
    case "ok":
      return "border-l-4 border-l-amber-500 bg-amber-950/15 hover:bg-amber-950/30";
    case "bad":
      return "border-l-4 border-l-rose-500 bg-rose-950/20 hover:bg-rose-950/35";
    default:
      return "border-l-4 border-l-slate-800 hover:bg-slate-800/50";
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  rows: DividendPosition[];
}

type RatingFilter = "all" | "good" | "ok" | "bad";

/**
 * Renders enriched dividend positions sorted by ticker lexicographically.
 * Color codes holdings into Good (green), Watch / OK (yellow), and At Risk / Bad (red).
 * All monetary values use currency formatting via formatCurrency.
 */
export default function DividendPositionsTable({ rows }: Props) {
  const [filter, setFilter] = useState<RatingFilter>("all");

  const counts = useMemo(() => {
    let good = 0;
    let ok = 0;
    let bad = 0;
    for (const r of rows) {
      if (r.dividend_rating === "good") good++;
      else if (r.dividend_rating === "ok") ok++;
      else if (r.dividend_rating === "bad") bad++;
    }
    return { all: rows.length, good, ok, bad };
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.dividend_rating === filter);
  }, [rows, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [filtered]);

  return (
    <div className="space-y-3">
      {/* Filter Chips Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900/80 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 mr-1 font-medium">Filter Health:</span>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              filter === "all"
                ? "bg-slate-700 text-white font-medium"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
            data-testid="filter-rating-all"
          >
            All ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setFilter("good")}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${
              filter === "good"
                ? "bg-emerald-900/70 text-emerald-200 border border-emerald-600 font-medium"
                : "text-emerald-400 hover:bg-emerald-950/50"
            }`}
            data-testid="filter-rating-good"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Good ({counts.good})
          </button>
          <button
            type="button"
            onClick={() => setFilter("ok")}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${
              filter === "ok"
                ? "bg-amber-900/70 text-amber-200 border border-amber-600 font-medium"
                : "text-amber-400 hover:bg-amber-950/50"
            }`}
            data-testid="filter-rating-ok"
          >
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            Watch ({counts.ok})
          </button>
          <button
            type="button"
            onClick={() => setFilter("bad")}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${
              filter === "bad"
                ? "bg-rose-900/70 text-rose-200 border border-rose-600 font-medium"
                : "text-rose-400 hover:bg-rose-950/50"
            }`}
            data-testid="filter-rating-bad"
          >
            <span className="w-2 h-2 rounded-full bg-rose-400"></span>
            At Risk ({counts.bad})
          </button>
        </div>

        <span className="text-slate-400 text-[11px]">
          Hover badge for 3Y/5Y DGR, Rev Growth & Payout metrics
        </span>
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full text-sm text-left text-slate-300 border-collapse"
          data-testid="dividends-positions-table"
        >
          <thead className="text-xs text-slate-400 uppercase bg-slate-800 sticky top-0">
            <tr>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">Ticker</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">Health</th>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2 text-right">Qty</th>
              <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">Avg Cost</th>
              <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">Price</th>
              <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">Mkt Value</th>
              <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">TTM $/sh</th>
              <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">TTM Yield%</th>
              <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">TTM Yield$</th>
              <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">Fwd $/sh</th>
              <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">Fwd Yield%</th>
              <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">Fwd Annual$</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">Frequency</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">Last Payment</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const tooltip = getRatingTooltip(row);
              const rowStyle = getRowStyle(row.dividend_rating);
              return (
                <tr
                  key={row.ticker}
                  className={`border-b border-slate-800/80 transition-colors ${rowStyle}`}
                  data-testid={`dividend-row-${row.ticker}`}
                >
                  <td className="px-3 py-2 font-semibold text-slate-100 whitespace-nowrap">
                    {row.ticker}
                  </td>
                  <td
                    className="px-3 py-2 whitespace-nowrap cursor-help"
                    title={tooltip}
                    data-testid={`dividend-rating-${row.ticker}`}
                  >
                    {getRatingBadge(row.dividend_rating)}
                  </td>
                  <td
                    className="px-3 py-2 text-slate-400 max-w-[160px] truncate"
                    title={row.name ?? ""}
                  >
                    {row.name ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtQty(row.quantity)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.avg_cost, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.current_price, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.market_value, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.ttm_div_per_share, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(row.ttm_yield_pct)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.ttm_dividend_total, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.forward_div_per_share, row.currency)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(row.forward_yield_pct)}</td>
                  <td className="px-3 py-2 text-right font-medium text-green-400">
                    {fmtMoney(row.forward_dividend_annual, row.currency)}
                    {row.source === "csv" && (
                      <span
                        className="ml-1 inline-block rounded-full bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-normal text-amber-300 align-middle"
                        title="Estimated from dividend yield — actual payments not yet recorded. Refreshes after market close via Yahoo Finance."
                      >
                        est.
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fmtFrequency(row.payment_frequency)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400">
                    {row.last_payment_date ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
