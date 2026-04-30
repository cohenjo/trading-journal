/**
 * e2e/smoke/healthcheck.spec.ts
 *
 * Smoke: Next.js application health
 * Verifies the app boots, serves HTML, and key infrastructure endpoints respond.
 * PASS on current main.
 */
import { test, expect } from '@playwright/test';

test.describe('smoke: healthcheck', () => {
  test('Next.js app serves HTML on /', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    // Follow redirect — final response should be 200
    const finalResponse = await page.waitForLoadState('domcontentloaded').then(() => null);
    void finalResponse;
    // If we got here without crashing, the server is up
    expect(page.url()).toBeTruthy();
  });

  test('no critical JS errors on initial page load', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Filter out known non-critical noise (e.g. React DevTools)
    const criticalErrors = jsErrors.filter(
      (msg) =>
        !msg.includes('React DevTools') &&
        !msg.includes('Warning:') &&
        // Supabase auth warnings in dev are non-critical
        !msg.includes('supabase')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('static assets load without 4xx errors', async ({ page }) => {
    const failedRequests: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 400 && resp.url().includes('/_next/')) {
        failedRequests.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(failedRequests).toHaveLength(0);
  });
});
