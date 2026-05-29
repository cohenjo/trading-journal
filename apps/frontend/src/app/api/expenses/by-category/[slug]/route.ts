import { NextRequest, NextResponse } from "next/server";

import type { TransactionDetail } from "@/types/expenses";

import {
  DEFAULT_UNRESOLVED_PAGE_SIZE,
  numericToNumber,
  numericToRequiredNumber,
  parsePagination,
} from "../../_lib/expenses-route-helpers";
import { requireExpensesAuth, type ExpensesSupabaseClient } from "../../_lib/expenses-server";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 1000;

interface CategoryLookupRow {
  id: string;
  slug: string;
}

interface TransactionDetailRow {
  id: string;
  txn_date: string;
  merchant_raw: string;
  merchant_normalized: string;
  amount_ils: string | number;
  original_currency: string | null;
  amount_original: string | number | null;
  resolution_status: string;
  resolution_source: string | null;
  statement_id: string;
}

interface AmountRow {
  amount_ils: string | number;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const auth = await requireExpensesAuth();
  if (!auth.ok) return auth.response;

  const { slug } = await context.params;
  const searchParams = request.nextUrl.searchParams;
  const pagination = parsePagination(searchParams, DEFAULT_UNRESOLVED_PAGE_SIZE);
  const fromDate = searchParams.get("from");
  const toDate = searchParams.get("to");
  const subcategorySlug = searchParams.get("subcategory_slug");

  const { data: category, error: categoryError } = await auth.supabase
    .from("expense_categories")
    .select("id,slug")
    .eq("slug", slug)
    .maybeSingle();

  if (categoryError) {
    console.error("[expenses] category lookup failed", categoryError.message);
    return NextResponse.json({ error: "Failed to load category" }, { status: 500 });
  }
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  let subcategoryId: string | null = null;
  if (subcategorySlug) {
    const { data: subcategory, error: subcategoryError } = await auth.supabase
      .from("expense_categories")
      .select("id,slug")
      .eq("slug", subcategorySlug)
      .maybeSingle();

    if (subcategoryError) {
      console.error("[expenses] subcategory lookup failed", subcategoryError.message);
      return NextResponse.json({ error: "Failed to load subcategory" }, { status: 500 });
    }
    subcategoryId = ((subcategory as CategoryLookupRow | null)?.id as string | undefined) ?? null;
  }

  const categoryId = (category as CategoryLookupRow).id;

  let countQuery = auth.supabase
    .from("credit_card_transactions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", auth.householdId)
    .eq("category_id", categoryId);
  if (fromDate) countQuery = countQuery.gte("txn_date", fromDate);
  if (toDate) countQuery = countQuery.lte("txn_date", toDate);
  if (subcategoryId) countQuery = countQuery.eq("subcategory_id", subcategoryId);

  const { count, error: countError } = await countQuery;
  if (countError) {
    console.error("[expenses] by-category count query failed", countError.message);
    return NextResponse.json({ error: "Failed to load category transactions" }, { status: 500 });
  }

  const subtotal = await loadSubtotal(auth.supabase, auth.householdId, categoryId, fromDate, toDate, subcategoryId);
  if (subtotal === null) {
    return NextResponse.json({ error: "Failed to load category subtotal" }, { status: 500 });
  }

  let rowsQuery = auth.supabase
    .from("credit_card_transactions")
    .select(
      "id,txn_date,merchant_raw,merchant_normalized,amount_ils,original_currency,amount_original,resolution_status,resolution_source,statement_id",
    )
    .eq("household_id", auth.householdId)
    .eq("category_id", categoryId);
  if (fromDate) rowsQuery = rowsQuery.gte("txn_date", fromDate);
  if (toDate) rowsQuery = rowsQuery.lte("txn_date", toDate);
  if (subcategoryId) rowsQuery = rowsQuery.eq("subcategory_id", subcategoryId);

  const { data, error } = await rowsQuery
    .order("txn_date", { ascending: false })
    .order("id", { ascending: false })
    .range(pagination.offset, pagination.offset + pagination.pageSize - 1);

  if (error) {
    console.error("[expenses] by-category rows query failed", error.message);
    return NextResponse.json({ error: "Failed to load category transactions" }, { status: 500 });
  }

  return NextResponse.json({
    items: ((data ?? []) as TransactionDetailRow[]).map(toTransactionDetail),
    total: count ?? 0,
    page: pagination.page,
    page_size: pagination.pageSize,
    category_slug: slug,
    subtotal_ils: subtotal,
  });
}

async function loadSubtotal(
  supabase: ExpensesSupabaseClient,
  householdId: string,
  categoryId: string,
  fromDate: string | null,
  toDate: string | null,
  subcategoryId: string | null,
): Promise<number | null> {
  let subtotal = 0;

  for (let offset = 0; ; offset += BATCH_SIZE) {
    let query = supabase
      .from("credit_card_transactions")
      .select("amount_ils")
      .eq("household_id", householdId)
      .eq("category_id", categoryId);
    if (fromDate) query = query.gte("txn_date", fromDate);
    if (toDate) query = query.lte("txn_date", toDate);
    if (subcategoryId) query = query.eq("subcategory_id", subcategoryId);

    const { data, error } = await query.range(offset, offset + BATCH_SIZE - 1);
    if (error) {
      console.error("[expenses] by-category subtotal query failed", error.message);
      return null;
    }

    const rows = (data ?? []) as AmountRow[];
    subtotal += rows.reduce(
      (sum, row) => sum + numericToRequiredNumber(row.amount_ils),
      0,
    );
    if (rows.length < BATCH_SIZE) break;
  }

  return subtotal;
}

function toTransactionDetail(row: TransactionDetailRow): TransactionDetail {
  return {
    id: row.id,
    txn_date: row.txn_date,
    merchant_raw: row.merchant_raw,
    merchant_normalized: row.merchant_normalized,
    amount_ils: numericToRequiredNumber(row.amount_ils),
    original_currency: row.original_currency,
    amount_original: numericToNumber(row.amount_original),
    resolution_status: row.resolution_status,
    resolution_source: row.resolution_source,
    statement_id: row.statement_id,
  };
}
