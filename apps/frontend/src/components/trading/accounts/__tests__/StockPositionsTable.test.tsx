import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import StockPositionsTable from "../StockPositionsTable";
import type { StockPosition } from "@/app/trading/actions";

const makePosition = (overrides: Partial<StockPosition> = {}): StockPosition => ({
  id: "pos-1",
  account_id: 1,
  ticker: "VYM",
  description: "Vanguard High Dividend Yield ETF",
  sub_category: "COMMON",
  quantity: 50,
  cost_basis: 104.2,
  mark_price: 118.45,
  market_value: 5922.5,
  unrealized_pnl: 712.5,
  currency: "USD",
  as_of_date: "2026-05-09",
  source: "manual",
  ...overrides,
});

const USD_POSITIONS: StockPosition[] = [
  makePosition({ id: "pos-1", ticker: "VYM", market_value: 5922.5, unrealized_pnl: 712.5 }),
  makePosition({ id: "pos-2", ticker: "SCHD", quantity: 30, cost_basis: 73.1, mark_price: 82.33, market_value: 2469.9, unrealized_pnl: 276.9 }),
];

const MULTI_CURRENCY_POSITIONS: StockPosition[] = [
  makePosition({ id: "p1", ticker: "AAPL", currency: "USD", market_value: 10000, unrealized_pnl: 500 }),
  makePosition({ id: "p2", ticker: "DBK", currency: "EUR", market_value: 3311, unrealized_pnl: 1077 }),
  makePosition({ id: "p3", ticker: "7203", currency: "JPY", market_value: 500000, unrealized_pnl: -5000 }),
];

describe("StockPositionsTable", () => {
  // ── Empty state ──────────────────────────────────────────────────────────────

  it("shows empty state for readonly mode when no positions", () => {
    render(<StockPositionsTable mode="readonly" positions={[]} />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.queryByText("Add Position")).not.toBeInTheDocument();
  });

  it("shows add-position hint in editable empty state", () => {
    render(<StockPositionsTable mode="editable" positions={[]} />);
    const emptyEl = screen.getByTestId("empty-state");
    expect(emptyEl).toHaveTextContent("Add Position");
  });

  // ── Readonly mode ────────────────────────────────────────────────────────────

  it("renders table with positions in readonly mode", () => {
    render(<StockPositionsTable mode="readonly" positions={USD_POSITIONS} />);
    expect(screen.getByTestId("positions-table")).toBeInTheDocument();
    expect(screen.getAllByTestId("position-row")).toHaveLength(2);
  });

  it("does NOT render delete buttons in readonly mode", () => {
    render(<StockPositionsTable mode="readonly" positions={USD_POSITIONS} />);
    expect(screen.queryAllByTestId("delete-position")).toHaveLength(0);
  });

  // ── Editable mode ────────────────────────────────────────────────────────────

  it("renders delete buttons in editable mode", () => {
    const onDelete = vi.fn();
    render(<StockPositionsTable mode="editable" positions={USD_POSITIONS} onDelete={onDelete} />);
    expect(screen.getAllByTestId("delete-position")).toHaveLength(2);
  });

  it("calls onDelete with correct id after two-step confirmation", async () => {
    const onDelete = vi.fn();
    render(<StockPositionsTable mode="editable" positions={USD_POSITIONS} onDelete={onDelete} />);
    const deleteButtons = screen.getAllByTestId("delete-position");
    // First click shows confirmation buttons
    fireEvent.click(deleteButtons[0]);
    expect(onDelete).not.toHaveBeenCalled();
    // Second click on confirm actually fires the callback
    const confirmBtn = screen.getByTestId("confirm-delete");
    fireEvent.click(confirmBtn);
    expect(onDelete).toHaveBeenCalledWith("pos-1");
  });

  // ── Unrealized P&L colour ────────────────────────────────────────────────────

  it("applies green color class to positive unrealized P&L", () => {
    render(<StockPositionsTable mode="readonly" positions={[makePosition({ unrealized_pnl: 500 })]} />);
    const rows = screen.getAllByTestId("position-row");
    expect(rows[0]).toHaveTextContent("+");
  });

  it("applies red color class to negative unrealized P&L", () => {
    render(
      <StockPositionsTable
        mode="readonly"
        positions={[makePosition({ id: "neg", unrealized_pnl: -200 })]}
      />
    );
    const rows = screen.getAllByTestId("position-row");
    expect(rows[0]).toHaveTextContent("-$200.00");
  });

  it("shows dash for null unrealized P&L", () => {
    render(
      <StockPositionsTable
        mode="readonly"
        positions={[makePosition({ id: "no-pnl", unrealized_pnl: null })]}
      />
    );
    const rows = screen.getAllByTestId("position-row");
    // The last meaningful td is unrealized pnl column
    expect(rows[0]).toHaveTextContent("—");
  });

  // ── Currency formatting (≥3 distinct currencies) ────────────────────────────

  it("formats USD market values correctly", () => {
    render(<StockPositionsTable mode="readonly" positions={[makePosition({ market_value: 5922.5, currency: "USD" })]} />);
    expect(screen.getByTestId("positions-table")).toHaveTextContent("$5,922.50");
  });

  it("formats EUR market values correctly", () => {
    render(<StockPositionsTable mode="readonly" positions={[makePosition({ market_value: 3311, currency: "EUR" })]} />);
    expect(screen.getByTestId("positions-table")).toHaveTextContent("€3,311.00");
  });

  it("formats JPY market values correctly", () => {
    render(<StockPositionsTable mode="readonly" positions={[makePosition({ market_value: 500000, currency: "JPY" })]} />);
    expect(screen.getByTestId("positions-table")).toHaveTextContent("¥");
  });

  it("renders rows for all three distinct currencies", () => {
    render(<StockPositionsTable mode="readonly" positions={MULTI_CURRENCY_POSITIONS} />);
    expect(screen.getAllByTestId("position-row")).toHaveLength(3);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("DBK")).toBeInTheDocument();
    expect(screen.getByText("7203")).toBeInTheDocument();
  });

  // ── Total footer ─────────────────────────────────────────────────────────────

  it("renders total market value footer", () => {
    render(<StockPositionsTable mode="readonly" positions={USD_POSITIONS} />);
    // 5922.5 + 2469.9 = 8392.4
    expect(screen.getByText(/Total Market Value/)).toBeInTheDocument();
    expect(screen.getByTestId("positions-table")).toHaveTextContent("$8,392.40");
  });

  // ── GBP / pence display (÷100 guard) ─────────────────────────────────────────

  it("divides GBP mark_price by 100 before display (pence → GBP)", () => {
    const gbpPos = makePosition({
      ticker: "RIO",
      currency: "GBP",
      mark_price: 7927,          // stored in pence
      cost_basis: 7800,          // stored in pence
      market_value: 15774.73,    // already in GBP
    });
    render(<StockPositionsTable mode="readonly" positions={[gbpPos]} />);
    // mark_price displayed as £79.27 (not £7,927)
    expect(screen.getByTestId("positions-table")).toHaveTextContent("£79.27");
    // market_value shown as-is in GBP
    expect(screen.getByTestId("positions-table")).toHaveTextContent("£15,774.73");
  });

  it("formats GBP market values correctly", () => {
    render(<StockPositionsTable mode="readonly" positions={[makePosition({ market_value: 15774.73, currency: "GBP" })]} />);
    expect(screen.getByTestId("positions-table")).toHaveTextContent("£15,774.73");
  });

  // ── ILA crash prevention ──────────────────────────────────────────────────────

  it("renders ILA position without crashing (ILA→ILS Intl normalisation)", () => {
    const ilaPos = makePosition({
      ticker: "1083",
      currency: "ILA",
      mark_price: 7550,        // agorot
      cost_basis: 7400,        // agorot
      market_value: 76255.0,   // canonical ILS
      unrealized_pnl: 855.0,   // ILS
    });
    // Prior to fix, passing 'ILA' to Intl.NumberFormat threw RangeError
    expect(() => render(<StockPositionsTable mode="readonly" positions={[ilaPos]} />)).not.toThrow();
    // mark_price displayed as ₪75.50 (agorot ÷ 100 = ILS)
    expect(screen.getByTestId("positions-table")).toHaveTextContent("₪75.50");
  });
});
