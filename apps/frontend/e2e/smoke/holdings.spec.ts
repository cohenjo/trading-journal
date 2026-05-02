/**
 * Smoke: /holdings page behaviour for unauthenticated visitors.
 *
 * /holdings is auth-gated. Without a session, the app should redirect away
 * or show an appropriate non-data response. Like /settings, this test
 * verifies the gate exists without asserting the specific mechanism.
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
    const finalUrl = page.url();
    const status = response?.status() ?? 0;

    // Must not 5xx
    expect(serverErrors, `5xx on /holdings: ${serverErrors.join(', ')}`).toHaveLength(0);
    expect(status).toBeLessThan(500);

    // Body should render (not blank/crashed)
    await expect(page.locator('body')).not.toBeEmpty();

    const wasRedirected = !finalUrl.includes('/holdings');
    const isAuthError = status === 401 || status === 403;

    if (!wasRedirected && !isAuthError) {
      // If /holdings rendered without redirect, assert no real financial data is shown
      // Without auth, there should be no holdings rows / portfolio values
      const bodyText = await page.locator('body').textContent() ?? '';
      // No holdings table rows with ticker symbols or monetary values
      expect(bodyText).not.toMatch(/AAPL|MSFT|TSLA|₪[\d,]+\.\d{2}/);
    }

    // No unhandled console errors
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('chrome-extension'),
    );
    expect(criticalErrors, `Console errors: ${criticalErrors.join('\n')}`).toHaveLength(0);
  });

  test('GET /holdings renders some DOM (not blank page) @smoke', async ({ page }) => {
    await page.goto('/holdings');
    await expect(page.locator('body')).not.toBeEmpty();
    const html = await page.content();
    expect(html.length).toBeGreaterThan(100);
  });
});
