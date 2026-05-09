import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import AggregatePortfolioFooter, { AccountBalance } from "../AggregatePortfolioFooter";
import type { StockPosition, TradingAccountConfig } from "@/app/trading/actions";

function makeConfig(
  id: number,
  name: string,
  account_type: string,
): TradingAccountConfig {
  return {
    id,
    name,
    account_type: account_type as TradingAccountConfig["account_type"],
    host: "127.0.0.1",
    port: 4001,
    client_id: 1,
    linked_account_id: null,
    account_id: null,
    last_synced: null,
    compute_options_income: false,
  };
}

function makePosition(id: string, ticker: string, market_value: number): StockPosition {
  return {
    id,
    account_id: 1,
    ticker,
    description: null,
    sub_category: null,
    quantity: 10,
    cost_basis: null,
    mark_price: null,
    market_value,
    unrealized_pnl: null,
    currency: "USD",
    as_of_date: "2026-05-09",
    source: "manual",
  };
}

const IBKR_CONFIG = makeConfig(1, "IBKR Main", "ibkr");
const SCHWAB_CONFIG = makeConfig(2, "Schwab", "schwab");
const IRA_CONFIG = makeConfig(3, "IRA (Hishtalmut)", "ira");

const IBKR_POSITIONS: StockPosition[] = [
  makePosition("p1", "AAPL", 60000),
];
const SCHWAB_POSITIONS: StockPosition[] = [
  makePosition("p2", "VYM", 20000),
  makePosition("p3", "SCHD", 10000),
];
const IRA_POSITIONS: StockPosition[] = [
  makePosition("p4", "BND", 10000),
];

const ACCOUNTS: AccountBalance[] = [
  { config: IBKR_CONFIG, positions: IBKR_POSITIONS },
  { config: SCHWAB_CONFIG, positions: SCHWAB_POSITIONS },
  { config: IRA_CONFIG, positions: IRA_POSITIONS },
];

describe("AggregatePortfolioFooter", () => {
  it("renders total portfolio value header", () => {
    render(<AggregatePortfolioFooter accounts={ACCOUNTS} />);
    expect(screen.getByText(/Total Portfolio Value/)).toBeInTheDocument();
  });

  it("sums account totals correctly: 60000 + 30000 + 10000 = 100000", () => {
    render(<AggregatePortfolioFooter accounts={ACCOUNTS} />);
    expect(screen.getByTestId("total-value")).toHaveTextContent("$100,000");
  });

  it("renders one bar per account", () => {
    render(<AggregatePortfolioFooter accounts={ACCOUNTS} />);
    expect(screen.getAllByTestId("account-bar")).toHaveLength(3);
  });

  it("breakdown percentages sum to 100% across all accounts", () => {
    render(<AggregatePortfolioFooter accounts={ACCOUNTS} />);
    // IBKR = 60%, Schwab = 30%, IRA = 10%
    const bars = screen.getAllByRole("progressbar");
    const values = bars.map((b) => parseFloat(b.getAttribute("aria-valuenow") ?? "0"));
    const sum = values.reduce((s, v) => s + v, 0);
    // Allow 1% floating-point rounding tolerance
    expect(Math.abs(sum - 100)).toBeLessThan(1);
  });

  it("IBKR bar is 60% of total", () => {
    render(<AggregatePortfolioFooter accounts={ACCOUNTS} />);
    const bars = screen.getAllByRole("progressbar");
    const ibkrBar = bars[0];
    expect(parseFloat(ibkrBar.getAttribute("aria-valuenow") ?? "0")).toBeCloseTo(60, 0);
  });

  it("renders top 5 holdings sorted by market value descending", () => {
    render(<AggregatePortfolioFooter accounts={ACCOUNTS} />);
    const topHoldings = screen.getByTestId("top-holdings");
    expect(topHoldings).toBeInTheDocument();
    const text = topHoldings.textContent ?? "";
    // AAPL (60k) should come before VYM (20k), SCHD (10k), BND (10k)
    expect(text.indexOf("AAPL")).toBeLessThan(text.indexOf("VYM"));
    expect(text.indexOf("VYM")).toBeLessThan(text.indexOf("BND"));
  });

  it("shows at most 5 holdings in top list", () => {
    // Create accounts with 7 distinct tickers
    const extra: AccountBalance[] = [
      {
        config: IBKR_CONFIG,
        positions: [
          makePosition("a1", "AAA", 7000),
          makePosition("a2", "BBB", 6000),
          makePosition("a3", "CCC", 5000),
          makePosition("a4", "DDD", 4000),
          makePosition("a5", "EEE", 3000),
          makePosition("a6", "FFF", 2000),
          makePosition("a7", "GGG", 1000),
        ],
      },
    ];
    render(<AggregatePortfolioFooter accounts={extra} />);
    const topHoldings = screen.getByTestId("top-holdings");
    const tickers = (topHoldings.textContent ?? "").split("·").map((s) => s.trim());
    // Should have at most 5 meaningful tickers listed (after the "Top Holdings:" label text)
    const tickerList = tickers.filter((t) => /^[A-Z]+$/.test(t));
    expect(tickerList.length).toBeLessThanOrEqual(5);
  });

  it("renders gracefully with all-zero positions", () => {
    const empty: AccountBalance[] = [
      { config: IBKR_CONFIG, positions: [] },
      { config: SCHWAB_CONFIG, positions: [] },
    ];
    render(<AggregatePortfolioFooter accounts={empty} />);
    expect(screen.getByTestId("total-value")).toHaveTextContent("$0");
  });
});
