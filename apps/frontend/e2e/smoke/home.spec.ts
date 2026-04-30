/**
 * Smoke: home page renders without errors.
 *
 * `/` redirects to `/summary` per Next.js root page.tsx.
 * Tests verify:
 *   - No 5xx responses on any network request
 *   - No console errors
 *   - Page has a <body> with visible content
 */

import { test, expect } from '@playwright/test';

test.describe('smoke / home', () => {
  test('GET / resolves (redirect to /summary) without 5xx or console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    page.on('response', (response) => {
      if (response.status() >= 500) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    const response = await page.goto('/');

    // The root redirects to /summary — final response should be 2xx
    expect(response?.status(), 'Expected 2xx after redirect').toBeLessThan(400);

    // Should have landed on /summary (or at minimum not on an error page)
    expect(page.url()).not.toContain('error');

    // No 5xx from any resource
    expect(failedRequests, `5xx responses: ${failedRequests.join(', ')}`).toHaveLength(0);

    // No JS console errors (allow known third-party noise by filtering)
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('chrome-extension'),
    );
    expect(criticalErrors, `Console errors: ${criticalErrors.join('\n')}`).toHaveLength(0);

    // Body exists and is not empty
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('page title is present', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title.length, 'Page should have a non-empty title').toBeGreaterThan(0);
  });
});
