/**
 * e2e/flows/plan-income-streams.spec.ts
 *
 * A6: 3 income streams from /summary appear as automatic income lines on /plan
 *
 * Tags: @plan-persistence @income-streams @regression
 *
 * Status: test.fixme — pending Fenster P1 income-stream wiring (PR-C).
 * Unfixme this file after PR-C lands and the income-stream → plan contract
 * is resolved per Keaton's architecture synthesis (issue #441 / Decision 1).
 *
 * See: .squad/decisions/inbox/mcmanus-plan-cashflow-tests.md — Risk Area 1
 * See: issue #441
 */

import { test as testWithUser, expect } from '../fixtures/test-user';
import { getAdminClient } from '../fixtures/admin';
import { cleanupPlanData } from '../fixtures/plan-fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// A6 — 3 income streams from /summary appear on /plan
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('A6: 3 income streams appear on /plan @plan-persistence @income-streams', () => {
  let householdIdForCleanup: string;

  testWithUser.afterAll(async () => {
    if (householdIdForCleanup) {
      await cleanupPlanData(householdIdForCleanup).catch((err: Error) =>
        console.warn(`[plan-income-streams] A6 cleanup: ${err.message}`),
      );

      // Also clean up seeded income-stream rows
      const admin = getAdminClient();
      await admin
        .from('options_dashboard_monthly')
        .delete()
        .eq('household_id', householdIdForCleanup)
        .like('note', 'e2e-%')
        .catch(() => { /* ignore if column does not exist */ });
    }
  });

  // TODO: Unfixme after PR-C (Fenster P1 income-stream wiring) lands.
  // The income-stream → plan contract must be resolved first:
  //   Decision 1 from Keaton's synthesis will specify whether income streams
  //   are (a) pulled live on render, (b) copied into plan.data.items, or
  //   (c) referenced by type. Until then, the test scenario cannot be
  //   implementation-agnostic.
  // Reference: issue #441, .squad/decisions/inbox/mcmanus-plan-cashflow-tests.md
  testWithUser(
    'A6: bonds/dividends/options appear as income lines on /plan and survive reload @plan-persistence @income-streams',
    async ({ testUser: { page, householdId } }) => {
      householdIdForCleanup = householdId;
      const admin = getAdminClient();

      // Seed options dashboard row (~15 000 USD/year)
      await admin.from('options_dashboard_monthly').insert({
        household_id: householdId,
        year: new Date().getFullYear(),
        month: 6,
        cash_flow_total: 15_000,
        currency: 'USD',
      });

      // Seed dividend positions (~26 000 USD/year)
      await admin.from('dividend_positions').insert({
        household_id: householdId,
        ticker: 'E2E-DIV',
        annual_income: 26_000,
        currency: 'USD',
      });

      // Seed bond holdings coupon (~80 000 ILS/year)
      await admin.from('bond_holdings').insert({
        household_id: householdId,
        isin: 'E2E-BOND-001',
        coupon_annual: 80_000,
        currency: 'ILS',
      });

      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      // Assert income stream lines are visible (auto-injected or in a dedicated section)
      const optionsLine = page
        .getByText(/options/i)
        .or(page.locator('[data-type="options"]'))
        .first();
      const dividendsLine = page
        .getByText(/dividend/i)
        .or(page.locator('[data-type="dividends"]'))
        .first();
      const bondsLine = page
        .getByText(/bond/i)
        .or(page.locator('[data-type="bonds"]'))
        .first();

      await expect(optionsLine).toBeVisible({ timeout: 10_000 });
      await expect(dividendsLine).toBeVisible({ timeout: 10_000 });
      await expect(bondsLine).toBeVisible({ timeout: 10_000 });

      // Assert amounts are in correct order of magnitude
      // Bonds should be ~80 000 ILS, not 8 000 000 ILS (guards against ILA ÷100 error)
      const bondsRow = page.locator('[data-testid="plan-item"], li, tr').filter({ hasText: /bond/i }).first();
      const bondsText = await bondsRow.textContent();
      expect(
        bondsText,
        'Bond amount should be ~80 000 ILS (not 8 000 000 — ILA÷100 guard)',
      ).toMatch(/80[\s,.]?0{3}/);

      // Reload — income stream lines must survive (pulled live, not one-shot)
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(optionsLine).toBeVisible({ timeout: 10_000 });
      await expect(dividendsLine).toBeVisible({ timeout: 10_000 });
      await expect(bondsLine).toBeVisible({ timeout: 10_000 });
    },
  );
});
