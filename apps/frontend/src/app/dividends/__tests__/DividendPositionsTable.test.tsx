/**
 * Snapshot + formatter tests for DividendPositionsTable (#363).
 *
 * Validates monetary and percentage formatting, frequency labels,
 * default sort order (forward_dividend_annual desc), and data-testids.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import DividendPositionsTable, { fmtFrequency } from "@/components/Dividends/DividendPositionsTable";
import type { DividendPosition } from "@/types/dividends";

// ── Test data ─────────────────────────────────────────────────────────────────

const makePosition = (overrides: Partial<DividendPosition> = {}): DividendPosition => ({
  ticker: "TEST",
  name: "Test Corp",
  quantity: 100,
  avg_cost: 50.00,
  current_price: 55.00,
  market_value: 5500.00,
  ttm_div_per_share: 2.50,
  ttm_dividend_total: 250.00,
  ttm_yield_pct: 4.545,
  forward_div_per_share: 2.60,
  forward_dividend_annual: 260.00,
  forward_yield_pct: 4.727,
  last_payment_date: "2026-03-15",
  payment_frequency: "quarterly",
  source: "flex",
  ...overrides,
});

// ── Formatter unit tests ──────────────────────────────────────────────────────

describe("fmtFrequency", () => {
  it.each([
    ["monthly",     "Monthly"],
    ["quarterly",   "Quarterly"],
    ["semi-annual", "Semi-Annual"],
    ["annual",      "Annual"],
    ["irregular",   "Irregular"],
    [null,          "—"],
  ] as const)("fmtFrequency(%s) → %s", (input, expected) => {
    expect(fmtFrequency(input)).toBe(expected);
  });
});

// ── Component tests ───────────────────────────────────────────────────────────

describe("DividendPositionsTable", () => {
  it("renders dividends-positions-table data-testid", () => {
    render(<DividendPositionsTable rows={[makePosition()]} />);
    expect(screen.getByTestId("dividends-positions-table")).toBeInTheDocument();
  });

  it("renders dividend-row-{TICKER} for each row", () => {
    const rows = [makePosition({ ticker: "AAPL" }), makePosition({ ticker: "GS" })];
    render(<DividendPositionsTable rows={rows} />);

    expect(screen.getByTestId("dividend-row-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("dividend-row-GS")).toBeInTheDocument();
  });

  it("renders null monetary values as '—'", () => {
    render(
      <DividendPositionsTable
        rows={[makePosition({ ttm_div_per_share: null, avg_cost: null })]}
      />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("sorts rows by forward_dividend_annual descending", () => {
    const rows = [
      makePosition({ ticker: "LOW", forward_dividend_annual: 100 }),
      makePosition({ ticker: "HIGH", forward_dividend_annual: 500 }),
      makePosition({ ticker: "MID", forward_dividend_annual: 300 }),
    ];
    render(<DividendPositionsTable rows={rows} />);

    const tickers = screen
      .getAllByRole("row")
      .slice(1) // skip header
      .map((r) => r.cells[0]?.textContent ?? "");

    expect(tickers[0]).toBe("HIGH");
    expect(tickers[1]).toBe("MID");
    expect(tickers[2]).toBe("LOW");
  });

  it("renders all 14 column headers", () => {
    render(<DividendPositionsTable rows={[makePosition()]} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(14);
  });

  it("monetary values include $ prefix via formatCurrency", () => {
    render(<DividendPositionsTable rows={[makePosition({ market_value: 5500 })]} />);
    // formatCurrency(5500, 'USD') → '$5,500.00'
    expect(screen.getByText("$5,500.00")).toBeInTheDocument();
  });

  it("yield percentage shows 2 decimals with % suffix", () => {
    render(<DividendPositionsTable rows={[makePosition({ ttm_yield_pct: 3.14 })]} />);
    expect(screen.getByText("3.14%")).toBeInTheDocument();
  });

  it("renders an empty tbody when rows array is empty", () => {
    render(<DividendPositionsTable rows={[]} />);
    const rows = screen.getAllByRole("row");
    // Only header row
    expect(rows).toHaveLength(1);
  });

  it("renders frequency label correctly (quarterly)", () => {
    render(<DividendPositionsTable rows={[makePosition({ payment_frequency: "quarterly" })]} />);
    expect(screen.getByText("Quarterly")).toBeInTheDocument();
  });

  it("renders last_payment_date when present", () => {
    render(<DividendPositionsTable rows={[makePosition({ last_payment_date: "2026-03-15" })]} />);
    expect(screen.getByText("2026-03-15")).toBeInTheDocument();
  });
});
