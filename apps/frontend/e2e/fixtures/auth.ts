/**
 * Playwright fixtures for authenticated E2E tests.
 *
 * Provides:
 *   authenticatedUser  — throwaway Supabase user, signed in, page with live session
 *   householdOwner     — authenticated user + a household row seeded via admin API
 *
 * Usage:
 *   import { test } from '../fixtures/auth';
 *   test('holdings page', async ({ authenticatedUser: { page } }) => { ... });
 *
 * Auth strategy: direct REST password grant → cookie inject.
 * This sets the sb-{ref}-auth-token cookie in the correct @supabase/ssr format
 * so the Next.js SSR middleware sees the session on the first request.
 * (The previous ESM CDN approach used a custom storageKey that the middleware
 *  couldn't read, leaving users seemingly logged out on protected routes.)
 */

import { test as base, type Page } from '@playwright/test';
import { createE2eUser } from './admin';
import { teardownTestUser } from '../helpers/provision-test-user';

export interface AuthUserFixture {
  page: Page;
  userId: string;
  email: string;
  password: string;
}

export interface HouseholdOwnerFixture extends AuthUserFixture {
  householdId: string;
}

/**
 * Obtains a Supabase session via direct REST password grant and injects
 * the resulting session cookie into the Playwright browser context.
 *
 * The cookie name format is `sb-{ref}-auth-token` which is what
 * `@supabase/ssr` createServerClient reads via `request.cookies.getAll()`.
 */
async function injectAuthCookie(
  page: Page,
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<void> {
  const resp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`[e2e/auth] password grant failed: ${resp.status} ${body}`);
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
}

export const test = base.extend<{
  authenticatedUser: AuthUserFixture;
  householdOwner: HouseholdOwnerFixture;
}>({
  authenticatedUser: async ({ page }, use) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    if (!supabaseUrl || !anonKey) {
      throw new Error(
        '[e2e/auth] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
      );
    }

    const { id, email, password } = await createE2eUser();

    await injectAuthCookie(page, supabaseUrl, anonKey, email, password);

    await use({ page, userId: id, email, password });

    // Teardown: use full cascade teardown to handle FK constraints
    await teardownTestUser(id).catch((err: Error) =>
      console.warn(`[e2e/auth] teardown warning: ${err.message}`),
    );
  },

  householdOwner: async ({ page }, use) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    if (!supabaseUrl || !anonKey) {
      throw new Error(
        '[e2e/auth] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
      );
    }

    const { id, email, password } = await createE2eUser();

    await injectAuthCookie(page, supabaseUrl, anonKey, email, password);

    // TODO (round 2): seed a household row via admin Supabase client
    // and return householdId. For now placeholder value.
    const householdId = 'pending-round-2';

    await use({ page, userId: id, email, password, householdId });

    await teardownTestUser(id).catch((err: Error) =>
      console.warn(`[e2e/auth] teardown warning: ${err.message}`),
    );
  },
});

export { expect } from '@playwright/test';
