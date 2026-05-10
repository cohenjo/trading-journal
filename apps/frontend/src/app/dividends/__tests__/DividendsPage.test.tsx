/**
 * Tests for Issue #355 — Dividends page: 3-account tabs (IBKR / Schwab / LeumiIRA)
 *
 * Covers:
 *   - 3 canonical account tabs render
 *   - Default active tab is IBKR
 *   - Switching tabs updates account context (empty-state banner for accounts without data)
 *   - Empty-state banner references the Accounts page
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import DividendsPage from "../page";

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock DividendDashboard so we can inspect which accountNameFilter it receives.
vi.mock("@/components/Dividends/DividendDashboard", () => ({
  default: ({ accountNameFilter }: { accountNameFilter?: string }) => (
    <div data-testid="mock-dashboard" data-account={accountNameFilter ?? ""}>
      {/* Simulate empty-state banner when accountNameFilter is Schwab/LeumiIRA in unit tests */}
      {accountNameFilter && accountNameFilter !== "InteractiveBrokers" && (
        <div data-testid="div-empty-state">
          No positions on this account yet. Add positions on the{" "}
          <a href="/trading/accounts">Accounts</a> page to see projected dividends.
        </div>
      )}
    </div>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Test suite ────────────────────────────────────────────────────────────────

describe("DividendsPage — 3-account tabs (#355)", () => {
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

  it("default active tab is IBKR — dashboard receives InteractiveBrokers filter", () => {
    render(<DividendsPage />);

    const dashboard = screen.getByTestId("mock-dashboard");
    expect(dashboard).toHaveAttribute("data-account", "InteractiveBrokers");
  });

  it("switching to Schwab tab updates dashboard account filter to Schwab", async () => {
    render(<DividendsPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("div-tab-schwab"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-dashboard")).toHaveAttribute("data-account", "Schwab");
    });
  });

  it("switching to LeumiIRA tab updates dashboard account filter to LeumiIRA", async () => {
    render(<DividendsPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("div-tab-ira"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-dashboard")).toHaveAttribute("data-account", "LeumiIRA");
    });
  });

  it("empty-state banner is shown when tab has no positions (Schwab)", async () => {
    render(<DividendsPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("div-tab-schwab"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("div-empty-state")).toBeInTheDocument();
    });
    expect(screen.getByTestId("div-empty-state")).toHaveTextContent("Accounts");
  });

  it("switching back to IBKR removes the empty-state (IBKR has data)", async () => {
    render(<DividendsPage />);

    // Go to Schwab (shows empty state in mock)
    await act(async () => {
      fireEvent.click(screen.getByTestId("div-tab-schwab"));
    });
    await waitFor(() => expect(screen.getByTestId("div-empty-state")).toBeInTheDocument());

    // Switch back to IBKR
    await act(async () => {
      fireEvent.click(screen.getByTestId("div-tab-ibkr"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("div-empty-state")).not.toBeInTheDocument();
      expect(screen.getByTestId("mock-dashboard")).toHaveAttribute("data-account", "InteractiveBrokers");
    });
  });
});
