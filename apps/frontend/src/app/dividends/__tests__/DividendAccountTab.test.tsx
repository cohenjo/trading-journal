/**
 * Component tests for DividendAccountTab (#363).
 *
 * Covers:
 *   - Non-empty state: dividends-positions-table renders when getDividendPositions returns rows
 *   - Empty state: dividends-account-empty renders when getDividendPositions returns []
 *   - Error state: retry button visible on load failure
 *   - History toggle: clicking dividends-history-toggle reveals dividends-history-section
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import DividendAccountTab from "@/components/Dividends/DividendAccountTab";
import type { DividendPosition } from "@/types/dividends";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockGetDividendPositions = vi.fn();

vi.mock("@/app/dividends/actions", () => ({
  getDividendPositions: (...args: unknown[]) => mockGetDividendPositions(...args),
}));

vi.mock("@/components/Dividends/DividendDashboard", () => ({
  default: ({ accountNameFilter }: { accountNameFilter?: string }) => (
    <div data-testid="mock-history-dashboard" data-account={accountNameFilter ?? ""} />
  ),
}));

vi.mock("@/components/Dividends/DividendPositionsTable", () => ({
  default: ({ rows }: { rows: DividendPosition[] }) => (
    <div data-testid="dividends-positions-table" data-row-count={rows.length}>
      {rows.map((r) => (
        <div key={r.ticker} data-testid={`dividend-row-${r.ticker}`}>{r.ticker}</div>
      ))}
    </div>
  ),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── Test data ─────────────────────────────────────────────────────────────────

const mockPosition: DividendPosition = {
  ticker: "GS",
  name: "Goldman Sachs",
  quantity: 50,
  avg_cost: 300,
  current_price: 350,
  market_value: 17500,
  ttm_div_per_share: 11.0,
  ttm_dividend_total: 550,
  ttm_yield_pct: 3.14,
  forward_div_per_share: 11.0,
  forward_dividend_annual: 550,
  forward_yield_pct: 3.14,
  last_payment_date: "2026-04-01",
  payment_frequency: "quarterly",
  source: "flex",
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe("DividendAccountTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("non-empty state (getDividendPositions returns rows)", () => {
    beforeEach(() => {
      mockGetDividendPositions.mockResolvedValue([mockPosition]);
    });

    it("renders dividends-positions-table when there are rows", async () => {
      render(<DividendAccountTab accountKey="ibkr" />);

      await waitFor(() => {
        expect(screen.getByTestId("dividends-positions-table")).toBeInTheDocument();
      });
    });

    it("does NOT render dividends-account-empty when there are rows", async () => {
      render(<DividendAccountTab accountKey="ibkr" />);

      await waitFor(() => {
        expect(screen.queryByTestId("dividends-account-empty")).not.toBeInTheDocument();
      });
    });

    it("history toggle is visible in non-empty state", async () => {
      render(<DividendAccountTab accountKey="ibkr" />);

      await waitFor(() => {
        expect(screen.getByTestId("dividends-history-toggle")).toBeInTheDocument();
      });
    });
  });

  describe("empty state (getDividendPositions returns [])", () => {
    beforeEach(() => {
      mockGetDividendPositions.mockResolvedValue([]);
    });

    it("renders dividends-account-empty when there are no rows", async () => {
      render(<DividendAccountTab accountKey="schwab" />);

      await waitFor(() => {
        expect(screen.getByTestId("dividends-account-empty")).toBeInTheDocument();
      });
    });

    it("does NOT render dividends-positions-table when there are no rows", async () => {
      render(<DividendAccountTab accountKey="schwab" />);

      await waitFor(() => {
        expect(screen.queryByTestId("dividends-positions-table")).not.toBeInTheDocument();
      });
    });

    it("empty state contains link to accounts page with correct account param", async () => {
      render(<DividendAccountTab accountKey="schwab" />);

      await waitFor(() => {
        const link = screen.getByRole("link");
        expect(link).toHaveAttribute("href", "/trading/accounts?account=schwab");
      });
    });

    it("empty state for IRA links to ira account page", async () => {
      render(<DividendAccountTab accountKey="ira" />);

      await waitFor(() => {
        const link = screen.getByRole("link");
        expect(link).toHaveAttribute("href", "/trading/accounts?account=ira");
      });
    });

    it("history toggle is still visible in empty state", async () => {
      render(<DividendAccountTab accountKey="schwab" />);

      await waitFor(() => {
        expect(screen.getByTestId("dividends-history-toggle")).toBeInTheDocument();
      });
    });
  });

  describe("history toggle behaviour", () => {
    beforeEach(() => {
      mockGetDividendPositions.mockResolvedValue([mockPosition]);
    });

    it("history section is hidden by default", async () => {
      render(<DividendAccountTab accountKey="ibkr" />);

      await waitFor(() => {
        expect(screen.getByTestId("dividends-history-toggle")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("dividends-history-section")).not.toBeInTheDocument();
    });

    it("clicking dividends-history-toggle reveals dividends-history-section", async () => {
      render(<DividendAccountTab accountKey="ibkr" />);

      await waitFor(() => {
        expect(screen.getByTestId("dividends-history-toggle")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("dividends-history-toggle"));

      await waitFor(() => {
        expect(screen.getByTestId("dividends-history-section")).toBeInTheDocument();
      });
    });

    it("clicking toggle again hides the history section", async () => {
      render(<DividendAccountTab accountKey="ibkr" />);

      await waitFor(() => {
        expect(screen.getByTestId("dividends-history-toggle")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("dividends-history-toggle"));
      await waitFor(() => {
        expect(screen.getByTestId("dividends-history-section")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("dividends-history-toggle"));
      await waitFor(() => {
        expect(screen.queryByTestId("dividends-history-section")).not.toBeInTheDocument();
      });
    });
  });

  describe("error state", () => {
    beforeEach(() => {
      mockGetDividendPositions.mockRejectedValue(new Error("Network failure"));
    });

    it("renders retry button on load failure", async () => {
      render(<DividendAccountTab accountKey="ibkr" />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
      });
    });
  });
});
