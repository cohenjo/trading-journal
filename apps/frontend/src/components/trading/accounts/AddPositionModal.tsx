"use client";

import React, { useState, useEffect, useRef } from "react";
import type { TradingAccountConfig } from "@/app/trading/actions";
import { createStockPosition, getTickerSymbols } from "@/app/trading/actions";

export interface AddPositionModalProps {
  account: TradingAccountConfig;
  onClose: () => void;
  onSuccess: () => void;
}

const today = (): string => new Date().toISOString().split("T")[0];

export default function AddPositionModal({ account, onClose, onSuccess }: AddPositionModalProps) {
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [asOfDate, setAsOfDate] = useState(today());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tickerSuggestions, setTickerSuggestions] = useState<string[]>([]);
  const [allTickers, setAllTickers] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const tickerInputRef = useRef<HTMLInputElement>(null);

  const accountName = account.name ?? account.account_id ?? "Account";

  useEffect(() => {
    getTickerSymbols().then(setAllTickers).catch(() => setAllTickers([]));
  }, []);

  const handleTickerChange = (value: string) => {
    const upper = value.toUpperCase();
    setTicker(upper);
    if (upper.length > 0) {
      const matches = allTickers.filter((t) => t.startsWith(upper)).slice(0, 10);
      setTickerSuggestions(matches);
      setShowDropdown(matches.length > 0);
    } else {
      setShowDropdown(false);
    }
  };

  const selectTicker = (t: string) => {
    setTicker(t);
    setShowDropdown(false);
    tickerInputRef.current?.focus();
  };

  const validate = (): string | null => {
    if (!ticker.trim()) return "Ticker is required";
    const qty = parseFloat(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return "Quantity must be greater than 0";
    if (!asOfDate) return "As-of date is required";
    if (costBasis !== "") {
      const cb = parseFloat(costBasis);
      if (!Number.isFinite(cb) || cb < 0) return "Cost basis must be a non-negative number";
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);

    const result = await createStockPosition({
      account_id: account.id,
      ticker: ticker.trim().toUpperCase(),
      quantity: parseFloat(quantity),
      cost_basis: costBasis !== "" ? parseFloat(costBasis) : null,
      as_of_date: asOfDate,
    });

    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onSuccess();
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-position-title"
      data-testid="add-position-modal"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md mx-4 p-6 shadow-2xl">
        <h2 id="add-position-title" className="text-lg font-semibold text-slate-100 mb-5">
          Add Position — {accountName}
        </h2>

        <form data-testid="position-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Ticker */}
          <div className="relative">
            <label htmlFor="ticker" className="block text-sm text-slate-400 mb-1">
              Ticker <span className="text-red-400">*</span>
            </label>
            <input
              id="ticker"
              ref={tickerInputRef}
              type="text"
              value={ticker}
              onChange={(e) => handleTickerChange(e.target.value)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              onFocus={() => {
                if (ticker.length > 0 && tickerSuggestions.length > 0) setShowDropdown(true);
              }}
              placeholder="e.g. VYM"
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500 text-sm"
              autoComplete="off"
              data-testid="ticker-input"
            />
            {showDropdown && (
              <ul
                className="absolute z-10 mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-48 overflow-auto text-sm"
                data-testid="ticker-dropdown"
              >
                {tickerSuggestions.map((t) => (
                  <li key={t}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-slate-200 hover:bg-slate-700 transition-colors"
                      onMouseDown={() => selectTicker(t)}
                    >
                      {t}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label htmlFor="quantity" className="block text-sm text-slate-400 mb-1">
              Quantity <span className="text-red-400">*</span>
            </label>
            <input
              id="quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 50"
              min="0"
              step="any"
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500 text-sm"
              data-testid="quantity-input"
            />
          </div>

          {/* Cost Basis */}
          <div>
            <label htmlFor="cost-basis" className="block text-sm text-slate-400 mb-1">
              Cost Basis / Share{" "}
              <span className="text-slate-600 text-xs">(optional)</span>
            </label>
            <input
              id="cost-basis"
              type="number"
              value={costBasis}
              onChange={(e) => setCostBasis(e.target.value)}
              placeholder="e.g. 104.20"
              min="0"
              step="any"
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500 text-sm"
              data-testid="cost-basis-input"
            />
          </div>

          {/* As-of Date */}
          <div>
            <label htmlFor="as-of-date" className="block text-sm text-slate-400 mb-1">
              As-of Date <span className="text-red-400">*</span>
            </label>
            <input
              id="as-of-date"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-slate-500 text-sm"
              data-testid="date-input"
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2" data-testid="form-error">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors text-sm"
              data-testid="cancel-button"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition-colors text-sm disabled:opacity-50"
              data-testid="save-button"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
