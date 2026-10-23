/**
 * Smoke: home page renders without errors.
 *
 * Anonymous `/` requests must reach `/signin?next=/`.
 * Tests verify:
 *   - No 5xx responses on any network request
 *   - No console errors
 *   - Page has a <body> with visible content
 */

import { test, expect } from '@playwright/test';

test.describe('smoke / home', () => {
  test('GET / requires sign-in without 5xx or console errors @smoke', async ({ page }) => {
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

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/signin\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/');
    await expect(page.getByRole('heading', { name: 'Trading Journal' })).toBeVisible();
    expect(await page.title()).not.toBe('');

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

});
