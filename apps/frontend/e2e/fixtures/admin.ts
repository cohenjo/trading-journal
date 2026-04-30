/**
 * e2e/fixtures/admin.ts
 *
 * Service-role Supabase client for E2E user lifecycle management.
 * NEVER imported by app code — this file lives only in the test tier.
 *
 * Prod-guard: throws if the Supabase URL ref slug does not look like a dev/staging
 * environment, unless SUPABASE_E2E_ALLOW_PROD=true is set explicitly.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEV_HINTS = ['dev', 'stag', 'test', 'local', 'preview', 'sandbox'];

function assertNotProd(url: string): void {
  if (process.env.SUPABASE_E2E_ALLOW_PROD === 'true') return;
  const ref = url.replace('https://', '').split('.')[0].toLowerCase();
  const isSafeEnv = DEV_HINTS.some((hint) => ref.includes(hint));
  if (!isSafeEnv) {
    throw new Error(
      `[e2e/admin] Refusing to run against what looks like a production Supabase project (ref: ${ref}). ` +
        `Set SUPABASE_E2E_ALLOW_PROD=true to bypass — only do this if you are certain it is not production.`
    );
  }
}

let _client: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      '[e2e/admin] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.'
    );
  }

  assertNotProd(url);

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

export function makeE2eEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `e2e_${ts}_${rand}@example.com`;
}

export async function createE2eUser(
  email: string,
  password = 'E2eTestPass!1'
): Promise<{ id: string; email: string }> {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`[e2e/admin] createUser failed: ${error.message}`);
  return { id: data.user.id, email: data.user.email! };
}

export async function deleteE2eUser(userId: string): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`[e2e/admin] deleteUser failed: ${error.message}`);
}
