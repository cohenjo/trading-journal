import { NextRequest, NextResponse } from "next/server";

import type { Statement } from "@/types/expenses";

import {
  DEFAULT_STATEMENTS_PAGE_SIZE,
  normalizeSearch,
  numericToNumber,
  parseMonthRange,
  parsePagination,
} from "../_lib/expenses-route-helpers";
import { requireExpensesAuth } from "../_lib/expenses-server";

export const dynamic = "force-dynamic";

interface StatementRow {
  id: string;
  issuer: string;
  cardholder_name: string;
  card_last4: string;
  period_from: string;
  period_to: string;
  total_amount_ils: string | number | null;
  txn_count: number | null;
  parse_warnings: unknown;
  ingested_at: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireExpensesAuth();
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const pagination = parsePagination(searchParams, DEFAULT_STATEMENTS_PAGE_SIZE);
  const monthRange = parseMonthRange(searchParams.get("from"), searchParams.get("to"));
  if (!monthRange) {
    return NextResponse.json({ error: "Invalid month filter" }, { status: 400 });
  }

  const cardholder = normalizeSearch(searchParams.get("cardholder"));
  const issuer = normalizeSearch(searchParams.get("issuer"));

  let countQuery = auth.supabase
    .from("credit_card_statements")
    .select("id", { count: "exact", head: true })
    .eq("household_id", auth.householdId);
  if (cardholder) countQuery = countQuery.ilike("cardholder_name", `%${cardholder}%`);
  if (issuer) countQuery = countQuery.eq("issuer", issuer);
  if (monthRange.fromDate) countQuery = countQuery.gte("period_from", monthRange.fromDate);
  if (monthRange.toExclusiveDate) countQuery = countQuery.lt("period_from", monthRange.toExclusiveDate);

  const { count, error: countError } = await countQuery;
  if (countError) {
    console.error("[expenses] statements count query failed", countError.message);
    return NextResponse.json({ error: "Failed to load statements" }, { status: 500 });
  }

  let rowsQuery = auth.supabase
    .from("credit_card_statements")
    .select(
      "id,issuer,cardholder_name,card_last4,period_from,period_to,total_amount_ils,txn_count,parse_warnings,ingested_at",
    )
    .eq("household_id", auth.householdId);
  if (cardholder) rowsQuery = rowsQuery.ilike("cardholder_name", `%${cardholder}%`);
  if (issuer) rowsQuery = rowsQuery.eq("issuer", issuer);
  if (monthRange.fromDate) rowsQuery = rowsQuery.gte("period_from", monthRange.fromDate);
  if (monthRange.toExclusiveDate) rowsQuery = rowsQuery.lt("period_from", monthRange.toExclusiveDate);

  const { data, error } = await rowsQuery
    .order("period_from", { ascending: false })
    .order("id", { ascending: false })
    .range(pagination.offset, pagination.offset + pagination.pageSize - 1);

  if (error) {
    console.error("[expenses] statements rows query failed", error.message);
    return NextResponse.json({ error: "Failed to load statements" }, { status: 500 });
  }

  return NextResponse.json({
    items: ((data ?? []) as StatementRow[]).map(toStatement),
    total: count ?? 0,
    page: pagination.page,
    page_size: pagination.pageSize,
  });
}

function toStatement(row: StatementRow): Statement {
  return {
    id: row.id,
    issuer: row.issuer,
    cardholder_name: row.cardholder_name,
    card_last4: row.card_last4,
    period_from: row.period_from,
    period_to: row.period_to,
    total_amount_ils: numericToNumber(row.total_amount_ils),
    txn_count: row.txn_count,
    parse_warnings_count: Array.isArray(row.parse_warnings) ? row.parse_warnings.length : 0,
    ingested_at: row.ingested_at,
  };
}
