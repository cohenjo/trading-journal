/**
 * Typed fetch wrappers for the CC-6 expenses API endpoints.
 * All calls go through apiFetch to attach the Supabase JWT.
 *
 * Security note (Rabin §3.2): never log merchant_raw to console at INFO level.
 * Use console.debug behind the NEXT_PUBLIC_DEBUG_EXPENSES feature flag only.
 */

import { apiFetch } from "@/lib/api-client";
import type {
  ByCategoryResponse,
  ExpenseCategory,
  MonthlySummaryRow,
  ResolveRequest,
  ResolveResponse,
  StatementsResponse,
  UnresolvedResponse,
} from "@/types/expenses";

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_EXPENSES === "true";

// ── GET /api/expenses/categories ─────────────────────────────────────────────
// Hardcoded fallback (graceful degradation if backend unavailable)
const HARDCODED_FALLBACK_CATEGORIES: ExpenseCategory[] = [
  {
    id: "cat-groceries",
    slug: "groceries",
    name: "Groceries",
    name_he: "מזון וסופרמרקט",
    color: "#4CAF50",
    icon: "shopping-cart",
    is_transfer: false,
    subcategories: [],
  },
  // Add more categories as needed — this is a fallback only
];

export async function getCategories(): Promise<ExpenseCategory[]> {
  try {
    const res = await apiFetch("/api/expenses/categories");
    if (!res.ok) throw new Error(`getCategories failed: ${res.status}`);
    const data = await res.json();
    if (DEBUG) console.debug("[expenses] getCategories returned", data.categories.length, "top-level categories");
    return data.categories;
  } catch (error) {
    console.warn("[expenses] getCategories fallback:", error);
    return HARDCODED_FALLBACK_CATEGORIES;
  }
}

// ── GET /api/expenses/unresolved ─────────────────────────────────────────────

export interface GetUnresolvedParams {
  page?: number;
  page_size?: number;
  search?: string;
}

export async function getUnresolved(params: GetUnresolvedParams = {}): Promise<UnresolvedResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  if (params.search) qs.set("search", params.search);

  const res = await apiFetch(`/api/expenses/unresolved?${qs.toString()}`);
  if (!res.ok) throw new Error(`getUnresolved failed: ${res.status}`);
  const data: UnresolvedResponse = await res.json();
  if (DEBUG) console.debug("[expenses] getUnresolved count:", data.total);
  return data;
}

// ── GET /api/expenses/monthly-summary ────────────────────────────────────────

export interface GetMonthlySummaryParams {
  from?: string; // 'YYYY-MM'
  to?: string; // 'YYYY-MM'
  exclude_transfers?: boolean;
}

export async function getMonthlySummary(
  params: GetMonthlySummaryParams = {},
): Promise<MonthlySummaryRow[]> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.exclude_transfers !== undefined)
    qs.set("exclude_transfers", String(params.exclude_transfers));

  const res = await apiFetch(`/api/expenses/monthly-summary?${qs.toString()}`);
  if (!res.ok) throw new Error(`getMonthlySummary failed: ${res.status}`);
  return res.json();
}

// ── GET /api/expenses/by-category/{slug} ─────────────────────────────────────

export interface GetByCategoryParams {
  from?: string; // 'YYYY-MM-DD'
  to?: string; // 'YYYY-MM-DD'
  subcategory_slug?: string;
  page?: number;
  page_size?: number;
}

export async function getByCategory(
  slug: string,
  params: GetByCategoryParams = {},
): Promise<ByCategoryResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.subcategory_slug) qs.set("subcategory_slug", params.subcategory_slug);
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));

  const res = await apiFetch(`/api/expenses/by-category/${encodeURIComponent(slug)}?${qs.toString()}`);
  if (!res.ok) throw new Error(`getByCategory failed: ${res.status}`);
  return res.json();
}

// ── GET /api/expenses/statements ─────────────────────────────────────────────

export interface GetStatementsParams {
  cardholder?: string;
  issuer?: string;
  from?: string; // 'YYYY-MM'
  to?: string; // 'YYYY-MM'
  page?: number;
  page_size?: number;
}

export async function getStatements(params: GetStatementsParams = {}): Promise<StatementsResponse> {
  const qs = new URLSearchParams();
  if (params.cardholder) qs.set("cardholder", params.cardholder);
  if (params.issuer) qs.set("issuer", params.issuer);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));

  const res = await apiFetch(`/api/expenses/statements?${qs.toString()}`);
  if (!res.ok) throw new Error(`getStatements failed: ${res.status}`);
  return res.json();
}

// ── POST /api/expenses/resolve ────────────────────────────────────────────────

export async function resolveTransaction(body: ResolveRequest): Promise<ResolveResponse> {
  const res = await apiFetch("/api/expenses/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`resolveTransaction failed: ${res.status}`);
  return res.json();
}
