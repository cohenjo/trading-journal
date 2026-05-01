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

export const test = base.extend<AuthCookieFixtures>({
  authenticatedUser: async ({ page }, use) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
    }

    const email = makeE2eEmail();
    const { id: userId } = await createE2eUser(email, PASSWORD);

    // 1. Get tokens via direct REST call (no cookie storage in Node).
    const session = await passwordGrant(supabaseUrl, anonKey, email, PASSWORD);
    if (!session.expires_at) {
      session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
    }

    // 2. Build the cookie @supabase/ssr expects.
    const ref = projectRefFromUrl(supabaseUrl);
    const cookieName = `sb-${ref}-auth-token`;
    const cookieValue = 'base64-' + base64UrlEncode(JSON.stringify(session));

    // 3. Inject the cookie before any navigation. Use port-explicit URL so
    //    Playwright sets the cookie on localhost:3000.
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

    await use({ page, email, userId, accessToken: session.access_token });

    await deleteE2eUser(userId).catch(() => {
      /* best-effort */
    });
  },
});

export { expect };
