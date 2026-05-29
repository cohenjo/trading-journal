import { NextResponse } from "next/server";

import { buildCategoryTree, type ExpenseCategoryRow } from "../_lib/expenses-route-helpers";
import { requireExpensesAuth } from "../_lib/expenses-server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireExpensesAuth();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("expense_categories")
    .select("id,parent_id,slug,name,name_he,icon,color,display_order,is_transfer")
    .order("display_order", { ascending: true })
    .order("slug", { ascending: true });

  if (error) {
    console.error("[expenses] categories query failed", error.message);
    return NextResponse.json({ error: "Failed to load expense categories" }, { status: 500 });
  }

  return NextResponse.json({ categories: buildCategoryTree((data ?? []) as ExpenseCategoryRow[]) });
}
