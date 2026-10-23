/**
 * Smoke: /holdings page behaviour for unauthenticated visitors.
 *
 * /holdings is auth-gated; anonymous visitors must reach the sign-in screen.
 */

import { test, expect } from '@playwright/test';

test.describe('smoke / holdings (unauthenticated)', () => {
  test('GET /holdings does not serve portfolio data without auth @smoke', async ({ page }) => {
    const consoleErrors: string[] = [];
    const serverErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    page.on('response', (response) => {
      if (response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    const response = await page.goto('/holdings');
    const status = response?.status() ?? 0;

    // Must not 5xx
    expect(serverErrors, `5xx on /holdings: ${serverErrors.join(', ')}`).toHaveLength(0);
    expect(status).toBe(200);
    await expect(page).toHaveURL(/\/signin\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/holdings');
    await expect(page.getByRole('heading', { name: 'Trading Journal' })).toBeVisible();

    // Body should render (not blank/crashed)
    await expect(page.locator('body')).not.toBeEmpty();

    // No unhandled console errors
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('chrome-extension'),
    );
    expect(criticalErrors, `Console errors: ${criticalErrors.join('\n')}`).toHaveLength(0);
  });

});
