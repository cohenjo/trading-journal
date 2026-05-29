import { describe, expect, it } from "vitest";

import {
  buildCategoryTree,
  normalizeMerchant,
  numericToNumber,
  parseBooleanParam,
  parseMonthRange,
  parsePagination,
  parseResolvePayload,
  type ExpenseCategoryRow,
} from "./expenses-route-helpers";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

describe("expenses route helpers", () => {
  it("builds the category taxonomy with typed subcategories", () => {
    const rows: ExpenseCategoryRow[] = [
      categoryRow({ id: UUID_B, parent_id: UUID_A, slug: "restaurants-delivery", display_order: 2 }),
      categoryRow({ id: UUID_A, parent_id: null, slug: "restaurants", display_order: 1 }),
      categoryRow({ id: UUID_C, parent_id: UUID_A, slug: "restaurants-dine-in", display_order: 1 }),
    ];

    const categories = buildCategoryTree(rows);

    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({
      id: UUID_A,
      slug: "restaurants",
      color: "#BDBDBD",
      subcategories: [
        { id: UUID_C, slug: "restaurants-dine-in", parent_slug: "restaurants" },
        { id: UUID_B, slug: "restaurants-delivery", parent_slug: "restaurants" },
      ],
    });
  });

  it("normalizes Supabase numeric values without throwing", () => {
    expect(numericToNumber("12.34")).toBe(12.34);
    expect(numericToNumber(null)).toBeNull();
    expect(numericToNumber("not-a-number")).toBeNull();
  });

  it("parses pagination and clamps page size", () => {
    const params = new URLSearchParams({ page: "2", page_size: "999" });

    expect(parsePagination(params, 50)).toEqual({ page: 2, pageSize: 200, offset: 200 });
  });

  it("parses booleans and month ranges", () => {
    expect(parseBooleanParam("false", true)).toBe(false);
    expect(parseBooleanParam(null, true)).toBe(true);
    expect(parseMonthRange("2026-12", "2027-01")).toEqual({
      fromDate: "2026-12-01",
      toExclusiveDate: "2027-02-01",
    });
    expect(parseMonthRange("2026-13", null)).toBeNull();
  });

  it("accepts legacy and batch resolve payloads", () => {
    expect(
      parseResolvePayload({
        transaction_id: UUID_A,
        category_id: UUID_B,
        subcategory_id: null,
        apply_to_all_matching: true,
      }),
    ).toEqual({
      ok: true,
      payload: {
        transactionIds: [UUID_A],
        categoryId: UUID_B,
        subcategoryId: null,
        applyToAllMatching: true,
        saveMapping: true,
      },
    });

    expect(
      parseResolvePayload({
        transaction_ids: [UUID_A, UUID_B],
        category_id: UUID_C,
        save_mapping: false,
      }),
    ).toEqual({
      ok: true,
      payload: {
        transactionIds: [UUID_A, UUID_B],
        categoryId: UUID_C,
        subcategoryId: null,
        applyToAllMatching: false,
        saveMapping: false,
      },
    });
  });

  it("normalizes raw merchant text when stored normalized text is unavailable", () => {
    expect(normalizeMerchant("  Café  דוגמה!! 123 ")).toBe("CAFÉ דוגמה 123");
  });
});

function categoryRow(overrides: Partial<ExpenseCategoryRow>): ExpenseCategoryRow {
  return {
    id: UUID_A,
    parent_id: null,
    slug: "restaurants",
    name: "Restaurants",
    name_he: "מסעדות",
    icon: null,
    color: null,
    display_order: 1,
    is_transfer: false,
    ...overrides,
  };
}
