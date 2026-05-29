"use client";

import React, { useMemo } from "react";
import { ResponsiveBar } from "@nivo/bar";
import Decimal from "decimal.js";
import type { MonthlySummaryRow } from "@/types/expenses";
import { getCategoryColor, EXPENSE_CATEGORIES } from "@/types/expenses";

interface MonthlyOverviewProps {
  data: MonthlySummaryRow[];
  includeTransfers: boolean;
  onToggleTransfers: (include: boolean) => void;
  dateRange: "3m" | "6m" | "12m" | "custom";
  onDateRangeChange: (range: "3m" | "6m" | "12m" | "custom") => void;
  onBarSegmentClick: (month: string, categorySlug: string) => void;
}

/** Pivot raw MonthlySummaryRow[] into the shape @nivo/bar expects. */
function pivotData(
  rows: MonthlySummaryRow[],
  includeTransfers: boolean,
): {
  pivoted: Record<string, unknown>[];
  keys: string[];
  labelMap: Record<string, string>;
} {
  const transferSlugs = new Set(
    EXPENSE_CATEGORIES.filter((c) => c.is_transfer).map((c) => c.slug),
  );

  const filtered = includeTransfers
    ? rows
    : rows.filter((r) => !transferSlugs.has(r.category_slug));

  // Collect unique months (sorted ascending) and category slugs
  const monthSet = new Set<string>();
  const slugSet = new Set<string>();
  for (const r of filtered) {
    monthSet.add(r.month);
    slugSet.add(r.category_slug);
  }

  const months = Array.from(monthSet).sort();
  const keys = Array.from(slugSet);

  // Build label map: slug → Hebrew name
  const labelMap: Record<string, string> = {};
  for (const r of filtered) {
    if (!labelMap[r.category_slug]) {
      labelMap[r.category_slug] = r.category_name_he;
    }
  }

  // Build one row per month with precise Decimal accumulation
  const pivoted = months.map((month) => {
    const row: Record<string, unknown> = { month };
    for (const slug of keys) {
      const matching = filtered.filter((r) => r.month === month && r.category_slug === slug);
      const total = matching.reduce((acc, r) => acc.plus(new Decimal(r.amount_ils)), new Decimal(0));
      row[slug] = total.toNumber();
    }
    return row;
  });

  return { pivoted, keys, labelMap };
}

const DATE_RANGE_OPTIONS = [
  { value: "3m" as const, label: "3 חודשים" },
  { value: "6m" as const, label: "6 חודשים" },
  { value: "12m" as const, label: "12 חודשים" },
];

export function MonthlyOverview({
  data,
  includeTransfers,
  onToggleTransfers,
  dateRange,
  onDateRangeChange,
  onBarSegmentClick,
}: MonthlyOverviewProps) {
  const { pivoted, keys, labelMap } = useMemo(
    () => pivotData(data, includeTransfers),
    [data, includeTransfers],
  );

  const colors = useMemo(
    () => keys.reduce<Record<string, string>>((acc, slug) => ({ ...acc, [slug]: getCategoryColor(slug) }), {}),
    [keys],
  );

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        אין נתונים לתקופה זו
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Date range picker */}
        <div className="flex items-center gap-2" role="group" aria-label="בחר טווח תאריכים">
          {DATE_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onDateRangeChange(opt.value)}
              className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${
                dateRange === opt.value
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
              aria-pressed={dateRange === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Transfers toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-300">
          <input
            type="checkbox"
            checked={includeTransfers}
            onChange={(e) => onToggleTransfers(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-500"
            aria-label="כלול העברות בסה״כ"
          />
          כלול העברות בסה״כ
        </label>
      </div>

      {/* Stacked bar chart */}
      <div className="h-80" role="img" aria-label="גרף הוצאות חודשי לפי קטגוריה">
        <ResponsiveBar
          data={pivoted}
          keys={keys}
          indexBy="month"
          margin={{ top: 10, right: 180, bottom: 50, left: 70 }}
          padding={0.3}
          groupMode="stacked"
          valueScale={{ type: "linear" }}
          indexScale={{ type: "band", round: true }}
          colors={(bar) => colors[bar.id as string] ?? "#BDBDBD"}
          borderColor={{ from: "color", modifiers: [["darker", 1.6]] }}
          axisTop={null}
          axisRight={null}
          axisBottom={{
            tickSize: 5,
            tickPadding: 5,
            tickRotation: -30,
            legend: "חודש",
            legendPosition: "middle",
            legendOffset: 40,
          }}
          axisLeft={{
            tickSize: 5,
            tickPadding: 5,
            tickRotation: 0,
            legend: "₪",
            legendPosition: "middle",
            legendOffset: -55,
            format: (v) => `₪${(v as number).toLocaleString()}`,
          }}
          enableLabel={false}
          legends={[
            {
              dataFrom: "keys",
              anchor: "bottom-right",
              direction: "column",
              justify: false,
              translateX: 120,
              translateY: 0,
              itemsSpacing: 2,
              itemWidth: 110,
              itemHeight: 20,
              itemDirection: "left-to-right",
              itemOpacity: 0.85,
              symbolSize: 12,
              effects: [{ on: "hover", style: { itemOpacity: 1 } }],
              data: keys.map((k) => ({
                id: k,
                label: labelMap[k] ?? k,
                color: colors[k] ?? "#BDBDBD",
              })),
            },
          ]}
          tooltip={({ id, value, indexValue, color }) => (
            <div className="bg-slate-900 border border-slate-700 px-3 py-2 rounded shadow-lg text-sm">
              <div className="font-semibold text-white mb-1">{String(indexValue)}</div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span className="text-slate-300">{labelMap[String(id)] ?? id}</span>
                <span className="text-white font-medium">
                  ₪{(value as number).toLocaleString("he-IL", { minimumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          )}
          onClick={(bar) => {
            onBarSegmentClick(String(bar.indexValue), String(bar.id));
          }}
          theme={{
            axis: { ticks: { text: { fill: "#94a3b8" } }, legend: { text: { fill: "#94a3b8" } } },
            grid: { line: { stroke: "#334155", strokeWidth: 1 } },
            legends: { text: { fill: "#cbd5e1" } },
            tooltip: { container: { background: "transparent", border: "none", padding: 0 } },
          }}
        />
      </div>
    </div>
  );
}
