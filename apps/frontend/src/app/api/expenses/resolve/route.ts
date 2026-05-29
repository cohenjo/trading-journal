import { NextRequest, NextResponse } from "next/server";

import { normalizeMerchant, parseResolvePayload, type ResolvePayload } from "../_lib/expenses-route-helpers";
import {
  createExpensesWriteClient,
  requireExpensesAuth,
  type ExpensesSupabaseClient,
} from "../_lib/expenses-server";

export const dynamic = "force-dynamic";

interface TransactionResolveRow {
  id: string;
  merchant_raw: string;
  merchant_normalized: string;
  statement_id: string;
}

interface IdRow {
  id: string;
}

interface MappingRow {
  id: string;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  const auth = await requireExpensesAuth();
  if (!auth.ok) return auth.response;

  // TODO(CC-13): rate-limit POST /resolve to 10 req/sec per authenticated user.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseResolvePayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const payload = {
    ...parsed.payload,
    transactionIds: [...new Set(parsed.payload.transactionIds)],
  } satisfies ResolvePayload;
  const writeSupabase = createExpensesWriteClient() ?? auth.supabase;

  const categoryValidation = await validateCategories(auth.supabase, payload);
  if (!categoryValidation.ok) return categoryValidation.response;

  const { data: transactionsData, error: transactionsError } = await auth.supabase
    .from("credit_card_transactions")
    .select("id,merchant_raw,merchant_normalized,statement_id")
    .eq("household_id", auth.householdId)
    .in("id", payload.transactionIds);

  if (transactionsError) {
    console.error("[expenses] resolve transaction lookup failed", transactionsError.message);
    return NextResponse.json({ error: "Failed to resolve transaction" }, { status: 500 });
  }

  const transactions = (transactionsData ?? []) as TransactionResolveRow[];
  if (transactions.length !== payload.transactionIds.length) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  const firstStatementId = transactions[0]?.statement_id;

  let mappingId = "";
  if (payload.saveMapping) {
    const merchants = distinctMerchants(transactions);
    for (const merchant of merchants) {
      const result = await upsertMerchantMapping(
        writeSupabase,
        auth.householdId,
        auth.userId,
        merchant,
        payload,
      );
      if (!result.ok) {
        return NextResponse.json(
          { error: "Failed to save merchant mapping", statement_id: firstStatementId },
          { status: 500 },
        );
      }
      mappingId ||= result.mappingId;
    }
  }

  const { data: updatedTargets, error: updateError } = await writeSupabase
    .from("credit_card_transactions")
    .update({
      category_id: payload.categoryId,
      subcategory_id: payload.subcategoryId,
      resolution_status: "user_confirmed",
      resolution_source: "user",
    })
    .eq("household_id", auth.householdId)
    .in("id", payload.transactionIds)
    .select("id");

  if (updateError) {
    console.error("[expenses] resolve target update failed", updateError.message);
    return NextResponse.json(
      { error: "Failed to resolve transaction", statement_id: firstStatementId },
      { status: 500 },
    );
  }

  let updatedCount = ((updatedTargets ?? []) as IdRow[]).length;
  if (updatedCount !== payload.transactionIds.length) {
    return NextResponse.json(
      { error: "Failed to resolve transaction", statement_id: firstStatementId },
      { status: 500 },
    );
  }

  if (payload.applyToAllMatching && transactions.length === 1) {
    const merchant = distinctMerchants(transactions)[0];
    if (merchant) {
      const matchingResult = await updateMatchingTransactions(
        writeSupabase,
        auth.householdId,
        payload,
        transactions[0].id,
        merchant,
      );
      if (!matchingResult.ok) {
        return NextResponse.json(
          { error: "Failed to resolve matching transactions", statement_id: firstStatementId },
          { status: 500 },
        );
      }
      updatedCount += matchingResult.updatedCount;
    }
  }

  return NextResponse.json({ updated_count: updatedCount, mapping_id: mappingId });
}

async function validateCategories(
  supabase: ExpensesSupabaseClient,
  payload: ResolvePayload,
): Promise<{ ok: true } | { ok: false; response: NextResponse<{ error: string }> }> {
  const { data: category, error: categoryError } = await supabase
    .from("expense_categories")
    .select("id")
    .eq("id", payload.categoryId)
    .maybeSingle();

  if (categoryError) {
    console.error("[expenses] resolve category lookup failed", categoryError.message);
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to load category" }, { status: 500 }),
    };
  }
  if (!category) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Category not found" }, { status: 404 }),
    };
  }

  if (!payload.subcategoryId) return { ok: true };

  const { data: subcategory, error: subcategoryError } = await supabase
    .from("expense_categories")
    .select("id")
    .eq("id", payload.subcategoryId)
    .maybeSingle();

  if (subcategoryError) {
    console.error("[expenses] resolve subcategory lookup failed", subcategoryError.message);
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to load subcategory" }, { status: 500 }),
    };
  }
  if (!subcategory) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Subcategory not found" }, { status: 404 }),
    };
  }

  return { ok: true };
}

async function upsertMerchantMapping(
  supabase: ExpensesSupabaseClient,
  householdId: string,
  userId: string,
  merchantNormalized: string,
  payload: ResolvePayload,
): Promise<{ ok: true; mappingId: string } | { ok: false }> {
  const { data: existingMapping, error: existingError } = await supabase
    .from("merchant_category_mappings")
    .select("id")
    .eq("household_id", householdId)
    .eq("merchant_normalized", merchantNormalized)
    .eq("source", "user")
    .maybeSingle();

  if (existingError) {
    console.error("[expenses] mapping lookup failed", existingError.message);
    return { ok: false };
  }

  if (existingMapping) {
    const { data, error } = await supabase
      .from("merchant_category_mappings")
      .update({
        category_id: payload.categoryId,
        subcategory_id: payload.subcategoryId,
        created_by: userId,
      })
      .eq("household_id", householdId)
      .eq("id", (existingMapping as MappingRow).id)
      .select("id")
      .maybeSingle();

    if (error || !data) {
      if (error) console.error("[expenses] mapping update failed", error.message);
      return { ok: false };
    }
    return { ok: true, mappingId: (data as MappingRow).id };
  }

  const { data, error } = await supabase
    .from("merchant_category_mappings")
    .insert({
      merchant_normalized: merchantNormalized,
      household_id: householdId,
      category_id: payload.categoryId,
      subcategory_id: payload.subcategoryId,
      confidence: 1,
      source: "user",
      created_by: userId,
      match_count: 0,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[expenses] mapping insert failed", error.message);
    return { ok: false };
  }

  return { ok: true, mappingId: (data as MappingRow).id };
}

async function updateMatchingTransactions(
  supabase: ExpensesSupabaseClient,
  householdId: string,
  payload: ResolvePayload,
  targetTransactionId: string,
  merchantNormalized: string,
): Promise<{ ok: true; updatedCount: number } | { ok: false }> {
  const { data: matchingRows, error: matchingError } = await supabase
    .from("credit_card_transactions")
    .select("id")
    .eq("household_id", householdId)
    .eq("merchant_normalized", merchantNormalized)
    .eq("resolution_status", "unresolved")
    .is("category_id", null)
    .neq("id", targetTransactionId);

  if (matchingError) {
    console.error("[expenses] matching transaction lookup failed", matchingError.message);
    return { ok: false };
  }

  const matchingIds = ((matchingRows ?? []) as IdRow[]).map((row) => row.id);
  if (matchingIds.length === 0) return { ok: true, updatedCount: 0 };

  const { data: updatedRows, error: updateError } = await supabase
    .from("credit_card_transactions")
    .update({
      category_id: payload.categoryId,
      subcategory_id: payload.subcategoryId,
      resolution_status: "user_confirmed",
      resolution_source: "mapping",
    })
    .eq("household_id", householdId)
    .in("id", matchingIds)
    .select("id");

  if (updateError) {
    console.error("[expenses] matching transaction update failed", updateError.message);
    return { ok: false };
  }

  return { ok: true, updatedCount: ((updatedRows ?? []) as IdRow[]).length };
}

function distinctMerchants(transactions: TransactionResolveRow[]): string[] {
  return [
    ...new Set(
      transactions
        .map((transaction) =>
          transaction.merchant_normalized || normalizeMerchant(transaction.merchant_raw),
        )
        .filter((merchant) => merchant.length > 0),
    ),
  ];
}
