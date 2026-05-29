/**
 * Tests for CategoryPicker component (CC-7).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { CategoryPicker } from "../_components/CategoryPicker";
import { EXPENSE_CATEGORIES } from "@/types/expenses";

describe("CategoryPicker", () => {
  it("renders trigger button with placeholder when no value", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "בחר קטגוריה" })).toBeInTheDocument();
    expect(screen.getByText("בחר קטגוריה...")).toBeInTheDocument();
  });

  it("renders selected value as label", () => {
    const groceries = EXPENSE_CATEGORIES.find((c) => c.slug === "groceries")!;
    render(
      <CategoryPicker
        value={{ category: groceries, subcategory: null }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("מזון וסופרמרקט")).toBeInTheDocument();
  });

  it("opens dropdown on trigger click", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("renders all top-level categories in dropdown", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));

    // Every category should be present
    for (const cat of EXPENSE_CATEGORIES) {
      expect(screen.getByRole("option", { name: cat.name_he })).toBeInTheDocument();
    }
  });

  it("calls onChange with correct category when selected", () => {
    const onChange = vi.fn();
    render(<CategoryPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));

    const groceriesOption = screen.getByRole("option", { name: "מזון וסופרמרקט" });
    fireEvent.click(groceriesOption);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        category: expect.objectContaining({ slug: "groceries" }),
        subcategory: null,
      }),
    );
  });

  it("closes dropdown after selection", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "מזון וסופרמרקט" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes dropdown on Escape key", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("listbox").closest("div")!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("search filters categories by English name", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));

    const searchInput = screen.getByRole("textbox", { name: "חיפוש קטגוריה" });
    fireEvent.change(searchInput, { target: { value: "Groceries" } });

    expect(screen.getByRole("option", { name: "מזון וסופרמרקט" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "בריאות" })).not.toBeInTheDocument();
  });

  it("search filters categories by Hebrew name", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));

    const searchInput = screen.getByRole("textbox", { name: "חיפוש קטגוריה" });
    fireEvent.change(searchInput, { target: { value: "בריאות" } });

    expect(screen.getByRole("option", { name: "בריאות" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "מזון וסופרמרקט" })).not.toBeInTheDocument();
  });

  it("search also matches subcategory names (Hebrew)", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));

    const searchInput = screen.getByRole("textbox", { name: "חיפוש קטגוריה" });
    // "משלוחים" is a subcategory of restaurants
    fireEvent.change(searchInput, { target: { value: "משלוחים" } });

    // Parent category should appear (because subcategory matches)
    expect(screen.getByRole("option", { name: "מסעדות ומשלוחים" })).toBeInTheDocument();
  });

  it("shows 'no categories' message when search has no results", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));

    const searchInput = screen.getByRole("textbox", { name: "חיפוש קטגוריה" });
    fireEvent.change(searchInput, { target: { value: "xyznosuchcategory999" } });

    expect(screen.getByText("לא נמצאו קטגוריות")).toBeInTheDocument();
  });

  it("expands subcategories when expand toggle is clicked", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));

    // Click the expand button for restaurants (has subcategories)
    const expandBtn = screen.getByRole("button", {
      name: "הרחב תת-קטגוריות של מסעדות ומשלוחים",
    });
    fireEvent.click(expandBtn);

    // Subcategory should now be visible
    expect(screen.getByRole("option", { name: "משלוחים" })).toBeInTheDocument();
  });

  it("calls onChange with subcategory when subcategory is selected", () => {
    const onChange = vi.fn();
    render(<CategoryPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));

    // Expand restaurants
    const expandBtn = screen.getByRole("button", {
      name: "הרחב תת-קטגוריות של מסעדות ומשלוחים",
    });
    fireEvent.click(expandBtn);

    // Select subcategory
    fireEvent.click(screen.getByRole("option", { name: "משלוחים" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        category: expect.objectContaining({ slug: "restaurants" }),
        subcategory: expect.objectContaining({ slug: "restaurants-delivery" }),
      }),
    );
  });

  it("is disabled when disabled=true", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} disabled={true} />);
    expect(screen.getByRole("button", { name: "בחר קטגוריה" })).toBeDisabled();
  });

  it("does not open dropdown when disabled", () => {
    render(<CategoryPicker value={null} onChange={vi.fn()} disabled={true} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר קטגוריה" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
