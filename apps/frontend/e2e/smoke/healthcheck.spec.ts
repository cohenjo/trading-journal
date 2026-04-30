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

  test('Supabase Auth health endpoint responds 200', async ({ request }) => {
    const healthUrl = `${SUPABASE_URL}/auth/v1/health`;
    const response = await request.get(healthUrl, { timeout: 10_000 });

    expect(response.status(), `Supabase Auth health at ${healthUrl} should return 200`).toBe(200);

    const body = await response.text();
    // The health response typically includes {"status":"pass"} or similar
    expect(body.length).toBeGreaterThan(0);
  });

  test('Supabase REST endpoint responds (not 5xx)', async ({ request }) => {
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

  test('app /health/auth route responds (if exists)', async ({ page }) => {
    // Hockney's health route from PR #89 — skip gracefully if not yet deployed
    const response = await page.goto('/health/auth', { waitUntil: 'commit' });
    const status = response?.status() ?? 0;

    if (status === 404) {
      test.skip(true, '/health/auth not yet deployed — skipping');
      return;
    }

    expect(status, '/health/auth should return 2xx').toBeLessThan(300);

    const body = await page.content();
    expect(body).toContain('supabase');
  });
});
