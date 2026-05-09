import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import AddPositionModal from "../AddPositionModal";
import type { TradingAccountConfig } from "@/app/trading/actions";
import * as TradingActions from "@/app/trading/actions";

const SCHWAB_CONFIG: TradingAccountConfig = {
  id: 2,
  name: "Schwab",
  account_type: "schwab" as TradingAccountConfig["account_type"],
  host: "127.0.0.1",
  port: 4001,
  client_id: 1,
  linked_account_id: null,
  account_id: null,
  last_synced: null,
  compute_options_income: false,
};

vi.mock("@/app/trading/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof TradingActions>();
  return {
    ...actual,
    getTickerSymbols: vi.fn().mockResolvedValue(["AAPL", "SCHD", "VYM", "MSFT"]),
    createStockPosition: vi.fn().mockResolvedValue({
      ok: true,
      position: {
        id: "new-pos",
        account_id: 2,
        ticker: "VYM",
        description: null,
        sub_category: null,
        quantity: 50,
        cost_basis: 104.2,
        mark_price: null,
        market_value: null,
        unrealized_pnl: null,
        currency: "USD",
        as_of_date: "2026-05-09",
        source: "manual" as const,
      },
    }),
  };
});

describe("AddPositionModal", () => {
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders modal with account name", () => {
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    expect(screen.getByTestId("add-position-modal")).toBeInTheDocument();
    expect(screen.getByText(/Add Position — Schwab/)).toBeInTheDocument();
  });

  it("renders all required form fields", () => {
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    expect(screen.getByTestId("ticker-input")).toBeInTheDocument();
    expect(screen.getByTestId("quantity-input")).toBeInTheDocument();
    expect(screen.getByTestId("cost-basis-input")).toBeInTheDocument();
    expect(screen.getByTestId("date-input")).toBeInTheDocument();
  });

  it("defaults as-of-date to today", () => {
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    const dateInput = screen.getByTestId("date-input") as HTMLInputElement;
    const todayStr = new Date().toISOString().split("T")[0];
    expect(dateInput.value).toBe(todayStr);
  });

  // ── Validation ───────────────────────────────────────────────────────────────

  it("shows error when ticker is empty on submit", async () => {
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByTestId("quantity-input"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("save-button"));
    await waitFor(() => {
      expect(screen.getByTestId("form-error")).toHaveTextContent("Ticker is required");
    });
  });

  it("shows error when quantity is zero", async () => {
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    await act(async () => {
      fireEvent.change(screen.getByTestId("ticker-input"), { target: { value: "VYM" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("quantity-input"), { target: { value: "0" } });
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("position-form"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("form-error")).toHaveTextContent("Quantity must be greater than 0");
    });
  });

  it("shows error when quantity is negative", async () => {
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    await act(async () => {
      fireEvent.change(screen.getByTestId("ticker-input"), { target: { value: "VYM" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("quantity-input"), { target: { value: "-5" } });
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("position-form"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("form-error")).toHaveTextContent("Quantity must be greater than 0");
    });
  });

  it("shows error when date is empty", async () => {
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByTestId("ticker-input"), { target: { value: "VYM" } });
    fireEvent.change(screen.getByTestId("quantity-input"), { target: { value: "10" } });
    fireEvent.change(screen.getByTestId("date-input"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("save-button"));
    await waitFor(() => {
      expect(screen.getByTestId("form-error")).toHaveTextContent("As-of date is required");
    });
  });

  // ── Successful submit ────────────────────────────────────────────────────────

  it("calls createStockPosition with correct payload on valid submit", async () => {
    const mockCreate = vi.mocked(TradingActions.createStockPosition);
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId("ticker-input"), { target: { value: "VYM" } });
    fireEvent.change(screen.getByTestId("quantity-input"), { target: { value: "50" } });
    fireEvent.change(screen.getByTestId("cost-basis-input"), { target: { value: "104.20" } });
    const dateInput = screen.getByTestId("date-input");
    // Date is already set to today — just confirm it's valid
    expect((dateInput as HTMLInputElement).value).toBeTruthy();

    fireEvent.click(screen.getByTestId("save-button"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: 2,
          ticker: "VYM",
          quantity: 50,
          cost_basis: 104.2,
        })
      );
    });
  });

  it("calls onSuccess and onClose after successful submission", async () => {
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByTestId("ticker-input"), { target: { value: "VYM" } });
    fireEvent.change(screen.getByTestId("quantity-input"), { target: { value: "50" } });
    fireEvent.click(screen.getByTestId("save-button"));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ── Error state from server ──────────────────────────────────────────────────

  it("shows inline error when server returns error", async () => {
    vi.mocked(TradingActions.createStockPosition).mockResolvedValueOnce({
      ok: false,
      error: "Failed to create position",
    });

    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByTestId("ticker-input"), { target: { value: "VYM" } });
    fireEvent.change(screen.getByTestId("quantity-input"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("save-button"));

    await waitFor(() => {
      expect(screen.getByTestId("form-error")).toHaveTextContent("Failed to create position");
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Cancel button ────────────────────────────────────────────────────────────

  it("calls onClose when cancel is clicked", () => {
    render(<AddPositionModal account={SCHWAB_CONFIG} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByTestId("cancel-button"));
    expect(onClose).toHaveBeenCalled();
  });
});
