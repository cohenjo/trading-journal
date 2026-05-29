"use client";
// Force dynamic rendering — charts need DOM and auth session.
export const dynamic = "force-dynamic";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MonthlyOverview } from "./_components/MonthlyOverview";
import { CategoryPie } from "./_components/CategoryPie";
import { UnresolvedQueue } from "./_components/UnresolvedQueue";
import { StatementsList } from "./_components/StatementsList";
import type { ByCategoryResponse, MonthlySummaryRow } from "@/types/expenses";
import { getMonthlySummary, getByCategory } from "@/lib/expenses/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "monthly" | "by-category" | "unresolved" | "statements";
type DateRange = "3m" | "6m" | "12m" | "custom";

const TAB_LABELS: Record<Tab, string> = {
  monthly: "סיכום חודשי",
  "by-category": "לפי קטגוריה",
  unresolved: "לא מסווגות",
  statements: "דפי חשבון",
};

// ── Date range helpers ────────────────────────────────────────────────────────

function toYYYYMM(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function dateRangeToParams(range: DateRange): { from: string; to: string } {
  const now = new Date(2026, 4, 1); // Today = 2026-05-01 (month-aligned)
  const to = toYYYYMM(now);
  const from = new Date(now);
  if (range === "3m") from.setMonth(from.getMonth() - 2);
  else if (range === "6m") from.setMonth(from.getMonth() - 5);
  else from.setMonth(from.getMonth() - 11); // 12m default
  return { from: toYYYYMM(from), to };
}

function currentMonth(): string {
  return toYYYYMM(new Date(2026, 4, 1));
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("monthly");

  // Monthly Overview state
  const [summaryData, setSummaryData] = useState<MonthlySummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("12m");
  const [includeTransfers, setIncludeTransfers] = useState(false);

  // By Category (pie) state
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth());
  const [drillDownSlug, setDrillDownSlug] = useState<string | null>(null);
  const [drillDownData, setDrillDownData] = useState<ByCategoryResponse | null>(null);
  const [drillDownLoading, setDrillDownLoading] = useState(false);

  // ── Fetch monthly summary ──────────────────────────────────────────────────

  const fetchSummary = useCallback(
    async (range: DateRange, transfers: boolean) => {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const { from, to } = dateRangeToParams(range);
        const rows = await getMonthlySummary({
          from,
          to,
          exclude_transfers: !transfers,
        });
        setSummaryData(rows);
      } catch {
        setSummaryError("שגיאה בטעינת נתוני ההוצאות");
      } finally {
        setSummaryLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchSummary(dateRange, includeTransfers);
  }, [fetchSummary, dateRange, includeTransfers]);

  // ── Handle bar click — drill down to By Category tab ─────────────────────

  function handleBarSegmentClick(month: string, categorySlug: string) {
    setSelectedMonth(month);
    setActiveTab("by-category");
    loadDrillDown(categorySlug, month);
  }

  // ── Load drill-down transactions ──────────────────────────────────────────

  function loadDrillDown(slug: string, month: string) {
    setDrillDownSlug(slug);
    setDrillDownLoading(true);
    setDrillDownData(null);
    const from = `${month}-01`;
    // Last day of month
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${month}-${String(lastDay).padStart(2, "0")}`;
    getByCategory(slug, { from, to })
      .then((res) => setDrillDownData(res))
      .catch(() => setDrillDownData(null))
      .finally(() => setDrillDownLoading(false));
  }

  function handleCategoryClick(slug: string) {
    loadDrillDown(slug, selectedMonth);
  }

  // ── Summary data filtered for the pie (pie always uses non-transfer data) ─

  const pieSummaryData = useMemo(
    () => summaryData.filter((r) => !r.category_name_he.includes("העברות")),
    [summaryData],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200" dir="ltr">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Page header */}
        <h1 className="text-2xl font-bold text-white mb-6">הוצאות אשראי</h1>

        {/* Tab nav */}
        <div
          className="flex gap-1 mb-6 border-b border-slate-700 pb-0"
          role="tablist"
          aria-label="לשוניות הוצאות"
        >
          {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`tab-panel-${tab}`}
              id={`tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? "border-blue-500 text-blue-400 bg-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              {TAB_LABELS[tab]}
              {tab === "unresolved" && " 🔴"}
            </button>
          ))}
        </div>

        {/* Tab panels */}

        {/* Monthly Overview */}
        <div
          role="tabpanel"
          id="tab-panel-monthly"
          aria-labelledby="tab-monthly"
          hidden={activeTab !== "monthly"}
        >
          {summaryError && (
            <div className="py-6 text-center text-red-400 flex items-center justify-center gap-2">
              <span aria-hidden="true">⚠️</span>
              <span>{summaryError}</span>
            </div>
          )}
          {summaryLoading && !summaryError && (
            <div className="py-8 text-center text-slate-400">טוען נתונים...</div>
          )}
          {!summaryLoading && !summaryError && (
            <MonthlyOverview
              data={summaryData}
              includeTransfers={includeTransfers}
              onToggleTransfers={setIncludeTransfers}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              onBarSegmentClick={handleBarSegmentClick}
            />
          )}
        </div>

        {/* By Category */}
        <div
          role="tabpanel"
          id="tab-panel-by-category"
          aria-labelledby="tab-by-category"
          hidden={activeTab !== "by-category"}
        >
          {summaryLoading && (
            <div className="py-8 text-center text-slate-400">טוען נתונים...</div>
          )}
          {!summaryLoading && (
            <CategoryPie
              summaryData={pieSummaryData}
              selectedMonth={selectedMonth}
              onMonthChange={(m) => {
                setSelectedMonth(m);
                if (drillDownSlug) loadDrillDown(drillDownSlug, m);
              }}
              onCategoryClick={handleCategoryClick}
              drillDownData={drillDownData}
              drillDownLoading={drillDownLoading}
              drillDownSlug={drillDownSlug}
            />
          )}
        </div>

        {/* Unresolved Queue */}
        <div
          role="tabpanel"
          id="tab-panel-unresolved"
          aria-labelledby="tab-unresolved"
          hidden={activeTab !== "unresolved"}
        >
          {activeTab === "unresolved" && <UnresolvedQueue />}
        </div>

        {/* Statements */}
        <div
          role="tabpanel"
          id="tab-panel-statements"
          aria-labelledby="tab-statements"
          hidden={activeTab !== "statements"}
        >
          {activeTab === "statements" && <StatementsList />}
        </div>
      </div>
    </div>
  );
}
