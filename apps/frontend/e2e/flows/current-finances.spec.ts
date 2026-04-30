/**
 * e2e/flows/current-finances.spec.ts
 *
 * P0 flow: /current-finances
 *
 * Live net worth snapshot editor — assets, savings, investments, liabilities.
 * This is P0 because financial data stored here drives the rest of the app
 * (plan simulation, cash-flow projection, after-I-leave guide).
 *
 * Critical UI elements (from Fenster's audit):
 *   - 4× donut charts (assets / savings / investments / liabilities)
 *   - Finance tabs editor (add / edit / delete items)
 *
 * Auth note:
 *   /current-finances currently has NO auth guard on `main`.  The FastAPI
 *   endpoint (/api/finances/latest) will respond without a JWT.  Once Fenster's
 *   auth-guard PR lands, this fixture will provide the JWT the endpoint needs
 *   to scope results per household.
 *
 * ⚠️  Depends on Fenster's auth-guard PR for full JWT-scoped behaviour.
 *    Data-seeding via admin client is skipped because the FastAPI endpoint is
 *    not accessible through Supabase service-role client — use test.fixme for
 *    the mutation path until the backend exposes a test seed endpoint.
 */
import { test, expect } from '../../e2e/fixtures/auth';

test.describe('P0 flow: /current-finances (authenticated)', () => {
  test('/current-finances loads without 5xx', async ({ authenticatedUser: { page } }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
    });

    await page.goto('/current-finances');
    await page.waitForLoadState('domcontentloaded');

    expect(serverErrors).toHaveLength(0);
  });

  test('/current-finances renders the finance editor heading', async ({
    authenticatedUser: { page },
  }) => {
    await page.goto('/current-finances');
    // Page heading — tighten selector once exact copy is confirmed
    await expect(
      page.locator('h1, h2').filter({ hasText: /finance|net worth|current/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('/current-finances renders at least one donut chart or chart container', async ({
    authenticatedUser: { page },
  }) => {
    await page.goto('/current-finances');
    // 4 donut charts expected; accept any chart canvas/wrapper as proof of render
    await expect(
      page.locator('canvas, [class*="chart"], [class*="Chart"], [class*="donut"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('/current-finances has no console errors on load', async ({
    authenticatedUser: { page },
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/current-finances');
    await page.waitForLoadState('networkidle');

    const critical = consoleErrors.filter(
      (m) =>
        !m.includes('Warning:') &&
        !m.includes('supabase') &&
        !m.includes('React does not recognize') &&
        // API 404 in dev (no seed data) is non-critical during scaffold phase
        !m.includes('404')
    );
    expect(critical).toHaveLength(0);
  });

  // TODO: happy-path mutation — add a finance item and verify it appears in the table
  // Skipped until backend JWT forwarding (Fenster PR) + test seed data are available.
  test.fixme('add a finance item and verify it persists', async ({ authenticatedUser: { page } }) => {
    await page.goto('/current-finances');
    // 1. Click "Add item" or equivalent button
    // 2. Fill in name, amount, category
    // 3. Submit
    // 4. Verify the new item appears in the editor
    // NOTE: requires FastAPI to accept JWT from Supabase and scope the write correctly
  });
});
