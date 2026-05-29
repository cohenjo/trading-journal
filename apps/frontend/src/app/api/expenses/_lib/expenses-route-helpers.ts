import type {
  ExpenseCategory,
  ExpenseSubcategory,
  ResolveRequest,
} from "@/types/expenses";

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_UNRESOLVED_PAGE_SIZE = 50;
export const DEFAULT_STATEMENTS_PAGE_SIZE = 20;

export interface ExpenseCategoryRow {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  name_he: string;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_transfer: boolean;
}

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export interface MonthRange {
  fromDate?: string;
  toExclusiveDate?: string;
}

export interface ResolvePayload {
  transactionIds: string[];
  categoryId: string;
  subcategoryId: string | null;
  applyToAllMatching: boolean;
  saveMapping: boolean;
}

export type ResolvePayloadResult =
  | { ok: true; payload: ResolvePayload }
  | { ok: false; error: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Build the category taxonomy returned by GET /api/expenses/categories. */
export function buildCategoryTree(rows: ExpenseCategoryRow[]): ExpenseCategory[] {
  const sortedRows = [...rows].sort((left, right) => {
    const byParent = (left.parent_id ?? "").localeCompare(right.parent_id ?? "");
    if (byParent !== 0) return byParent;
    const byOrder = left.display_order - right.display_order;
    if (byOrder !== 0) return byOrder;
    return left.slug.localeCompare(right.slug);
  });

  const rowsById = new Map(sortedRows.map((row) => [row.id, row]));
  const parents = new Map<string, ExpenseCategory>();

  for (const row of sortedRows) {
    if (row.parent_id !== null) continue;

    parents.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: row.name,
      name_he: row.name_he,
      color: row.color ?? "#BDBDBD",
      ...(row.icon ? { icon: row.icon } : {}),
      is_transfer: row.is_transfer,
      subcategories: [],
    });
  }

  for (const row of sortedRows) {
    if (row.parent_id === null) continue;

    const parent = parents.get(row.parent_id);
    const parentRow = rowsById.get(row.parent_id);
    if (!parent || !parentRow) continue;

    const subcategory: ExpenseSubcategory = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      name_he: row.name_he,
      parent_slug: parentRow.slug,
    };
    parent.subcategories.push(subcategory);
  }

  return [...parents.values()].sort((left, right) => {
    const leftRow = rowsById.get(left.id);
    const rightRow = rowsById.get(right.id);
    const byOrder = (leftRow?.display_order ?? 0) - (rightRow?.display_order ?? 0);
    if (byOrder !== 0) return byOrder;
    return left.slug.localeCompare(right.slug);
  });
}

/** Convert Supabase NUMERIC strings to JSON numbers, preserving nulls. */
export function numericToNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function numericToRequiredNumber(value: string | number | null | undefined): number {
  return numericToNumber(value) ?? 0;
}

export function parsePagination(
  searchParams: URLSearchParams,
  defaultPageSize: number,
): Pagination {
  const page = clampInteger(searchParams.get("page"), 1, Number.MAX_SAFE_INTEGER, 1);
  const pageSize = clampInteger(
    searchParams.get("page_size"),
    1,
    MAX_PAGE_SIZE,
    defaultPageSize,
  );

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function parseBooleanParam(value: string | null, defaultValue: boolean): boolean {
  if (value === null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
}

export function parseMonthRange(from: string | null, to: string | null): MonthRange | null {
  const fromDate = from ? monthStart(from) : undefined;
  const toExclusiveDate = to ? nextMonthStart(to) : undefined;

  if ((from && !fromDate) || (to && !toExclusiveDate)) return null;

  return { fromDate, toExclusiveDate };
}

export function normalizeSearch(value: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.slice(0, 100);
}

export function normalizeMerchant(raw: string): string {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseResolvePayload(input: unknown): ResolvePayloadResult {
  if (!isRecord(input)) {
    return { ok: false, error: "Invalid request body" };
  }

  const transactionIds = readTransactionIds(input);
  const categoryId = readString(input.category_id);
  const subcategoryId = readNullableString(input.subcategory_id);
  const applyToAllMatching = readBoolean(input.apply_to_all_matching, false);
  const saveMapping = readBoolean(input.save_mapping, transactionIds.source === "legacy");

  if (transactionIds.values.length === 0) {
    return { ok: false, error: "transaction_ids is required" };
  }
  if (!categoryId) {
    return { ok: false, error: "category_id is required" };
  }
  if (!transactionIds.values.every(isUuid)) {
    return { ok: false, error: "transaction_ids must be UUIDs" };
  }
  if (!isUuid(categoryId)) {
    return { ok: false, error: "category_id must be a UUID" };
  }
  if (subcategoryId !== null && !isUuid(subcategoryId)) {
    return { ok: false, error: "subcategory_id must be a UUID" };
  }

  return {
    ok: true,
    payload: {
      transactionIds: transactionIds.values,
      categoryId,
      subcategoryId,
      applyToAllMatching,
      saveMapping,
    },
  };
}

function clampInteger(
  value: string | null,
  min: number,
  max: number,
  defaultValue: number,
): number {
  if (value === null) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

function monthStart(month: string): string | undefined {
  if (!MONTH_PATTERN.test(month)) return undefined;
  return `${month}-01`;
}

function nextMonthStart(month: string): string | undefined {
  if (!MONTH_PATTERN.test(month)) return undefined;
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const date = new Date(Date.UTC(year, monthIndex + 1, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}-01`;
}

function readTransactionIds(input: Record<string, unknown>): {
  values: string[];
  source: "batch" | "legacy";
} {
  if (Array.isArray(input.transaction_ids)) {
    return {
      values: input.transaction_ids.filter((value): value is string => typeof value === "string"),
      source: "batch",
    };
  }

  const legacyRequest = input as Partial<ResolveRequest>;
  return {
    values: typeof legacyRequest.transaction_id === "string" ? [legacyRequest.transaction_id] : [],
    source: "legacy",
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : readString(value);
}

function readBoolean(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
