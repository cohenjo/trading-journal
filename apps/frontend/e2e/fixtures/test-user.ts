/**
 * e2e/fixtures/test-user.ts
 *
 * Unified test-user fixture for authenticated E2E tests that require a provisioned household.
 *
 * Pattern:
 *   1. Creates a throwaway Supabase user via admin API.
 *   2. Signs in using the auth-cookie technique (direct REST password grant → cookie inject).
 *   3. Polls the `households` table until the auto-provision trigger fires (≤5s).
 *   4. Returns { page, userId, email, householdId } for use in the test body.
 *   5. Tears down the user (and cascaded household data) in afterAll.
 *
 * Usage:
 *   import { test } from '../fixtures/test-user';
 *
 *   test('my flow test @auth', async ({ testUser: { page, householdId } }) => {
 *     await page.goto('/current-finances');
 *     // ... householdId available for seeding
 *   });
 */

import { test as base, type Page } from '@playwright/test';
import { createE2eUser, makeE2eEmail, getAdminClient } from './admin';
import { teardownTestUser } from '../helpers/provision-test-user';

const PASSWORD = 'E2eTestPass!1';

export interface TestUserFixture {
  page: Page;
  userId: string;
  email: string;
  householdId: string;
}

/**
 * Obtains a Supabase session via direct REST password grant and injects
 * the resulting session cookie into the Playwright browser context.
 *
 * This matches the approach in auth-cookie.ts — direct REST avoids the
 * need for browser-side CDN imports and correctly sets the @supabase/ssr
 * cookie format the Next.js middleware reads.
 */
async function injectAuthCookie(
  page: Page,
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<string> {
  const resp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`[test-user] password grant failed: ${resp.status} ${body}`);
  }

  const session = await resp.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at?: number;
    token_type: string;
    user: unknown;
  };

  if (!session.expires_at) {
    session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
  }

  // Build the cookie @supabase/ssr expects:
  //   sb-{ref}-auth-token = "base64-" + base64url(JSON.stringify(session))
  const ref = supabaseUrl.replace('https://', '').split('.')[0];
  const cookieName = `sb-${ref}-auth-token`;
  const cookieValue =
    'base64-' +
    Buffer.from(JSON.stringify(session), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  await page.context().addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
      expires: session.expires_at,
    },
  ]);

  return session.access_token;
}

/**
 * Polls `public.households` via the admin client until a row owned by
 * `userId` appears (the auto-provision trigger fires asynchronously).
 *
 * Returns the householdId or throws after `timeoutMs` (default 5 000 ms).
 */
async function waitForHousehold(userId: string, timeoutMs = 5_000): Promise<string> {
  const admin = getAdminClient();
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL = 300;

  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      // Log but don't throw — the row may not exist yet
      console.warn(`[test-user] household poll error: ${error.message}`);
    } else if (data?.household_id) {
      return data.household_id as string;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error(
    `[test-user] household not provisioned for user ${userId} within ${timeoutMs}ms. ` +
    `Check the auto-provision trigger (migration 20260502120000).`,
  );
}

export const test = base.extend<{ testUser: TestUserFixture }>({
  testUser: async ({ page }, use) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      throw new Error(
        '[test-user] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
      );
    }

    const email = makeE2eEmail();
    const { id: userId } = await createE2eUser(email, PASSWORD);

    // Inject session cookie so Next.js SSR middleware sees the session
    await injectAuthCookie(page, supabaseUrl, anonKey, email, PASSWORD);

    // Wait for the auto-provision trigger to create the household
    const householdId = await waitForHousehold(userId);

    await use({ page, userId, email, householdId });

    // Teardown — explicitly cleans household data then deletes auth user.
    // NOTE: there is no ON DELETE CASCADE from auth.users → household_members,
    // so teardownTestUser() handles cleanup in the correct FK order.
    await teardownTestUser(userId).catch((err: Error) =>
      console.warn(`[test-user] teardown warning: ${err.message}`),
    );
  },
});

export { expect } from '@playwright/test';
