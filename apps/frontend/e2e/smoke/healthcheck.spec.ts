/**
 * Smoke: dev Supabase health check.
 *
 * Verifies the configured Supabase project is reachable and Auth is healthy.
 * Uses the standard Supabase Auth health endpoint:
 *   GET <SUPABASE_URL>/auth/v1/health
 *
 * If the app ships a /health/auth route (PR #89 by Hockney), that is tested too.
 *
 * This test does NOT require a browser — it uses Playwright's `request` context.
 */

import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

test.describe('smoke / supabase health', () => {
  test.skip(!SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL is not set — skipping Supabase health check');

  test('Supabase Auth health endpoint responds 200 @smoke', async ({ request }) => {
    const healthUrl = `${SUPABASE_URL}/auth/v1/health`;
    // The GoTrue /auth/v1/health endpoint requires an apikey header in Supabase v2
    const response = await request.get(healthUrl, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      },
      timeout: 10_000,
    });

    expect(response.status(), `Supabase Auth health at ${healthUrl} should return 200`).toBe(200);

    const body = await response.text();
    // The health response includes {"version":"...","name":"GoTrue","description":"..."}
    expect(body.length).toBeGreaterThan(0);
  });

  test('Supabase REST endpoint responds (not 5xx) @smoke', async ({ request }) => {
    // A GET to the PostgREST root returns a schema description — no auth needed
    const restUrl = `${SUPABASE_URL}/rest/v1/`;
    const response = await request.get(restUrl, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      },
      timeout: 10_000,
    });

    expect(response.status(), `Supabase REST at ${restUrl} should not 5xx`).toBeLessThan(500);
  });

  test('app /health/auth route responds (if exists) @smoke', async ({ page }) => {
    // Hockney's health route from PR #89 — skip gracefully if not yet deployed,
    // requires auth, or is redirected to login (middleware catches unknown routes)
    const response = await page.goto('/health/auth', { waitUntil: 'commit' });
    const status = response?.status() ?? 0;
    const finalUrl = page.url();

    // Skip if not deployed (404), requires auth (401/403), or redirected to login
    const redirectedToLogin = finalUrl.includes('/login');
    if (status === 404 || status === 401 || status === 403 || redirectedToLogin) {
      test.skip(true, `/health/auth not available (status=${status}, url=${finalUrl}); skipping`);
      return;
    }

    expect(status, '/health/auth should return 2xx').toBeLessThan(300);

    const body = await page.content();
    expect(body).toContain('supabase');
  });
});
