"use client";

import React, { useState } from "react";
import type { StockPosition } from "@/app/trading/actions";

export interface StockPositionsTableProps {
  mode: "readonly" | "editable";
  positions: StockPosition[];
  onDelete?: (id: string) => void;
  onEdit?: (position: StockPosition) => void;
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

/**
 * Normalises 'ILA' (Israeli agorot) to 'ILS' for display purposes.
 * market_value is stored in ILS even when currency='ILA'; using 'ILA' as the
 * Intl currency code is misleading so we always render as ILS.
 */
function toDisplayCurrency(currency: string): string {
  return currency.toUpperCase() === "ILA" ? "ILS" : currency;
}

/**
 * Converts a per-share mark_price to its display value.
 * TASE positions store mark_price in agorot (ILA = 1/100 ILS), so divide by
 * 100 before rendering to show the familiar ILS per-share price.
 */
function toDisplayMarkPrice(price: number | null, currency: string): number | null {
  if (price == null) return null;
  return currency.toUpperCase() === "ILA" ? price / 100 : price;
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
}

export default function StockPositionsTable({
  mode,
  positions,
  onDelete,
  onEdit,
}: StockPositionsTableProps) {
  const totalMarketValue = positions.reduce((sum, p) => sum + (p.market_value ?? p.market_value_local ?? 0), 0);

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
                onEdit={onEdit}
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
                  {formatCurrency(totalMarketValue, toDisplayCurrency(positions[0]?.currency ?? "USD"))}
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
  onEdit?: (position: StockPosition) => void;
}

function PositionRow({ position, mode, onDelete, onEdit }: PositionRowProps) {
  const [confirming, setConfirming] = useState(false);

  const pnlColor =
    position.unrealized_pnl == null
      ? "text-slate-400"
      : position.unrealized_pnl >= 0
        ? "text-emerald-400"
        : "text-red-400";

  const handleDeleteClick = () => {
    if (confirming) {
      onDelete?.(position.id);
      setConfirming(false);
    } else {
      setConfirming(true);
    }
  };

  const handleCancelDelete = () => setConfirming(false);

  return (
    <tr
      className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
      data-testid="position-row"
    >
      <td className="px-4 py-3 font-medium text-slate-100">
        {/^\d+$/.test(position.ticker) && position.description ? (
          <span className="flex flex-col gap-0.5">
            <span>{position.ticker}</span>
            <span className="block text-xs text-slate-500 mt-0.5 font-normal" dir="rtl">
              {position.description}
            </span>
          </span>
        ) : (
          position.ticker
        )}
      </td>
      <td className="px-4 py-3 text-slate-400 max-w-[180px] truncate" title={position.description ?? undefined}>
        {position.description ?? "—"}
      </td>
      <td className="px-4 py-3 text-slate-400">{position.sub_category ?? "—"}</td>
      <td className="px-4 py-3 text-right text-slate-200">{formatQuantity(position.quantity)}</td>
      <td className="px-4 py-3 text-right text-slate-300">
        {formatCurrency(toDisplayMarkPrice(position.cost_basis, position.currency), toDisplayCurrency(position.currency))}
      </td>
      <td className="px-4 py-3 text-right text-slate-300">
        {formatCurrency(toDisplayMarkPrice(position.mark_price, position.currency), toDisplayCurrency(position.currency))}
      </td>
      <td className="px-4 py-3 text-right text-slate-200 font-medium">
        {formatCurrency(position.market_value ?? position.market_value_local, toDisplayCurrency(position.currency))}
      </td>
      <td className={`px-4 py-3 text-right font-medium ${pnlColor}`}>
        {position.unrealized_pnl == null
          ? "—"
          : `${position.unrealized_pnl >= 0 ? "+" : ""}${formatCurrency(position.unrealized_pnl, position.currency)}`}
      </td>
      {mode === "editable" && (
        <td className="px-4 py-3 text-center">
          {confirming ? (
            <span className="inline-flex items-center gap-1">
              <button
                onClick={handleDeleteClick}
                className="text-xs px-2 py-0.5 rounded bg-red-800 hover:bg-red-700 text-white transition-colors"
                data-testid="confirm-delete"
              >
                Confirm
              </button>
              <button
                onClick={handleCancelDelete}
                className="text-xs px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-slate-200 transition-colors"
                data-testid="cancel-delete"
              >
                Cancel
              </button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <button
                onClick={() => onEdit?.(position)}
                className="text-slate-500 hover:text-blue-400 transition-colors p-1 rounded"
                title="Edit position"
                aria-label={`Edit ${position.ticker}`}
                data-testid="edit-position"
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
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                onClick={handleDeleteClick}
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
            </span>
          )}
        </td>
      )}
    </tr>
  );
}
