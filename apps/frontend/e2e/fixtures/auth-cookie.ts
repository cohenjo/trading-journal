/**
 * e2e/fixtures/auth-cookie.ts
 *
 * Working auth fixture that bridges Supabase sessions to Next.js middleware.
 *
 * The previous `auth.ts` fixture used a CDN-loaded supabase-js client inside
 * page.evaluate() to call signInWithPassword. That client uses the default
 * `localStorage` storage adapter, so although sign-in succeeded, NO cookies
 * were ever set on localhost:3000. The Next.js middleware (which gates every
 * protected route) reads from cookies, not localStorage — so every page
 * silently redirected to /login despite the test "passing".
 *
 * This fixture instead:
 *   1. Creates the test user via Supabase Admin API (service-role).
 *   2. Calls /auth/v1/token?grant_type=password directly to obtain access +
 *      refresh tokens.
 *   3. Constructs the cookie value @supabase/ssr expects:
 *         sb-{ref}-auth-token = "base64-" + base64url(JSON.stringify(session))
 *   4. Injects it via page.context().addCookies() on localhost:3000.
 *
 * Now Next.js middleware sees a valid session and lets protected routes
 * through.
 */
import { test as base, expect, Page } from '@playwright/test';
import { createE2eUser, deleteE2eUser, makeE2eEmail } from './admin';

export interface AuthCookieFixtures {
  authenticatedUser: { page: Page; email: string; userId: string; accessToken: string };
}

/** Worker-scoped session data (created once per Playwright worker, not per test). */
interface WorkerSession {
  email: string;
  userId: string;
  cookieName: string;
  cookieValue: string;
  cookieExpires: number;
  accessToken: string;
}

const PASSWORD = 'E2eTestPass!1';

function base64UrlEncode(input: string): string {
  // Same algorithm @supabase/ssr uses (utils.ts: stringToBase64URL)
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function passwordGrant(
  url: string,
  anonKey: string,
  email: string,
  password: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: unknown;
}> {
  const resp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`password grant failed: ${resp.status} ${body}`);
  }
  return resp.json();
}

function projectRefFromUrl(url: string): string {
  // https://abcdefgh.supabase.co -> abcdefgh
  return url.replace('https://', '').split('.')[0];
}

export const test = base.extend<AuthCookieFixtures, { _workerSession: WorkerSession }>({
  // ── Worker-scoped: create ONE user per Playwright worker ──────────────────
  // This dramatically reduces Supabase auth API calls (1 per worker instead of
  // 1 per test), which prevents hitting rate limits when running many tests.
  _workerSession: [
    async ({}, use) => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
      }

      const email = makeE2eEmail();
      const { id: userId } = await createE2eUser(email, PASSWORD);

      const session = await passwordGrant(supabaseUrl, anonKey, email, PASSWORD);
      if (!session.expires_at) {
        session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
      }

      const ref = projectRefFromUrl(supabaseUrl);
      const cookieName = `sb-${ref}-auth-token`;
      const cookieValue = 'base64-' + base64UrlEncode(JSON.stringify(session));

      await use({
        email,
        userId,
        cookieName,
        cookieValue,
        cookieExpires: session.expires_at,
        accessToken: session.access_token,
      });

      await deleteE2eUser(userId).catch(() => {
        /* best-effort */
      });
    },
    { scope: 'worker' },
  ],

  // ── Test-scoped: inject the shared cookie into a fresh page ───────────────
  authenticatedUser: async ({ page, _workerSession }, use) => {
    await page.context().addCookies([
      {
        name: _workerSession.cookieName,
        value: _workerSession.cookieValue,
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
        expires: _workerSession.cookieExpires,
      },
    ]);

    await use({
      page,
      email: _workerSession.email,
      userId: _workerSession.userId,
      accessToken: _workerSession.accessToken,
    });
  },
});

export { expect };
