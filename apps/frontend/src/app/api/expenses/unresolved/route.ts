import { NextRequest, NextResponse } from "next/server";

import type { UnresolvedTransaction } from "@/types/expenses";

import {
  DEFAULT_UNRESOLVED_PAGE_SIZE,
  normalizeSearch,
  numericToNumber,
  numericToRequiredNumber,
  parsePagination,
} from "../_lib/expenses-route-helpers";
import { requireExpensesAuth } from "../_lib/expenses-server";

export const dynamic = "force-dynamic";

interface UnresolvedTransactionRow {
  id: string;
  txn_date: string;
  merchant_raw: string;
  merchant_normalized: string;
  amount_ils: string | number;
  original_currency: string | null;
  amount_original: string | number | null;
  sector_raw: string | null;
  statement_id: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireExpensesAuth();
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const pagination = parsePagination(searchParams, DEFAULT_UNRESOLVED_PAGE_SIZE);
  const search = normalizeSearch(searchParams.get("search"));

  let countQuery = auth.supabase
    .from("credit_card_transactions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", auth.householdId)
    .is("category_id", null);

  if (search) countQuery = countQuery.ilike("merchant_raw", `%${search}%`);

  const { count, error: countError } = await countQuery;
  if (countError) {
    console.error("[expenses] unresolved count query failed", countError.message);
    return NextResponse.json({ error: "Failed to load unresolved transactions" }, { status: 500 });
  }

  let rowsQuery = auth.supabase
    .from("credit_card_transactions")
    .select(
      "id,txn_date,merchant_raw,merchant_normalized,amount_ils,original_currency,amount_original,sector_raw,statement_id",
    )
    .eq("household_id", auth.householdId)
    .is("category_id", null);

  if (search) rowsQuery = rowsQuery.ilike("merchant_raw", `%${search}%`);

  const { data, error } = await rowsQuery
    .order("txn_date", { ascending: false })
    .order("id", { ascending: false })
    .range(pagination.offset, pagination.offset + pagination.pageSize - 1);
  if (error) {
    console.error("[expenses] unresolved rows query failed", error.message);
    return NextResponse.json({ error: "Failed to load unresolved transactions" }, { status: 500 });
  }

  const items = ((data ?? []) as UnresolvedTransactionRow[]).map(toUnresolvedTransaction);

  return NextResponse.json({
    items,
    total: count ?? 0,
    page: pagination.page,
    page_size: pagination.pageSize,
  });
}

function toUnresolvedTransaction(row: UnresolvedTransactionRow): UnresolvedTransaction {
  return {
    id: row.id,
    txn_date: row.txn_date,
    merchant_raw: row.merchant_raw,
    merchant_normalized: row.merchant_normalized,
    amount_ils: numericToRequiredNumber(row.amount_ils),
    original_currency: row.original_currency,
    amount_original: numericToNumber(row.amount_original),
    sector_raw: row.sector_raw,
    statement_id: row.statement_id,
  };
}
