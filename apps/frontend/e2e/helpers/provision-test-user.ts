/**
 * e2e/helpers/provision-test-user.ts
 *
 * Standalone helper for provisioning and tearing down E2E test users.
 *
 * This module is framework-agnostic (no Playwright imports) so it can be:
 *   - Imported by Playwright fixtures (test-user.ts)
 *   - Used in CI setup scripts (seed-test-user.ts)
 *   - Called from a long-lived shared-user mode (CI fast-path)
 *
 * Two modes:
 *   1. Ephemeral (default): creates e2e_<ts>_<rand>@example.com per test run.
 *   2. Shared (CI fast-path): reuses E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD
 *      if set. The shared user must be pre-provisioned by seed-test-user.ts.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY         — service-role key (bypasses RLS)
 *
 * Optional env vars:
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY     — anon key (for password-grant sign-in)
 *   E2E_TEST_USER_EMAIL               — shared user email (CI fast-path)
 *   E2E_TEST_USER_PASSWORD            — shared user password (CI fast-path)
 *   SUPABASE_E2E_ALLOW_PROD           — set to "true" to skip the prod-URL guard
 *   E2E_HOUSEHOLD_POLL_TIMEOUT_MS     — override household poll timeout (default 10000)
 */

import { getAdminClient, makeE2eEmail } from '../fixtures/admin';

/** Shared password used for ephemeral users. */
export const DEFAULT_E2E_PASSWORD = 'E2eTestPass!1';

/** Household poll timeout (ms). CI may need more time if the trigger is slow. */
const POLL_TIMEOUT_MS = Number(process.env.E2E_HOUSEHOLD_POLL_TIMEOUT_MS ?? 10_000);
const POLL_INTERVAL_MS = 300;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  householdId: string;
  accessToken: string;
  refreshToken: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Polls `public.household_members` via the admin client until a row for
 * `userId` appears (the auto-provision trigger fires asynchronously).
 *
 * Throws with a clear message if the row never appears within `timeoutMs`.
 */
async function waitForHousehold(userId: string, timeoutMs = POLL_TIMEOUT_MS): Promise<string> {
  const admin = getAdminClient();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      // Row may not exist yet — keep polling
      console.warn(`[provision-test-user] household poll warning: ${error.message}`);
    } else if (data?.household_id) {
      return data.household_id as string;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `[provision-test-user] household not provisioned for user ${userId} within ${timeoutMs}ms. ` +
    `Check migration 20260502120000 (auto-provision trigger) is deployed and the ` +
    `service-role key can read household_members.`,
  );
}

/**
 * Obtains an access + refresh token pair via direct REST password grant.
 *
 * Uses the anon key (public) — does NOT require the service-role key.
 * Returns { accessToken, refreshToken } or throws on failure.
 */
async function signIn(
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      '[provision-test-user] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }

  const resp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `[provision-test-user] password grant failed (${resp.status}): ${body}`,
    );
  }

  const session = await resp.json() as {
    access_token: string;
    refresh_token: string;
  };

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Provisions a complete test user with an auto-provisioned household.
 *
 * Steps:
 *   1. Creates auth user via admin API (or reuses the shared user if in CI fast-path mode).
 *   2. Polls `household_members` until the auto-provision trigger fires (≤10s).
 *   3. Signs in via password grant to obtain access + refresh tokens.
 *   4. Returns a fully-typed `TestUser` object.
 *
 * @param opts.sharedMode - If true, reads E2E_TEST_USER_EMAIL/PASSWORD from env
 *                          instead of creating a new user. The shared user must
 *                          already exist (pre-provisioned by seed-test-user.ts).
 */
export async function provisionTestUser(opts?: { sharedMode?: boolean }): Promise<TestUser> {
  const useShared =
    opts?.sharedMode === true ||
    (Boolean(process.env.E2E_TEST_USER_EMAIL) && Boolean(process.env.E2E_TEST_USER_PASSWORD));

  let userId: string;
  let email: string;
  const password = useShared
    ? (process.env.E2E_TEST_USER_PASSWORD ?? DEFAULT_E2E_PASSWORD)
    : DEFAULT_E2E_PASSWORD;

  if (useShared) {
    // CI fast-path: resolve userId from the existing user record
    email = process.env.E2E_TEST_USER_EMAIL!;
    const admin = getAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) {
      throw new Error(`[provision-test-user] listUsers failed: ${error.message}`);
    }
    const existing = data.users.find((u) => u.email === email);
    if (!existing) {
      throw new Error(
        `[provision-test-user] Shared user "${email}" not found. ` +
        `Run: npx tsx e2e/scripts/seed-test-user.ts`,
      );
    }
    userId = existing.id;
  } else {
    // Ephemeral mode: create a fresh throwaway user
    email = makeE2eEmail();
    const admin = getAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(
        `[provision-test-user] createUser failed for "${email}": ${error?.message}`,
      );
    }
    userId = data.user.id;
  }

  // Wait for the auto-provision trigger (migration 20260502120000)
  const householdId = await waitForHousehold(userId);

  // Sign in to get tokens
  const { accessToken, refreshToken } = await signIn(email, password);

  return { userId, email, password, householdId, accessToken, refreshToken };
}

/**
 * Tears down a test user and ALL associated household data.
 *
 * Because there is no ON DELETE CASCADE from `auth.users` to `household_members`,
 * we must explicitly clean up household data before or after removing the auth row.
 *
 * Cleanup order (FK-safe):
 *   1. finance_snapshots (household_id FK)
 *   2. trade             (household_id FK)
 *   3. households        (CASCADE deletes household_members via FK)
 *   4. auth.users        (admin.deleteUser)
 *
 * Safe to call in afterAll — never throws (logs warnings instead).
 *
 * @param userId - The user UUID returned by `provisionTestUser()`.
 * @param opts.skipShared - If true and E2E_TEST_USER_EMAIL is set, skips teardown
 *                          (preserves the long-lived shared user for future runs).
 */
export async function teardownTestUser(
  userId: string,
  opts?: { skipShared?: boolean },
): Promise<void> {
  if (opts?.skipShared && process.env.E2E_TEST_USER_EMAIL) {
    console.log(`[provision-test-user] Skipping teardown for shared user ${userId}`);
    return;
  }

  const admin = getAdminClient();

  // ── Step 1: find household ──────────────────────────────────────────────────
  const { data: memberRow } = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .maybeSingle();

  const householdId = memberRow?.household_id as string | undefined;

  // ── Step 2: wipe household data via SQL function ────────────────────────────
  // Uses `e2e_reset_test_user()` (SECURITY DEFINER, SET LOCAL replica trigger mode)
  // which bypasses the last_owner_constraint guard triggers on household_members.
  // This is the only reliable way to remove the last active owner row.
  if (householdId) {
    const userRecord = await admin.auth.admin.getUserById(userId);
    const email = userRecord.data.user?.email;
    if (email) {
      const { error: rpcErr } = await admin.rpc(
        // The admin client is untyped (SupabaseClient<any>) so rpc accepts any string
        'e2e_reset_test_user' as Parameters<typeof admin.rpc>[0],
        { p_email: email },
      );
      if (rpcErr) {
        console.warn(`[provision-test-user] e2e_reset_test_user RPC warning: ${rpcErr.message}`);
      }
    }
  }

  // ── Step 3: delete auth user ─────────────────────────────────────────────────
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    if (error.message.toLowerCase().includes('not found')) {
      return;
    }
    console.warn(
      `[provision-test-user] teardown warning for user ${userId}: ${error.message}`,
    );
  } else {
    console.log(`[provision-test-user] Deleted user ${userId} and cascaded household data.`);
  }
}
