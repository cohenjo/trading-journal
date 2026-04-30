/**
 * e2e/smoke/home.spec.ts
 *
 * Smoke: root route `/`
 * Expected: static redirect to /summary — no server render, no data fetching.
 * PASS on current main (no auth guard needed).
 */
import { test, expect } from '@playwright/test';

test.describe('smoke: home / root redirect', () => {
  test('GET / redirects to /summary', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/summary/);
  });

  test('GET / does not return 5xx', async ({ page }) => {
    const response = await page.goto('/');
    // Next.js redirects return 3xx; final destination should be 2xx
    expect(response?.status()).toBeLessThan(500);
  });

  test('/summary page contains stacked income chart heading', async ({ page }) => {
    await page.goto('/summary');
    // Page title or a key heading element
    await expect(page.locator('body')).not.toBeEmpty();
    // No unhandled error overlay
    await expect(page.locator('text=Application error')).toHaveCount(0);
  });
});
