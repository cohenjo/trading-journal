/**
 * e2e/flows/plan.spec.ts
 *
 * P0 flow: /plan
 *
 * Long-range financial simulation with projection chart and milestone markers.
 * P0 because the simulation drives retirement and income planning — a broken
 * /plan page is immediately user-visible and blocks all planning workflows.
 *
 * Critical UI elements (from Fenster's audit):
 *   - Projection chart
 *   - Plan editor
 *   - Year details pane
 *
 * Auth note:
 *   /plan currently has NO auth guard on `main`.  `settings` are pulled from
 *   localStorage via SettingsContext and the plan is loaded from FastAPI
 *   `/api/plans/latest`.  In the post-Fenster world, the JWT will scope the
 *   plan to the authenticated household.
 *
 * ⚠️  Depends on Fenster's auth-guard PR for JWT-scoped simulation.
 *    Data seed is skipped (FastAPI not addressable via Supabase admin client).
 *    Mutation test (save plan) is fixme until backend accepts JWT.
 */
import { test, expect } from '../../e2e/fixtures/auth';

test.describe('P0 flow: /plan (authenticated)', () => {
  test('/plan loads without 5xx @flow', async ({ authenticatedUser: { page } }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
    });

    await page.goto('/plan');
    await page.waitForLoadState('domcontentloaded');

    expect(serverErrors).toHaveLength(0);
  });

  test('/plan renders the plan editor or loading state (not blank) @flow', async ({
    authenticatedUser: { page },
  }) => {
    await page.goto('/plan');
    // The page shows either "Loading plan..." or the actual plan editor.
    // Both are acceptable — we just want to confirm the page isn't blank/error.
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page.locator('text=Application error')).toHaveCount(0);
  });

  test('/plan renders projection chart or plan editor heading @flow', async ({
    authenticatedUser: { page },
  }) => {
    await page.goto('/plan');
    // Wait up to 15s for either the chart or the heading to appear
    await expect(
      page
        .locator('canvas, [class*="chart"], [class*="Chart"], h1, h2')
        .filter({ hasText: /plan|projection|simulation|financial/i })
        .or(page.locator('canvas, [class*="chart"], [class*="Chart"]'))
        .first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('/plan has no console errors on load @flow', async ({ authenticatedUser: { page } }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/plan');
    await page.waitForLoadState('networkidle');

    const critical = consoleErrors.filter(
      (m) =>
        !m.includes('Warning:') &&
        !m.includes('supabase') &&
        !m.includes('React does not recognize') &&
        !m.includes('404')
    );
    expect(critical).toHaveLength(0);
  });

  // TODO: happy-path mutation — update a plan parameter and trigger simulation
  // Skipped until backend JWT forwarding (Fenster PR) + seed data are confirmed.
  test.fixme('update plan target and run simulation', async ({ authenticatedUser: { page } }) => {
    await page.goto('/plan');
    // 1. Open the plan editor
    // 2. Update a target (e.g. retirement age)
    // 3. Click "Simulate" or "Save"
    // 4. Verify projection chart updates with new milestone
    // NOTE: requires /api/plans/simulate to accept a JWT-scoped payload
  });
});
