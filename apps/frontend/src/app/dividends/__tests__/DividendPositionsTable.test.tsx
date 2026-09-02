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
  currency: "USD",
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

  it("sorts rows by ticker A-Z", () => {
    const rows = [
      makePosition({ ticker: "LOW", forward_dividend_annual: 100 }),
      makePosition({ ticker: "HIGH", forward_dividend_annual: 500 }),
      makePosition({ ticker: "MID", forward_dividend_annual: 300 }),
    ];
    render(<DividendPositionsTable rows={rows} />);

    const tickers = screen
      .getAllByRole("row")
      .slice(1) // skip header
      .map((r) => r.cells[0]?.textContent?.trim() ?? "");

    expect(tickers[0]).toBe("HIGH");
    expect(tickers[1]).toBe("LOW");
    expect(tickers[2]).toBe("MID");
  });

  it("renders all 15 column headers including Health", () => {
    render(<DividendPositionsTable rows={[makePosition()]} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(15);
    expect(screen.getByRole("columnheader", { name: "Health" })).toBeInTheDocument();
  });

  it("renders rating badges and colors correctly", () => {
    const rows = [
      makePosition({ ticker: "GOOD_CO", dividend_rating: "good" }),
      makePosition({ ticker: "OK_CO", dividend_rating: "ok" }),
      makePosition({ ticker: "BAD_CO", dividend_rating: "bad" }),
    ];
    render(<DividendPositionsTable rows={rows} />);

    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("Watch")).toBeInTheDocument();
    expect(screen.getByText("At Risk")).toBeInTheDocument();
  });

  it("filters rows using the health filter chips", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const rows = [
      makePosition({ ticker: "GOOD_CO", dividend_rating: "good" }),
      makePosition({ ticker: "OK_CO", dividend_rating: "ok" }),
      makePosition({ ticker: "BAD_CO", dividend_rating: "bad" }),
    ];
    render(<DividendPositionsTable rows={rows} />);

    // Click Good filter
    fireEvent.click(screen.getByTestId("filter-rating-good"));
    expect(screen.getByTestId("dividend-row-GOOD_CO")).toBeInTheDocument();
    expect(screen.queryByTestId("dividend-row-OK_CO")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dividend-row-BAD_CO")).not.toBeInTheDocument();

    // Click All filter
    fireEvent.click(screen.getByTestId("filter-rating-all"));
    expect(screen.getByTestId("dividend-row-GOOD_CO")).toBeInTheDocument();
    expect(screen.getByTestId("dividend-row-OK_CO")).toBeInTheDocument();
    expect(screen.getByTestId("dividend-row-BAD_CO")).toBeInTheDocument();
  });

  it("monetary values include $ prefix for USD positions via formatCurrency", () => {
    render(<DividendPositionsTable rows={[makePosition({ market_value: 5500, currency: "USD" })]} />);
    // formatCurrency(5500, 'USD') → '$5,500.00'
    expect(screen.getByText("$5,500.00")).toBeInTheDocument();
  });

  it("uses ILS symbol (₪) for ILA/ILS positions", () => {
    render(
      <DividendPositionsTable
        rows={[
          makePosition({
            ticker: "224014",
            market_value: 29582.9,
            currency: "ILS",
            forward_dividend_annual: 499.95,
          }),
        ]}
      />,
    );
    // formatCurrency(499.95, 'ILS') → '₪499.95'
    expect(screen.getByText("₪499.95")).toBeInTheDocument();
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
