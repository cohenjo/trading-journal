/**
 * Tests for MonthlyOverview component (CC-8).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { MonthlyOverview } from "../_components/MonthlyOverview";
import type { MonthlySummaryRow } from "@/types/expenses";

// ── Mock @nivo/bar so tests don't need a DOM with ResizeObserver ─────────────
vi.mock("@nivo/bar", () => ({
  ResponsiveBar: ({
    data,
    keys,
    onClick,
  }: {
    data: Record<string, unknown>[];
    keys: string[];
    onClick?: (bar: { indexValue: unknown; id: unknown }) => void;
  }) => (
    <div data-testid="mock-bar-chart" data-keys={keys.join(",")}>
      {data.map((row) => (
        <div key={String(row.month)} data-testid={`bar-${row.month}`}>
          {keys.map((k) => (
            <button
              key={k}
              data-testid={`segment-${row.month}-${k}`}
              onClick={() => onClick?.({ indexValue: row.month, id: k })}
            >
              {k}: {String(row[k] ?? 0)}
            </button>
          ))}
        </div>
      ))}
    </div>
  ),
}));

// ── Mock data ─────────────────────────────────────────────────────────────────

const mockRows: MonthlySummaryRow[] = [
  { month: "2026-01", category_slug: "groceries", category_name: "Groceries", category_name_he: "מזון", amount_ils: 1200, txn_count: 10 },
  { month: "2026-01", category_slug: "restaurants", category_name: "Restaurants", category_name_he: "מסעדות", amount_ils: 800, txn_count: 5 },
  { month: "2026-01", category_slug: "transfers", category_name: "Transfers", category_name_he: "העברות כסף", amount_ils: 500, txn_count: 2 },
  { month: "2026-02", category_slug: "groceries", category_name: "Groceries", category_name_he: "מזון", amount_ils: 1100, txn_count: 8 },
];

const noop = () => {};

describe("MonthlyOverview", () => {
  it("renders stacked bar chart with mock data", () => {
    render(
      <MonthlyOverview
        data={mockRows}
        includeTransfers={false}
        onToggleTransfers={noop}
        dateRange="12m"
        onDateRangeChange={noop}
        onBarSegmentClick={noop}
      />,
    );
    expect(screen.getByTestId("mock-bar-chart")).toBeInTheDocument();
    // Both months should appear as separate bars
    expect(screen.getByTestId("bar-2026-01")).toBeInTheDocument();
    expect(screen.getByTestId("bar-2026-02")).toBeInTheDocument();
  });

  it("excludes transfers when toggle is OFF (default)", () => {
    render(
      <MonthlyOverview
        data={mockRows}
        includeTransfers={false}
        onToggleTransfers={noop}
        dateRange="12m"
        onDateRangeChange={noop}
        onBarSegmentClick={noop}
      />,
    );
    const chart = screen.getByTestId("mock-bar-chart");
    // 'transfers' should NOT appear as a key in the chart
    expect(chart.getAttribute("data-keys")).not.toContain("transfers");
    // 'groceries' and 'restaurants' should appear
    expect(chart.getAttribute("data-keys")).toContain("groceries");
  });

  it("includes transfers when toggle is ON", () => {
    render(
      <MonthlyOverview
        data={mockRows}
        includeTransfers={true}
        onToggleTransfers={noop}
        dateRange="12m"
        onDateRangeChange={noop}
        onBarSegmentClick={noop}
      />,
    );
    const chart = screen.getByTestId("mock-bar-chart");
    expect(chart.getAttribute("data-keys")).toContain("transfers");
  });

  it("calls onToggleTransfers when checkbox is changed", () => {
    const onToggle = vi.fn();
    render(
      <MonthlyOverview
        data={mockRows}
        includeTransfers={false}
        onToggleTransfers={onToggle}
        dateRange="12m"
        onDateRangeChange={noop}
        onBarSegmentClick={noop}
      />,
    );
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("calls onDateRangeChange when a range button is clicked", () => {
    const onRangeChange = vi.fn();
    render(
      <MonthlyOverview
        data={mockRows}
        includeTransfers={false}
        onToggleTransfers={noop}
        dateRange="12m"
        onDateRangeChange={onRangeChange}
        onBarSegmentClick={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "3 חודשים" }));
    expect(onRangeChange).toHaveBeenCalledWith("3m");
  });

  it("calls onBarSegmentClick when a bar segment is clicked", () => {
    const onSegmentClick = vi.fn();
    render(
      <MonthlyOverview
        data={mockRows}
        includeTransfers={false}
        onToggleTransfers={noop}
        dateRange="12m"
        onDateRangeChange={noop}
        onBarSegmentClick={onSegmentClick}
      />,
    );
    fireEvent.click(screen.getByTestId("segment-2026-01-groceries"));
    expect(onSegmentClick).toHaveBeenCalledWith("2026-01", "groceries");
  });

  it("shows empty state when data is empty", () => {
    render(
      <MonthlyOverview
        data={[]}
        includeTransfers={false}
        onToggleTransfers={noop}
        dateRange="12m"
        onDateRangeChange={noop}
        onBarSegmentClick={noop}
      />,
    );
    expect(screen.getByText("אין נתונים לתקופה זו")).toBeInTheDocument();
  });

  it("selected date range button has aria-pressed=true", () => {
    render(
      <MonthlyOverview
        data={mockRows}
        includeTransfers={false}
        onToggleTransfers={noop}
        dateRange="6m"
        onDateRangeChange={noop}
        onBarSegmentClick={noop}
      />,
    );
    const btn6 = screen.getByRole("button", { name: "6 חודשים" });
    expect(btn6).toHaveAttribute("aria-pressed", "true");
    const btn3 = screen.getByRole("button", { name: "3 חודשים" });
    expect(btn3).toHaveAttribute("aria-pressed", "false");
  });
});
