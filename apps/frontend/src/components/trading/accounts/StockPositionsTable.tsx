"use client";

import React from "react";
import type { StockPosition } from "@/app/trading/actions";

export interface StockPositionsTableProps {
  mode: "readonly" | "editable";
  positions: StockPosition[];
  onDelete?: (id: string) => void;
}

/** Formats a number as currency for the given ISO currency code. */
function formatCurrency(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
}

export default function StockPositionsTable({
  mode,
  positions,
  onDelete,
}: StockPositionsTableProps) {
  const totalMarketValue = positions.reduce((sum, p) => sum + (p.market_value ?? 0), 0);

  if (positions.length === 0) {
    return (
      <div className="text-center py-10 text-slate-500 text-sm" data-testid="empty-state">
        No positions yet.{mode === "editable" && " Click + Add Position to get started."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm" data-testid="positions-table">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left">Ticker</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-left">Sub-Category</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Cost Basis</th>
              <th className="px-4 py-3 text-right">Mark Price</th>
              <th className="px-4 py-3 text-right">Market Value</th>
              <th className="px-4 py-3 text-right">Unrealized P&amp;L</th>
              {mode === "editable" && <th className="px-4 py-3 text-center">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <PositionRow
                key={position.id}
                position={position}
                mode={mode}
                onDelete={onDelete}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 bg-slate-900/40">
              <td
                colSpan={mode === "editable" ? 9 : 8}
                className="px-4 py-3 text-right text-slate-300 font-semibold"
              >
                Total Market Value:{" "}
                <span className="text-slate-100 ml-2">
                  {formatCurrency(totalMarketValue, positions[0]?.currency ?? "USD")}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

interface PositionRowProps {
  position: StockPosition;
  mode: "readonly" | "editable";
  onDelete?: (id: string) => void;
}

function PositionRow({ position, mode, onDelete }: PositionRowProps) {
  const pnlColor =
    position.unrealized_pnl == null
      ? "text-slate-400"
      : position.unrealized_pnl >= 0
        ? "text-emerald-400"
        : "text-red-400";

  return (
    <tr
      className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
      data-testid="position-row"
    >
      <td className="px-4 py-3 font-medium text-slate-100">{position.ticker}</td>
      <td className="px-4 py-3 text-slate-400 max-w-[180px] truncate" title={position.description ?? undefined}>
        {position.description ?? "—"}
      </td>
      <td className="px-4 py-3 text-slate-400">{position.sub_category ?? "—"}</td>
      <td className="px-4 py-3 text-right text-slate-200">{formatQuantity(position.quantity)}</td>
      <td className="px-4 py-3 text-right text-slate-300">
        {formatCurrency(position.cost_basis, position.currency)}
      </td>
      <td className="px-4 py-3 text-right text-slate-300">
        {formatCurrency(position.mark_price, position.currency)}
      </td>
      <td className="px-4 py-3 text-right text-slate-200 font-medium">
        {formatCurrency(position.market_value, position.currency)}
      </td>
      <td className={`px-4 py-3 text-right font-medium ${pnlColor}`}>
        {position.unrealized_pnl == null
          ? "—"
          : `${position.unrealized_pnl >= 0 ? "+" : ""}${formatCurrency(position.unrealized_pnl, position.currency)}`}
      </td>
      {mode === "editable" && (
        <td className="px-4 py-3 text-center">
          <button
            onClick={() => onDelete?.(position.id)}
            className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded"
            title="Delete position"
            aria-label={`Delete ${position.ticker}`}
            data-testid="delete-position"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          </button>
        </td>
      )}
    </tr>
  );
}
