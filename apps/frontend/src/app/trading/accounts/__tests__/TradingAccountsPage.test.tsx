/**
 * R2 regression tests for Issue #340 Phase 2 — TradingAccountsPage
 *
 * Covers:
 *   - Three account-type tabs render with correct labels
 *   - Default active tab is IBKR (ibkr)
 *   - IBKR tab shows refresh-button, NOT add-position-button (read-only)
 *   - Schwab / IRA tabs show add-position-button, NOT refresh-button (manual)
 *
 * Pattern mirrors existing component tests in:
 *   apps/frontend/src/components/trading/accounts/__tests__/
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import TradingAccountsPage from "../page";
import type { TradingAccountConfig, StockPosition } from "@/app/trading/actions";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(
  id: number,
  account_type: TradingAccountConfig["account_type"],
  name: string
): TradingAccountConfig {
  return {
    id,
    name,
    account_type,
    host: "127.0.0.1",
    port: 4001,
    client_id: 1,
    linked_account_id: null,
    account_id: `ACCT_${id}`,
    last_synced: null,
    compute_options_income: false,
  };
}

const THREE_CONFIGS: TradingAccountConfig[] = [
  makeConfig(1, "ibkr", "My IBKR"),
  makeConfig(2, "schwab", "My Schwab"),
  makeConfig(3, "ira", "My IRA"),
];

const EMPTY_POSITIONS: StockPosition[] = [];

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/app/trading/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/trading/actions")>();
  return {
    ...actual,
    getTradingConfigs: vi.fn(),
    getStockPositions: vi.fn().mockResolvedValue([]),
    deleteStockPosition: vi.fn().mockResolvedValue({ ok: true }),
    triggerIBKRSync: vi.fn().mockResolvedValue({ ok: true }),
  };
});

// TradingAccountSettings is the heavy Settings-tab component — mock it so we
// don't drag in unrelated action calls in these focused tab tests.
vi.mock("@/components/trading/TradingAccountSettings", () => ({
  default: () => <div data-testid="mock-settings">Settings</div>,
}));

// ── Test suite ────────────────────────────────────────────────────────────────

describe("TradingAccountsPage — Phase 2 tab / header regression (#340)", () => {
  let mockGetConfigs: ReturnType<typeof vi.fn>;
  let mockGetPositions: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Import the mocked module to get references to the mock functions
    const actions = await import("@/app/trading/actions");
    mockGetConfigs = vi.mocked(actions.getTradingConfigs);
    mockGetPositions = vi.mocked(actions.getStockPositions);
    mockGetConfigs.mockResolvedValue(THREE_CONFIGS);
    mockGetPositions.mockResolvedValue(EMPTY_POSITIONS);
  });

  // ── Tab rendering ────────────────────────────────────────────────────────

  it("renders all three account-type tabs with correct labels", async () => {
    await act(async () => {
      render(<TradingAccountsPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("tab-ibkr")).toBeInTheDocument();
      expect(screen.getByTestId("tab-schwab")).toBeInTheDocument();
      expect(screen.getByTestId("tab-ira")).toBeInTheDocument();
    });

    expect(screen.getByTestId("tab-ibkr")).toHaveTextContent("InteractiveBrokers");
    expect(screen.getByTestId("tab-schwab")).toHaveTextContent("Schwab");
    expect(screen.getByTestId("tab-ira")).toHaveTextContent("LeumiIRA");
  });

  it("renders a Settings tab in addition to the account tabs", async () => {
    await act(async () => {
      render(<TradingAccountsPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("tab-settings")).toBeInTheDocument();
    });
  });

  // ── Default active tab (IBKR) ────────────────────────────────────────────

  it("shows refresh-button for the default IBKR tab (read-only)", async () => {
    await act(async () => {
      render(<TradingAccountsPage />);
    });

    // Wait for loading to finish and IBKR header to appear
    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });

    // add-position-button must NOT appear while IBKR is active
    expect(screen.queryByTestId("add-position-button")).not.toBeInTheDocument();
  });

  // ── Manual tabs (Schwab / IRA) ───────────────────────────────────────────

  it("shows add-position-button after switching to the Schwab tab", async () => {
    await act(async () => {
      render(<TradingAccountsPage />);
    });

    // Wait for initial load to settle
    await waitFor(() => {
      expect(screen.getByTestId("tab-schwab")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("tab-schwab"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("add-position-button")).toBeInTheDocument();
    });
    // refresh-button must NOT appear for manual accounts
    expect(screen.queryByTestId("refresh-button")).not.toBeInTheDocument();
  });

  it("shows add-position-button after switching to the IRA tab", async () => {
    await act(async () => {
      render(<TradingAccountsPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("tab-ira")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("tab-ira"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("add-position-button")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("refresh-button")).not.toBeInTheDocument();
  });

  // ── Switching back to IBKR restores read-only header ────────────────────

  it("restores refresh-button when switching back to IBKR from Schwab", async () => {
    await act(async () => {
      render(<TradingAccountsPage />);
    });

    // Switch to Schwab
    await waitFor(() => screen.getByTestId("tab-schwab"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("tab-schwab"));
    });
    await waitFor(() => screen.getByTestId("add-position-button"));

    // Switch back to IBKR
    await act(async () => {
      fireEvent.click(screen.getByTestId("tab-ibkr"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("add-position-button")).not.toBeInTheDocument();
  });

  // ── Empty-state table appears when no positions ──────────────────────────

  it("shows empty-state for the default IBKR tab when no positions loaded", async () => {
    await act(async () => {
      render(<TradingAccountsPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });
});
