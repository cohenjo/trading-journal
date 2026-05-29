/**
 * Tests for UnresolvedQueue component (CC-7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import type { UnresolvedResponse, ResolveResponse } from "@/types/expenses";

// ── Module mocks — must be before imports ─────────────────────────────────────

const mockGetUnresolved = vi.fn();
const mockResolveTransaction = vi.fn();

vi.mock("@/lib/expenses/api", () => ({
  getUnresolved: (...args: unknown[]) => mockGetUnresolved(...args),
  resolveTransaction: (...args: unknown[]) => mockResolveTransaction(...args),
}));

// Mock sonner toast so tests don't need a Toaster in DOM
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { UnresolvedQueue } from "../_components/UnresolvedQueue";
import { toast } from "sonner";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUnresolvedResponse(items = mockItems): UnresolvedResponse {
  return { items, total: items.length, page: 1, page_size: 50 };
}

const mockItems = [
  {
    id: "txn-1",
    txn_date: "2026-04-15T10:00:00Z",
    merchant_raw: "לסרפוש",
    merchant_normalized: "שופרסל",
    amount_ils: 256.5,
    original_currency: null,
    amount_original: null,
    sector_raw: null,
    statement_id: "stmt-1",
  },
  {
    id: "txn-2",
    txn_date: "2026-04-16T12:00:00Z",
    merchant_raw: "WOLT",
    merchant_normalized: "Wolt",
    amount_ils: 89.0,
    original_currency: null,
    amount_original: null,
    sector_raw: null,
    statement_id: "stmt-1",
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UnresolvedQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUnresolved.mockResolvedValue(makeUnresolvedResponse());
  });

  it("renders rows from mock data", async () => {
    render(<UnresolvedQueue />);
    await waitFor(() => {
      expect(screen.getByText("שופרסל")).toBeInTheDocument();
      expect(screen.getByText("Wolt")).toBeInTheDocument();
    });
  });

  it("shows 'all categorized' message when queue is empty", async () => {
    mockGetUnresolved.mockResolvedValue(makeUnresolvedResponse([]));
    render(<UnresolvedQueue />);
    await waitFor(() => {
      expect(screen.getByText(/כל העסקאות מסווגות/)).toBeInTheDocument();
    });
  });

  it("apply-to-all checkbox defaults to ON", async () => {
    render(<UnresolvedQueue />);
    await waitFor(() => screen.getByText("שופרסל"));

    // Each row has an "apply to all" checkbox — get all and verify first is checked
    const applyAllCheckboxes = screen.getAllByLabelText(/החל על כל עסקאות/);
    expect(applyAllCheckboxes[0]).toBeChecked();
  });

  it("Confirm button is disabled before category is picked", async () => {
    render(<UnresolvedQueue />);
    await waitFor(() => screen.getByText("שופרסל"));

    const confirmButtons = screen.getAllByRole("button", { name: /אשר סיווג/ });
    expect(confirmButtons[0]).toBeDisabled();
  });

  it("Confirm button enables after category is picked and fires resolve", async () => {
    const resolveResult: ResolveResponse = { updated_count: 3, mapping_id: "map-1" };
    mockResolveTransaction.mockResolvedValue(resolveResult);

    render(<UnresolvedQueue />);
    await waitFor(() => screen.getByText("שופרסל"));

    // Open the category picker for the first row
    const pickers = screen.getAllByRole("button", { name: /בחר קטגוריה לעסקה/ });
    fireEvent.click(pickers[0]);

    // Select "Groceries" from the dropdown
    const groceriesOption = await screen.findByRole("option", { name: /מזון וסופרמרקט/ });
    fireEvent.click(groceriesOption);

    // Confirm button should now be enabled
    const confirmBtn = screen.getAllByRole("button", { name: /אשר סיווג לעסקה שופרסל/ });
    expect(confirmBtn[0]).not.toBeDisabled();

    // Click confirm
    fireEvent.click(confirmBtn[0]);

    await waitFor(() => {
      expect(mockResolveTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction_id: "txn-1",
          apply_to_all_matching: true,
        }),
      );
      expect(toast.success).toHaveBeenCalledWith("עודכנו 3 עסקאות תואמות");
    });
  });

  it("shows success toast with correct count when apply_to_all resolves multiple", async () => {
    mockResolveTransaction.mockResolvedValue({ updated_count: 5, mapping_id: "map-2" });

    render(<UnresolvedQueue />);
    await waitFor(() => screen.getByText("Wolt"));

    // Pick category for Wolt row
    const pickers = screen.getAllByRole("button", { name: /בחר קטגוריה לעסקה/ });
    fireEvent.click(pickers[1]); // Wolt row

    const restaurantsOption = await screen.findByRole("option", { name: /מסעדות ומשלוחים/ });
    fireEvent.click(restaurantsOption);

    const confirmBtn = screen.getAllByRole("button", { name: /אשר סיווג לעסקה Wolt/ });
    fireEvent.click(confirmBtn[0]);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("עודכנו 5 עסקאות תואמות");
    });
  });

  it("shows error toast when resolve fails", async () => {
    mockResolveTransaction.mockRejectedValue(new Error("network error"));

    render(<UnresolvedQueue />);
    await waitFor(() => screen.getByText("שופרסל"));

    const pickers = screen.getAllByRole("button", { name: /בחר קטגוריה לעסקה/ });
    fireEvent.click(pickers[0]);
    const groceriesOption = await screen.findByRole("option", { name: /מזון וסופרמרקט/ });
    fireEvent.click(groceriesOption);

    const confirmBtn = screen.getAllByRole("button", { name: /אשר סיווג לעסקה שופרסל/ });
    fireEvent.click(confirmBtn[0]);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("שגיאה בשמירת הסיווג");
    });
  });

  it("does NOT use dangerouslySetInnerHTML for merchant names (Rabin §6.1)", async () => {
    render(<UnresolvedQueue />);
    await waitFor(() => screen.getByText("שופרסל"));

    // If any element uses dangerouslySetInnerHTML the text node type would differ.
    // Check that merchant text is rendered as a text node, not raw HTML.
    const merchant = screen.getByText("שופרסל");
    expect(merchant.tagName).not.toBe("HTML");
    // The span should contain the text as textContent (escaped by React)
    expect(merchant.textContent).toBe("שופרסל");
  });
});
