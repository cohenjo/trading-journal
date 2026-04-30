/**
 * e2e/smoke/settings.spec.ts
 *
 * Smoke: /settings
 *
 * ⚠️  EXPECTED FAILURE on current main (no auth guard shipped yet).
 *
 * These tests assert that an unauthenticated visitor is redirected to a
 * login/auth page when hitting /settings.  On `main` today there is no
 * auth guard, so the page renders with localStorage defaults — these
 * tests will FAIL.
 *
 * Once Fenster's `squad/auth-guard-jwt-forwarding` PR lands, the middleware
 * will redirect unauthenticated requests and these tests will start PASSING
 * without any changes here.
 *
 * Baseline: FAIL (documented in e2e/BASELINE.md)
 */
import { test, expect } from '@playwright/test';

test.describe('smoke: /settings — auth guard (expected FAIL pre-Fenster)', () => {
  test('unauthenticated GET /settings redirects away from /settings', async ({ page }) => {
    await page.goto('/settings');
    // After auth guard lands, user should land on a login/auth route
    await expect(page).not.toHaveURL(/\/settings/);
  });

  test('unauthenticated GET /settings does not render the planning mode toggle', async ({
    page,
  }) => {
    await page.goto('/settings');
    // The planning mode toggle is only visible for authenticated users post-auth-guard
    await expect(page.locator('[data-testid="planning-mode-toggle"]')).toHaveCount(0);
  });
});
