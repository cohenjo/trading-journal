/**
 * e2e/flows/current-finances.spec.ts
 *
 * P0 flow: /current-finances  @flow
 *
 * Live net worth snapshot editor — assets, savings, investments, liabilities.
 * This is P0 because financial data stored here drives the rest of the app
 * (plan simulation, cash-flow projection, after-I-leave guide).
 *
 * Critical UI elements:
 *   - 4× donut charts (assets / savings / investments / liabilities)
 *   - Finance tabs editor (add / edit / delete items)
 *
 * Regression coverage:
 *   PR #168 — onConflict fix: upsert now uses composite key (household_id,date)
 *   rather than date alone, which was causing PostgREST 42P10 errors when a
 *   household was already provisioned.
 *
 * Auth strategy: testUser fixture (throwaway user + auto-provisioned household).
 * The save path uses Next.js Server Actions → Supabase; no FastAPI dependency.
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

// ── Regression #168: fund-save with active household ─────────────────────────
//
// Regression guard for the bug where saving on /current-finances failed with
// "Failed to save snapshot. Please try again." when the user had an active
// household.  Root cause: `onConflict: 'date'` did not match the composite PK
// (household_id, date) on finance_snapshots, causing a PostgREST 42P10 error.
// Fixed in PR #168 — onConflict now uses 'household_id,date'.
//
// The save path goes through the Next.js server action (saveFinanceSnapshot in
// actions.ts), which calls Supabase directly — no FastAPI dependency.
//
// Unit-level regression is covered by actions.test.ts
// ("regression: upsert uses onConflict household_id,date — not date alone").
//
// This E2E covers the full browser → server action → Supabase round-trip.

testWithUser.describe('regression #168: fund save with household @flow', () => {
  testWithUser(
    'adding an asset saves successfully and persists after page reload @flow',
    async ({ testUser: { page, householdId } }) => {
      // Postcondition cleanup — remove seeded snapshot data after this test
      testWithUser.afterAll(async () => {
        await cleanupHouseholdData(householdId).catch((err: Error) =>
          console.warn(`[current-finances] cleanup warning: ${err.message}`),
        );
      });

      await page.goto('/current-finances');
      await page.waitForLoadState('domcontentloaded');

      // Wait for the page to finish loading (past the "Loading finances..." state)
      await expect(
        page.locator('h1').filter({ hasText: /Current Finances/i })
      ).toBeVisible({ timeout: 10_000 });

      // --- Step 1: click the "Assets" tab (default active tab) ---
      // The tab may already be active; ensure we're on it.
      const assetsTab = page.getByRole('button', { name: /^assets/i });
      if (await assetsTab.isVisible()) {
        await assetsTab.click();
      }

      // --- Step 2: click "Add Asset" (empty-state button or quick-add below list) ---
      const addBtn = page
        .getByRole('button', { name: /add asset/i })
        .first();
      await expect(addBtn).toBeVisible({ timeout: 5_000 });
      await addBtn.click();

      // --- Step 3: select type (first card in the type-selection grid) ---
      // The PlanModal first shows a type-selection screen. Pick "House" or the first card.
      const typeCard = page.locator('button').filter({ hasText: /^(House|Custom Asset)/i }).first();
      await expect(typeCard).toBeVisible({ timeout: 5_000 });
      await typeCard.click();

      // --- Step 4: fill in the Name field ---
      const nameInput = page.locator('input[type="text"]').first();
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await nameInput.clear();
      await nameInput.fill('E2E Regression Asset');

      // --- Step 5: fill in the Current Value field ---
      const valueInput = page.locator('input[type="number"]').first();
      await expect(valueInput).toBeVisible();
      await valueInput.clear();
      await valueInput.fill('123456');

      // --- Step 6: click "Add Item" to save ---
      const addItemBtn = page.getByRole('button', { name: /add item/i });
      await expect(addItemBtn).toBeVisible();
      await addItemBtn.click();

      // --- Step 7: assert no error toast (regression: PR #168) ---
      // The onConflict fix means the server action should succeed silently.
      await page.waitForTimeout(1_500); // allow server action to settle
      const errorAlert = page
        .locator('[role="alert"]')
        .filter({ hasText: /Failed to save snapshot/i });
      await expect(errorAlert).not.toBeVisible({ timeout: 3_000 });

      // --- Step 8: the new item should appear in the list ---
      await expect(
        page.getByText('E2E Regression Asset')
      ).toBeVisible({ timeout: 10_000 });

      // --- Step 9: reload and verify DB persistence ---
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2_000);
      await expect(
        page.getByText('E2E Regression Asset')
      ).toBeVisible({ timeout: 10_000 });
    },
  );
});
