"use client";

import type { DividendPosition, PaymentFrequency } from "@/types/dividends";
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

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  rows: DividendPosition[];
}

/**
 * Renders enriched dividend positions sorted by forward_dividend_annual desc.
 * All monetary values use USD formatting via formatCurrency.
 */
export default function DividendPositionsTable({ rows }: Props) {
  const sorted = [...rows].sort(
    (a, b) => (b.forward_dividend_annual ?? 0) - (a.forward_dividend_annual ?? 0),
  );

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-sm text-left text-slate-300 border-collapse"
        data-testid="dividends-positions-table"
      >
        <thead className="text-xs text-slate-400 uppercase bg-slate-800 sticky top-0">
          <tr>
            <th scope="col" className="px-3 py-2 whitespace-nowrap">Ticker</th>
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
          {sorted.map((row) => (
            <tr
              key={row.ticker}
              className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
              data-testid={`dividend-row-${row.ticker}`}
            >
              <td className="px-3 py-2 font-semibold text-slate-100 whitespace-nowrap">
                {row.ticker}
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
                {row.source === 'csv' && (
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
