/**
 * Smoke: /settings page behaviour for unauthenticated visitors.
 *
 * /settings is auth-gated; anonymous visitors must reach the sign-in screen.
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
    const status = response?.status() ?? 0;

    // Must not 5xx
    expect(serverErrors, `5xx on /settings: ${serverErrors.join(', ')}`).toHaveLength(0);
    expect(status).toBe(200);
    await expect(page).toHaveURL(/\/signin\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/settings');
    await expect(page.getByRole('heading', { name: 'Trading Journal' })).toBeVisible();

    // At minimum: no 5xx and body renders
    await expect(page.locator('body')).not.toBeEmpty();

    // No unhandled JS errors
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('chrome-extension'),
    );
    expect(criticalErrors, `Console errors on /settings: ${criticalErrors.join('\n')}`).toHaveLength(0);
  });

});
