/**
 * Smoke: /settings page behaviour for unauthenticated visitors.
 *
 * /settings is auth-gated. Without a session, the app should either:
 *   a) redirect to a login page, OR
 *   b) show a 401/403 status, OR
 *   c) redirect back to / or /summary
 *
 * This test is intentionally permissive — it does NOT assert WHERE the redirect
 * goes, only that unauthenticated access to /settings does not result in:
 *   - A visible settings UI being served (data leak)
 *   - A 5xx error
 *   - Unhandled JS console errors
 */

import { test, expect } from '@playwright/test';

test.describe('smoke / settings (unauthenticated)', () => {
  test('GET /settings does not serve protected UI without auth @smoke', async ({ page }) => {
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

    const response = await page.goto('/settings');
    const finalUrl = page.url();
    const status = response?.status() ?? 0;

    // Must not 5xx
    expect(serverErrors, `5xx on /settings: ${serverErrors.join(', ')}`).toHaveLength(0);
    expect(status, 'Unexpected 5xx status').toBeLessThan(500);

    // Either redirected away from /settings OR shows a login/error state
    // Accept: redirect (URL changed) OR 401/403 OR the URL still /settings but no sensitive data
    const wasRedirected = !finalUrl.includes('/settings');
    const isAuthError = status === 401 || status === 403;

    // At minimum: no 5xx and body renders
    await expect(page.locator('body')).not.toBeEmpty();

    if (!wasRedirected && !isAuthError) {
      // If we're still on /settings, verify no user-specific financial data leaked
      // (no account numbers, balances, or portfolio data visible)
      const bodyText = await page.locator('body').textContent() ?? '';
      // The settings page without auth should not show private data
      // This is a heuristic — expand assertions once auth is fully wired
      expect(bodyText).not.toMatch(/₪[\d,]+|account.*\d{4}/i);
    }

    // No unhandled JS errors
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('chrome-extension'),
    );
    expect(criticalErrors, `Console errors on /settings: ${criticalErrors.join('\n')}`).toHaveLength(0);
  });

  test('GET /settings page renders some DOM content (not blank) @smoke', async ({ page }) => {
    await page.goto('/settings');
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
    // At minimum some HTML structure should be present
    const html = await page.content();
    expect(html.length).toBeGreaterThan(100);
  });
});
