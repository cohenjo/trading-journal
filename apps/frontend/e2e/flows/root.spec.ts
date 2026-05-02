/**
 * e2e/flows/root.spec.ts
 *
 * P0 flow: `/` → /summary
 *
 * Authenticated user hits the root and lands on /summary with the stacked
 * income chart rendered.  This is the entry-point page — if it breaks, the
 * entire app is broken from the user's perspective.
 *
 * Critical UI elements (from Fenster's audit):
 *   - Stacked income chart
 *   - Legend
 *
 * ⚠️  Depends on Fenster's auth-guard PR for the auth fixture to work end-to-end.
 *    Until that PR lands, createE2eUser will work but the sign-in cookie may not
 *    gate /summary properly.  Mark the auth-dependent assertion as fixme if needed.
 */
import { test, expect } from '../../e2e/fixtures/auth';

test.describe('P0 flow: / → /summary (authenticated)', () => {
  test('authenticated user lands on /summary after visiting / @flow', async ({
    authenticatedUser: { page },
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/summary/, { timeout: 10_000 });
  });

  test('/summary loads without 5xx errors @flow', async ({ authenticatedUser: { page } }) => {
    const failedRequests: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 500) failedRequests.push(`${resp.status()} ${resp.url()}`);
    });

    await page.goto('/summary');
    await page.waitForLoadState('domcontentloaded');

    expect(failedRequests).toHaveLength(0);
  });

  test('/summary renders the income chart container @flow', async ({
    authenticatedUser: { page },
  }) => {
    await page.goto('/summary');
    // The stacked income chart lives inside a card/container; at minimum a canvas or
    // chart wrapper element should be present.  Using a broad selector — tighten once
    // the chart renders reliably in E2E.
    await expect(page.locator('canvas, [class*="chart"], [class*="Chart"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('/summary has no console errors @flow', async ({ authenticatedUser: { page } }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/summary');
    await page.waitForLoadState('networkidle');

    // Filter Supabase/React noise
    const critical = consoleErrors.filter(
      (m) =>
        !m.includes('Warning:') &&
        !m.includes('supabase') &&
        !m.includes('React does not recognize')
    );
    expect(critical).toHaveLength(0);
  });
});
