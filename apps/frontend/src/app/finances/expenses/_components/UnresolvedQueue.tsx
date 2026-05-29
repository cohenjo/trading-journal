"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Decimal from "decimal.js";
import type { UnresolvedTransaction, ResolveRequest } from "@/types/expenses";
import type { CategorySelection } from "./CategoryPicker";
import { CategoryPicker } from "./CategoryPicker";
import { getUnresolved, resolveTransaction } from "@/lib/expenses/api";

const PAGE_SIZE = 50;

interface RowState {
  selection: CategorySelection | null;
  applyToAll: boolean;
  confirming: boolean;
}

interface BulkModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (selection: CategorySelection) => void;
  count: number;
}

function BulkModal({ open, onClose, onConfirm, count }: BulkModalProps) {
  const [selection, setSelection] = useState<CategorySelection | null>(null);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="פתרון מרובה עסקאות"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6 w-96 space-y-4">
        <h2 className="text-lg font-semibold text-white">סיווג {count} עסקאות</h2>
        <CategoryPicker
          value={selection}
          onChange={setSelection}
          ariaLabel="בחר קטגוריה לעסקאות שנבחרו"
        />
        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            ביטול
          </button>
          <button
            type="button"
            disabled={!selection}
            onClick={() => selection && onConfirm(selection)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            אשר
          </button>
        </div>
      </div>
    </div>
  );
}

export function UnresolvedQueue() {
  const [items, setItems] = useState<UnresolvedTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getUnresolved({ page, page_size: PAGE_SIZE, search: search || undefined });
      setItems(res.items);
      setTotal(res.total);
      // Initialise row state for any new rows (default: applyToAll = true)
      setRowStates((prev) => {
        const next = { ...prev };
        for (const txn of res.items) {
          if (!next[txn.id]) {
            next[txn.id] = { selection: null, applyToAll: true, confirming: false };
          }
        }
        return next;
      });
    } catch {
      toast.error("שגיאה בטעינת העסקאות");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // Debounced search
  function handleSearchChange(val: string) {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 350);
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function confirmRow(txn: UnresolvedTransaction) {
    const state = rowStates[txn.id];
    if (!state?.selection) return;

    updateRow(txn.id, { confirming: true });
    try {
      const body: ResolveRequest = {
        transaction_id: txn.id,
        category_id: state.selection.category.id,
        subcategory_id: state.selection.subcategory?.id ?? null,
        apply_to_all_matching: state.applyToAll,
      };
      const result = await resolveTransaction(body);
      const msg =
        result.updated_count > 1
          ? `עודכנו ${result.updated_count} עסקאות תואמות`
          : "עסקה סווגה בהצלחה";
      toast.success(msg);
      // Remove from queue optimistically
      setItems((prev) => prev.filter((i) => i.id !== txn.id));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch {
      toast.error("שגיאה בשמירת הסיווג");
    } finally {
      updateRow(txn.id, { confirming: false });
    }
  }

  async function handleBulkConfirm(selection: CategorySelection) {
    setBulkModalOpen(false);
    const ids = Array.from(selectedIds);
    let successCount = 0;
    for (const id of ids) {
      const txn = items.find((i) => i.id === id);
      if (!txn) continue;
      try {
        await resolveTransaction({
          transaction_id: id,
          category_id: selection.category.id,
          subcategory_id: selection.subcategory?.id ?? null,
          apply_to_all_matching: false,
        });
        successCount++;
        setItems((prev) => prev.filter((i) => i.id !== id));
        setTotal((prev) => Math.max(0, prev - 1));
      } catch {
        // continue on individual failure
      }
    }
    setSelectedIds(new Set());
    if (successCount > 0) toast.success(`${successCount} עסקאות סווגו בהצלחה`);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Search + bulk actions */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="חיפוש לפי שם עסק..."
          dir="auto"
          className="flex-1 min-w-48 px-3 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="חיפוש לפי שם עסק"
        />
        <span className="text-sm text-slate-400">
          {total} עסקאות לא מסווגות
        </span>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => setBulkModalOpen(true)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            סיווג {selectedIds.size} נבחרות
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table
          className="w-full text-sm text-slate-300"
          aria-label="תור עסקאות לא מסווגות"
        >
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-xs bg-slate-800/50">
              <th className="py-2 px-3 text-left w-8">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selectedIds.size === items.length}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded accent-blue-500"
                  aria-label="בחר הכל"
                />
              </th>
              <th className="py-2 px-3 text-left">תאריך</th>
              <th className="py-2 px-3 text-left">בית עסק</th>
              <th className="py-2 px-3 text-right">סכום (₪)</th>
              <th className="py-2 px-3 text-left w-56">קטגוריה</th>
              <th className="py-2 px-3 text-left">כל ה-</th>
              <th className="py-2 px-3 text-left">פעולה</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  טוען...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  {search ? "לא נמצאו עסקאות" : "🎉 כל העסקאות מסווגות!"}
                </td>
              </tr>
            )}
            {!loading &&
              items.map((txn) => {
                const state = rowStates[txn.id] ?? {
                  selection: null,
                  applyToAll: true,
                  confirming: false,
                };
                const amountDisplay = new Decimal(txn.amount_ils).toFixed(2);

                return (
                  <tr
                    key={txn.id}
                    className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors"
                  >
                    {/* Checkbox */}
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(txn.id)}
                        onChange={() => toggleSelect(txn.id)}
                        className="w-4 h-4 rounded accent-blue-500"
                        aria-label={`בחר עסקה ${txn.merchant_normalized}`}
                      />
                    </td>

                    {/* Date */}
                    <td className="py-2 px-3 whitespace-nowrap text-slate-400 text-xs">
                      {new Date(txn.txn_date).toLocaleDateString("he-IL")}
                    </td>

                    {/* Merchant — normalized only (Rabin §3.2, §6.1) */}
                    <td className="py-2 px-3">
                      <span dir="auto" className="text-slate-200">
                        {/* Rabin §6.1: plain React escaped text — no dangerouslySetInnerHTML */}
                        {txn.merchant_normalized}
                      </span>
                      {txn.sector_raw && (
                        <span className="ml-2 text-xs text-slate-500" dir="auto">
                          ({txn.sector_raw})
                        </span>
                      )}
                    </td>

                    {/* Amount */}
                    <td className="py-2 px-3 text-right font-medium text-white tabular-nums">
                      ₪{amountDisplay}
                    </td>

                    {/* Category picker */}
                    <td className="py-2 px-3 w-56">
                      <CategoryPicker
                        value={state.selection}
                        onChange={(sel) => updateRow(txn.id, { selection: sel })}
                        ariaLabel={`בחר קטגוריה לעסקה ${txn.merchant_normalized}`}
                      />
                    </td>

                    {/* Apply to all */}
                    <td className="py-2 px-3">
                      <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={state.applyToAll}
                          onChange={(e) => updateRow(txn.id, { applyToAll: e.target.checked })}
                          className="w-3.5 h-3.5 rounded accent-blue-500"
                          aria-label={`החל על כל עסקאות ${txn.merchant_normalized}`}
                        />
                        החל על כולן
                      </label>
                    </td>

                    {/* Confirm */}
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        disabled={!state.selection || state.confirming}
                        onClick={() => confirmRow(txn)}
                        className="px-3 py-1 text-xs bg-green-700 text-white rounded hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-1 focus:ring-green-400"
                        aria-label={`אשר סיווג לעסקה ${txn.merchant_normalized}`}
                      >
                        {state.confirming ? "שומר..." : "אשר"}
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition-colors"
            aria-label="עמוד קודם"
          >
            ← הקודם
          </button>
          <span>
            עמוד {page} מתוך {totalPages} ({total} עסקאות)
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition-colors"
            aria-label="עמוד הבא"
          >
            הבא →
          </button>
        </div>
      )}

      {/* Bulk resolve modal */}
      <BulkModal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        onConfirm={handleBulkConfirm}
        count={selectedIds.size}
      />
    </div>
  );
}
