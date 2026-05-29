import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type ExpensesSupabaseClient = SupabaseClient<Database>;

let cachedWriteClient: ExpensesSupabaseClient | null = null;

export type ExpensesAuthResult =
  | {
      ok: true;
      supabase: ExpensesSupabaseClient;
      userId: string;
      householdId: string;
    }
  | { ok: false; response: NextResponse };

/** Create a server-only service-role client for writes covered by explicit household filters. */
export function createExpensesWriteClient(): ExpensesSupabaseClient | null {
  if (cachedWriteClient) return cachedWriteClient;

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  cachedWriteClient = createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedWriteClient;
}

/** Authenticate the caller and resolve their active household membership. */
export async function requireExpensesAuth(): Promise<ExpensesAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("[expenses] household lookup failed", membershipError.message);
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to resolve household" }, { status: 500 }),
    };
  }

  const householdId = typeof membership?.household_id === "string" ? membership.household_id : null;
  if (!householdId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "User not associated with any household" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, supabase, userId: user.id, householdId };
}
