"use client";

import React, { useEffect, useState } from "react";
import type { Statement } from "@/types/expenses";
import { getStatements } from "@/lib/expenses/api";

const PAGE_SIZE = 20;

export function StatementsList() {
  const [items, setItems] = useState<Statement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getStatements({ page, page_size: PAGE_SIZE })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("שגיאה בטעינת הדפי חשבון"))
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (loading) {
    return <div className="py-8 text-center text-slate-400">טוען דפי חשבון...</div>;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-red-400 flex items-center justify-center gap-2">
        <span aria-hidden="true">⚠️</span>
        <span>{error}</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-slate-400">
        לא נמצאו דפי חשבון. העלה PDF כדי להתחיל.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm text-slate-300" aria-label="דפי חשבון אשראי">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-xs bg-slate-800/50">
              <th className="py-2 px-3 text-left">מנפיק</th>
              <th className="py-2 px-3 text-left">בעל הכרטיס</th>
              <th className="py-2 px-3 text-left">כרטיס</th>
              <th className="py-2 px-3 text-left">תקופה</th>
              <th className="py-2 px-3 text-right">סה״כ (₪)</th>
              <th className="py-2 px-3 text-right">עסקאות</th>
              <th className="py-2 px-3 text-center">אזהרות</th>
              <th className="py-2 px-3 text-left">נטען ב</th>
            </tr>
          </thead>
          <tbody>
            {items.map((stmt) => (
              <tr
                key={stmt.id}
                className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors"
              >
                <td className="py-2 px-3" dir="auto">
                  {stmt.issuer}
                </td>
                <td className="py-2 px-3" dir="auto">
                  {stmt.cardholder_name}
                </td>
                <td className="py-2 px-3 font-mono text-slate-400">
                  ****{stmt.card_last4}
                </td>
                <td className="py-2 px-3 text-slate-400 text-xs whitespace-nowrap">
                  {new Date(stmt.period_from).toLocaleDateString("he-IL")} –{" "}
                  {new Date(stmt.period_to).toLocaleDateString("he-IL")}
                </td>
                <td className="py-2 px-3 text-right font-medium tabular-nums">
                  {stmt.total_amount_ils != null
                    ? `₪${stmt.total_amount_ils.toLocaleString("he-IL", { maximumFractionDigits: 0 })}`
                    : "—"}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-400">
                  {stmt.txn_count ?? "—"}
                </td>
                <td className="py-2 px-3 text-center">
                  {stmt.parse_warnings_count > 0 ? (
                    <span
                      className="inline-flex items-center gap-1 text-amber-400 text-xs font-medium"
                      title={`${stmt.parse_warnings_count} אזהרות פענוח`}
                      aria-label={`${stmt.parse_warnings_count} אזהרות פענוח`}
                    >
                      {/* Icon + text so color is not the sole signal (accessibility) */}
                      <span aria-hidden="true">⚠</span>
                      {stmt.parse_warnings_count}
                    </span>
                  ) : (
                    <span className="text-green-500 text-xs" aria-label="ללא אזהרות">
                      ✓
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-slate-500 text-xs whitespace-nowrap">
                  {new Date(stmt.ingested_at).toLocaleDateString("he-IL")}
                </td>
              </tr>
            ))}
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
            עמוד {page} מתוך {totalPages} ({total} דפים)
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
    </div>
  );
}
