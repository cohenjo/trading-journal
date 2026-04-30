/**
 * Supabase service-role admin client for E2E test fixtures.
 *
 * IMPORTANT: This file must ONLY be imported from test fixtures and scripts.
 * It uses the service_role key which bypasses RLS — never use it in app code.
 *
 * Reads from environment:
 *   NEXT_PUBLIC_SUPABASE_URL      — shared with the app
 *   SUPABASE_SERVICE_ROLE_KEY     — test-only; never prefix with NEXT_PUBLIC_
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Validates the URL looks like a dev/local project, not production.
 * Prod guard: we check the ref slug (the subdomain before .supabase.co).
 * If SUPABASE_E2E_ALLOW_PROD=true is set explicitly, this check is bypassed
 * (useful in staging environments that use a "prod-shaped" URL).
 */
function assertNotProd(url: string): void {
  if (process.env.SUPABASE_E2E_ALLOW_PROD === 'true') return;

  // localhost or 127.0.0.1 = local Supabase — always OK
  if (url.includes('localhost') || url.includes('127.0.0.1')) return;

  // Extract ref slug: https://<ref>.supabase.co
  const refMatch = url.match(/https?:\/\/([^.]+)\.supabase\.co/);
  if (!refMatch) {
    // Non-standard URL — allow (could be a custom domain dev environment)
    return;
  }

  const ref = refMatch[1].toLowerCase();

  // Require that the ref contains a dev/staging hint.
  // Production refs are typically short opaque strings like "abcdefghij".
  // Dev projects are usually named with hints like "dev", "staging", "local", "test".
  const DEV_HINTS = ['dev', 'stag', 'test', 'local', 'preview', 'sandbox'];
  const looksLikeDev = DEV_HINTS.some((hint) => ref.includes(hint));

  if (!looksLikeDev) {
    throw new Error(
      `[e2e/admin] SAFETY BLOCK: NEXT_PUBLIC_SUPABASE_URL "${url}" does not look like a ` +
      `dev/staging project (ref: "${ref}"). ` +
      `E2E tests must not run against production Supabase. ` +
      `If this is intentional, set SUPABASE_E2E_ALLOW_PROD=true.`,
    );
  }
}

let _adminClient: SupabaseClient | null = null;

/** Returns a singleton service-role admin client. Throws on misconfiguration. */
export function getAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;

  if (!SUPABASE_URL) {
    throw new Error('[e2e/admin] NEXT_PUBLIC_SUPABASE_URL is not set.');
  }
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      '[e2e/admin] SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'Add it to .env.local (never prefix with NEXT_PUBLIC_).',
    );
  }

  assertNotProd(SUPABASE_URL);

  _adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _adminClient;
}

/** Generates a throwaway e2e email that is unique per test run. */
export function makeE2eEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `e2e_${ts}_${rand}@example.com`;
}

/** Creates a confirmed e2e user and returns their id + email. */
export async function createE2eUser(
  email = makeE2eEmail(),
  password = 'E2eTestPass123!',
): Promise<{ id: string; email: string; password: string }> {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,  // skip email verification
  });

  if (error || !data.user) {
    throw new Error(`[e2e/admin] Failed to create user "${email}": ${error?.message}`);
  }

  return { id: data.user.id, email, password };
}

/** Deletes a user by id. Safe to call in afterAll — swallows not-found errors. */
export async function deleteE2eUser(userId: string): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error && !error.message.includes('not found')) {
    console.warn(`[e2e/admin] Failed to delete user ${userId}: ${error.message}`);
  }
}
