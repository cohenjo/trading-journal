/**
 * Tests for DividendsPage — refactored to positions-first view (Issue #363).
 *
 * Covers:
 *   - 3 canonical account tabs render with correct data-testids
 *   - Default active tab is IBKR
 *   - Tab switching works
 *   - Summary header renders
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import DividendsPage from "../page";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/components/Dividends/DividendAccountTab", () => ({
  default: ({ accountKey }: { accountKey: string }) => (
    <div data-testid="mock-account-tab" data-account={accountKey}>
      Tab content for {accountKey}
    </div>
  ),
}));

vi.mock("@/app/dividends/actions", () => ({
  getDividendSummary: vi.fn().mockResolvedValue({
    total_forward_annual: 5000,
    position_count: 10,
    by_account: { ibkr: 5000, schwab: 0, ira: 0 },
  }),
}));

// ── Test suite ────────────────────────────────────────────────────────────────

describe("DividendsPage — positions-first view (#363)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all 3 account tabs: IBKR, Schwab, LeumiIRA", () => {
    render(<DividendsPage />);

    expect(screen.getByTestId("div-tab-ibkr")).toBeInTheDocument();
    expect(screen.getByTestId("div-tab-schwab")).toBeInTheDocument();
    expect(screen.getByTestId("div-tab-ira")).toBeInTheDocument();
  });

  it("tab labels display correctly", () => {
    render(<DividendsPage />);

    expect(screen.getByTestId("div-tab-ibkr")).toHaveTextContent("InteractiveBrokers");
    expect(screen.getByTestId("div-tab-schwab")).toHaveTextContent("Schwab");
    expect(screen.getByTestId("div-tab-ira")).toHaveTextContent("LeumiIRA");
  });

  it("default active tab is IBKR — mocked tab renders ibkr key", () => {
    render(<DividendsPage />);

    const tab = screen.getByTestId("mock-account-tab");
    expect(tab).toHaveAttribute("data-account", "ibkr");
  });

  it("switching to Schwab tab renders schwab account key", async () => {
    render(<DividendsPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("div-tab-schwab"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-account-tab")).toHaveAttribute("data-account", "schwab");
    });
  });

  it("switching to LeumiIRA tab renders ira account key", async () => {
    render(<DividendsPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("div-tab-ira"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-account-tab")).toHaveAttribute("data-account", "ira");
    });
  });

  it("summary header renders with dividends-summary-total testid", async () => {
    render(<DividendsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("dividends-summary-total")).toBeInTheDocument();
    });
  });

  it("page title is 'Dividend Income'", () => {
    render(<DividendsPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dividend Income");
  });

  it("tabs have role=tab and aria-selected", async () => {
    render(<DividendsPage />);

    const ibkrTab = screen.getByTestId("div-tab-ibkr");
    expect(ibkrTab).toHaveAttribute("role", "tab");
    expect(ibkrTab).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      fireEvent.click(screen.getByTestId("div-tab-schwab"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("div-tab-schwab")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("div-tab-ibkr")).toHaveAttribute("aria-selected", "false");
    });
  });
});
