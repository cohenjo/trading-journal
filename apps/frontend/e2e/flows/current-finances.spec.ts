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
import { test as testWithUser } from '../fixtures/test-user';
import { cleanupHouseholdData } from '../fixtures/seed-data';

test.describe('P0 flow: /current-finances (authenticated)', () => {
  test('/current-finances loads without 5xx @flow', async ({ authenticatedUser: { page } }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
    });

    await page.goto('/current-finances');
    await page.waitForLoadState('domcontentloaded');

    expect(serverErrors).toHaveLength(0);
  });

  test('/current-finances renders the finance editor heading @flow', async ({
    authenticatedUser: { page },
  }) => {
    await page.goto('/current-finances');
    // Page heading — tighten selector once exact copy is confirmed
    await expect(
      page.locator('h1, h2').filter({ hasText: /finance|net worth|current/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  // test.fixme: chart requires backend data from FastAPI /api/finances/latest.
  // Without a running backend the page renders in an empty/error state with no chart canvas.
  // Filed: https://github.com/cohenjo/trading-journal/issues/155
  test.fixme(
    '/current-finances renders at least one donut chart or chart container @flow',
    async ({ authenticatedUser: { page } }) => {
      await page.goto('/current-finances');
      // 4 donut charts expected; accept any chart canvas/wrapper as proof of render
      await expect(
        page.locator('canvas, [class*="chart"], [class*="Chart"], [class*="donut"]').first()
      ).toBeVisible({ timeout: 15_000 });
    }
  );

  test('/current-finances has no console errors on load @flow', async ({
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
        !m.includes('404') &&
        // Backend 500s (FastAPI not running locally) are infrastructure, not FE bugs
        !m.includes('500') &&
        !m.includes('Internal Server Error')
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

// ── Regression: fund-save with active household (Jony's bug) ─────────────────
//
// Regression guard for the bug where saving a fund on /current-finances failed
// silently when the user had an active household (finance_snapshots write was
// rejected by RLS because the JWT wasn't forwarded to FastAPI).
//
// Status: skip until Fenster's auth-guard PR + Hockney's ensure_household RPC
//         are deployed and the FastAPI backend accepts household-scoped JWTs.
// Tracking: https://github.com/cohenjo/trading-journal/issues/155

testWithUser.describe('regression: fund save with household @auth', () => {
  // test.skip: depends on FastAPI backend accepting JWT + household scope.
  // Unblock when:
  //   1. Fenster's auth-guard PR is merged (JWT forwarded to FastAPI)
  //   2. Hockney's ensure_household RPC ships (household row guaranteed present)
  //   3. FastAPI /api/finances/save accepts and persists household-scoped writes
  testWithUser.skip(
    'adding a fund saves successfully when a household is present @auth',
    async ({ testUser: { page, householdId } }) => {
      // Postcondition cleanup — remove seeded snapshot data after this test
      testWithUser.afterAll(async () => {
        await cleanupHouseholdData(householdId).catch((err: Error) =>
          console.warn(`[current-finances] cleanup warning: ${err.message}`),
        );
      });

      await page.goto('/current-finances');
      await page.waitForLoadState('domcontentloaded');

      // Locate the "Add fund" / "Add item" button (exact selector TBD once Fenster's
      // auth-guard PR ships and the component renders in an authenticated context)
      const addFundBtn = page
        .getByRole('button', { name: /add fund|add item|new fund/i })
        .first();
      await expect(addFundBtn).toBeVisible({ timeout: 10_000 });
      await addFundBtn.click();

      // Fill in the minimal required fields
      await page.getByLabel(/name|fund name/i).fill('E2E Regression Fund');
      await page.getByLabel(/value|amount|balance/i).fill('50000');

      // Submit the form
      const saveBtn = page.getByRole('button', { name: /save|confirm|add/i }).last();
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();

      // The new fund must appear in the finance items list — no error toast
      const fundEntry = page.getByText('E2E Regression Fund');
      await expect(fundEntry).toBeVisible({ timeout: 10_000 });

      // Assert no error toast / alert appeared
      const errorToast = page.locator('[role="alert"]').filter({ hasText: /error|failed|could not/i });
      await expect(errorToast).not.toBeVisible({ timeout: 3_000 });
    },
  );
});
