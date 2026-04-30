/**
 * e2e/smoke/holdings.spec.ts
 *
 * Smoke: /holdings
 *
 * ⚠️  EXPECTED FAILURE on current main (no auth guard shipped yet).
 *
 * These tests assert that an unauthenticated visitor is redirected when
 * hitting /holdings.  On `main` today there is no auth guard — the page
 * renders with an inline error or empty state.
 *
 * Once Fenster's `squad/auth-guard-jwt-forwarding` PR lands, these tests
 * will start PASSING without any changes here.
 *
 * Baseline: FAIL (documented in e2e/BASELINE.md)
 */
import { test, expect } from '@playwright/test';

test.describe('smoke: /holdings — auth guard (expected FAIL pre-Fenster)', () => {
  test('unauthenticated GET /holdings redirects away from /holdings', async ({ page }) => {
    await page.goto('/holdings');
    // After auth guard lands, user should be redirected to login
    await expect(page).not.toHaveURL(/\/holdings/);
  });

  test('unauthenticated GET /holdings does not render holdings table', async ({ page }) => {
    await page.goto('/holdings');
    // Holdings table should not be visible to unauthenticated users post-auth-guard
    await expect(page.locator('table')).toHaveCount(0);
  });
});
