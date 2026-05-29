"use client";

import React, { useMemo, useState } from "react";
import { ResponsivePie } from "@nivo/pie";
import Decimal from "decimal.js";
import type { MonthlySummaryRow, TransactionDetail, ByCategoryResponse } from "@/types/expenses";
import { getCategoryColor, EXPENSE_CATEGORIES } from "@/types/expenses";

interface CategoryPieProps {
  summaryData: MonthlySummaryRow[];
  selectedMonth: string; // 'YYYY-MM'
  onMonthChange: (month: string) => void;
  /** Called when a pie slice is clicked; parent should load transactions. */
  onCategoryClick: (slug: string) => void;
  /** Transaction drill-down data (populated after a slice click). */
  drillDownData: ByCategoryResponse | null;
  drillDownLoading: boolean;
  drillDownSlug: string | null;
}

interface PieDatum {
  id: string;
  label: string;
  value: number;
  color: string;
}

function buildPieData(summaryData: MonthlySummaryRow[], month: string): PieDatum[] {
  const transferSlugs = new Set(
    EXPENSE_CATEGORIES.filter((c) => c.is_transfer).map((c) => c.slug),
  );

  const totals = new Map<string, { amount: Decimal; nameHe: string }>();

  for (const row of summaryData) {
    if (row.month !== month) continue;
    if (transferSlugs.has(row.category_slug)) continue;
    const prev = totals.get(row.category_slug);
    if (prev) {
      prev.amount = prev.amount.plus(new Decimal(row.amount_ils));
    } else {
      totals.set(row.category_slug, {
        amount: new Decimal(row.amount_ils),
        nameHe: row.category_name_he,
      });
    }
  }

  return Array.from(totals.entries()).map(([slug, { amount, nameHe }]) => ({
    id: slug,
    label: nameHe,
    value: amount.toNumber(),
    color: getCategoryColor(slug),
  }));
}

function formatMonthHe(ym: string): string {
  const [year, month] = ym.split("-");
  try {
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("he-IL", {
      month: "long",
      year: "numeric",
    });
  } catch {
    return ym;
  }
}

export function CategoryPie({
  summaryData,
  selectedMonth,
  onMonthChange,
  onCategoryClick,
  drillDownData,
  drillDownLoading,
  drillDownSlug,
}: CategoryPieProps) {
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set());

  const pieData = useMemo(
    () => buildPieData(summaryData, selectedMonth),
    [summaryData, selectedMonth],
  );

  // Unique months available (sorted desc)
  const availableMonths = useMemo(
    () =>
      Array.from(new Set(summaryData.map((r) => r.month)))
        .sort()
        .reverse(),
    [summaryData],
  );

  const totalSpend = useMemo(
    () => pieData.reduce((acc, d) => acc.plus(new Decimal(d.value)), new Decimal(0)).toNumber(),
    [pieData],
  );

  function toggleExpand(slug: string) {
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  if (pieData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        אין נתונים לחודש זה
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Month picker */}
      <div className="flex items-center gap-3">
        <label htmlFor="month-picker" className="text-sm text-slate-400">
          חודש:
        </label>
        <select
          id="month-picker"
          value={selectedMonth}
          onChange={(e) => onMonthChange(e.target.value)}
          className="bg-slate-800 text-slate-200 border border-slate-600 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="בחר חודש"
        >
          {availableMonths.map((m) => (
            <option key={m} value={m}>
              {formatMonthHe(m)}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-400">
          סה״כ: ₪{totalSpend.toLocaleString("he-IL", { maximumFractionDigits: 0 })}
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Pie chart */}
        <div
          className="h-72 lg:w-72 flex-shrink-0"
          role="img"
          aria-label={`תרשים עוגה — הוצאות לפי קטגוריה ${formatMonthHe(selectedMonth)}`}
        >
          <ResponsivePie
            data={pieData}
            margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
            innerRadius={0.45}
            padAngle={1}
            cornerRadius={3}
            activeOuterRadiusOffset={6}
            colors={(d) => (d.data as PieDatum).color}
            borderWidth={1}
            borderColor={{ from: "color", modifiers: [["darker", 0.4]] }}
            enableArcLinkLabels={false}
            enableArcLabels={false}
            tooltip={({ datum }) => (
              <div className="bg-slate-900 border border-slate-700 px-3 py-2 rounded shadow-lg text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ backgroundColor: (datum.data as PieDatum).color }}
                    aria-hidden="true"
                  />
                  <span className="text-slate-300">{datum.label}</span>
                </div>
                <div className="text-white font-medium mt-0.5">
                  ₪{datum.value.toLocaleString("he-IL", { minimumFractionDigits: 0 })}
                </div>
                <div className="text-slate-400 text-xs">
                  {((datum.value / totalSpend) * 100).toFixed(1)}%
                </div>
              </div>
            )}
            onClick={(datum) => onCategoryClick(String(datum.id))}
            theme={{
              tooltip: { container: { background: "transparent", border: "none", padding: 0 } },
            }}
          />
        </div>

        {/* Side panel — collapsible category list */}
        <div className="flex-1 overflow-y-auto max-h-72 space-y-1" role="list" aria-label="רשימת קטגוריות">
          {pieData
            .sort((a, b) => b.value - a.value)
            .map((d) => {
              const category = EXPENSE_CATEGORIES.find((c) => c.slug === d.id);
              const subcats = category?.subcategories ?? [];
              const isExpanded = expandedSlugs.has(d.id);
              const isActive = drillDownSlug === d.id;

              return (
                <div key={d.id} role="listitem">
                  <button
                    type="button"
                    onClick={() => {
                      toggleExpand(d.id);
                      onCategoryClick(d.id);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                      isActive
                        ? "bg-slate-700 text-white"
                        : "hover:bg-slate-800 text-slate-300"
                    }`}
                    aria-expanded={subcats.length > 0 ? isExpanded : undefined}
                  >
                    <span
                      className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: d.color }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 text-right" dir="auto">
                      {d.label}
                    </span>
                    <span className="text-slate-400 font-medium ml-auto">
                      ₪{d.value.toLocaleString("he-IL", { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-slate-500 text-xs">
                      {((d.value / totalSpend) * 100).toFixed(1)}%
                    </span>
                    {subcats.length > 0 && (
                      <span className="text-slate-500 ml-1" aria-hidden="true">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    )}
                  </button>
                  {isExpanded && subcats.length > 0 && (
                    <div className="ml-6 mt-1 space-y-1" role="list" aria-label={`תת-קטגוריות של ${d.label}`}>
                      {subcats.map((sub) => (
                        <div key={sub.slug} className="px-3 py-1.5 text-xs text-slate-400" dir="auto" role="listitem">
                          {sub.name_he}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Transaction drill-down */}
      {(drillDownLoading || drillDownData) && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">
            {drillDownLoading
              ? "טוען עסקאות..."
              : drillDownData
              ? `עסקאות — ${pieData.find((d) => d.id === drillDownSlug)?.label ?? drillDownSlug} (${drillDownData.total})`
              : ""}
          </h3>
          {drillDownData && !drillDownLoading && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-slate-300" aria-label="טבלת עסקאות">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400 text-xs">
                    <th className="py-2 px-3 text-left">תאריך</th>
                    <th className="py-2 px-3 text-left">בית עסק</th>
                    <th className="py-2 px-3 text-right">סכום</th>
                  </tr>
                </thead>
                <tbody>
                  {drillDownData.items.map((txn: TransactionDetail) => (
                    <tr key={txn.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                      <td className="py-2 px-3 text-slate-400 text-xs whitespace-nowrap">
                        {new Date(txn.txn_date).toLocaleDateString("he-IL")}
                      </td>
                      <td className="py-2 px-3" dir="auto">
                        {/* Rabin §6.1: render as escaped React text, no dangerouslySetInnerHTML */}
                        {txn.merchant_normalized}
                      </td>
                      <td className="py-2 px-3 text-right font-medium">
                        ₪{txn.amount_ils.toLocaleString("he-IL", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700">
                    <td colSpan={2} className="py-2 px-3 text-slate-400 text-xs">
                      סה״כ
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-white">
                      ₪{drillDownData.subtotal_ils.toLocaleString("he-IL", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
