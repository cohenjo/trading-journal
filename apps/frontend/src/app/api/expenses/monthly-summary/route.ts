import { NextRequest, NextResponse } from "next/server";

import type { MonthlySummaryRow } from "@/types/expenses";

import {
  numericToRequiredNumber,
  parseBooleanParam,
  parseMonthRange,
  type ExpenseCategoryRow,
} from "../_lib/expenses-route-helpers";
import { requireExpensesAuth } from "../_lib/expenses-server";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 1000;

interface SummaryTransactionRow {
  txn_date: string;
  amount_ils: string | number;
  category_id: string | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireExpensesAuth();
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const monthRange = parseMonthRange(searchParams.get("from"), searchParams.get("to"));
  if (!monthRange) {
    return NextResponse.json({ error: "Invalid month filter" }, { status: 400 });
  }

  const excludeTransfers = parseBooleanParam(searchParams.get("exclude_transfers"), true);

  const { data: categoriesData, error: categoriesError } = await auth.supabase
    .from("expense_categories")
    .select("id,parent_id,slug,name,name_he,icon,color,display_order,is_transfer")
    .order("display_order", { ascending: true })
    .order("slug", { ascending: true });

  if (categoriesError) {
    console.error("[expenses] summary categories query failed", categoriesError.message);
    return NextResponse.json({ error: "Failed to load expense categories" }, { status: 500 });
  }

  const categoriesById = new Map(
    ((categoriesData ?? []) as ExpenseCategoryRow[]).map((category) => [category.id, category]),
  );
  const summaryByKey = new Map<string, MonthlySummaryRow>();

  for (let offset = 0; ; offset += BATCH_SIZE) {
    let query = auth.supabase
      .from("credit_card_transactions")
      .select("txn_date,amount_ils,category_id")
      .eq("household_id", auth.householdId)
      .not("category_id", "is", null);

    if (monthRange.fromDate) query = query.gte("txn_date", monthRange.fromDate);
    if (monthRange.toExclusiveDate) query = query.lt("txn_date", monthRange.toExclusiveDate);

    const { data, error } = await query
      .order("txn_date", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) {
      console.error("[expenses] monthly summary query failed", error.message);
      return NextResponse.json({ error: "Failed to load monthly summary" }, { status: 500 });
    }

    const rows = (data ?? []) as SummaryTransactionRow[];
    for (const row of rows) {
      if (!row.category_id) continue;
      const category = categoriesById.get(row.category_id);
      if (!category || (excludeTransfers && category.is_transfer)) continue;

      const month = row.txn_date.slice(0, 7);
      const key = `${month}:${category.id}`;
      const existing = summaryByKey.get(key);
      if (existing) {
        existing.amount_ils += numericToRequiredNumber(row.amount_ils);
        existing.txn_count += 1;
      } else {
        summaryByKey.set(key, {
          month,
          category_slug: category.slug,
          category_name: category.name,
          category_name_he: category.name_he,
          amount_ils: numericToRequiredNumber(row.amount_ils),
          txn_count: 1,
        });
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  const summary = [...summaryByKey.values()].sort(
    (left, right) =>
      right.month.localeCompare(left.month) || right.amount_ils - left.amount_ils,
  );

  return NextResponse.json(summary);
}
