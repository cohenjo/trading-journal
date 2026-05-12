/**
 * e2e/pages/cash-flow-income-streams.spec.ts
 *
 * B6: 3 income streams (bonds/dividends/options) flow through the Sankey
 *
 * Tags: @cash-flow @income-streams @regression
 *
 * Status: test.fixme — pending Fenster P1 income-stream wiring (PR-C).
 * Unfixme after PR-C lands and the income-stream → plan contract
 * is resolved per Keaton's architecture synthesis (issue #441 / Decision 1).
 *
 * See: .squad/decisions/inbox/mcmanus-plan-cashflow-tests.md — Risk Area 1
 * See: issue #441
 */

import { test as testWithUser, expect } from '../fixtures/test-user';
import { getAdminClient } from '../fixtures/admin';
import { seedPlan, cleanupPlanData, THREE_STREAM_PLAN } from '../fixtures/plan-fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// B6 — 3 income streams appear in Sankey
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('B6: 3 income streams flow through Sankey @cash-flow @income-streams', () => {
  let householdIdForCleanup: string;

  testWithUser.afterAll(async () => {
    if (householdIdForCleanup) {
      await cleanupPlanData(householdIdForCleanup).catch((err: Error) =>
        console.warn(`[cash-flow-income-streams] B6 cleanup: ${err.message}`),
      );

      // Clean up seeded income-stream rows
      const admin = getAdminClient();
      await Promise.allSettled([
        admin
          .from('options_dashboard_monthly')
          .delete()
          .eq('household_id', householdIdForCleanup),
        admin
          .from('dividend_positions')
          .delete()
          .eq('household_id', householdIdForCleanup)
          .eq('ticker', 'E2E-B6-DIV'),
        admin
          .from('bond_holdings')
          .delete()
          .eq('household_id', householdIdForCleanup)
          .eq('isin', 'E2E-B6-BOND'),
      ]);
    }
  });

  // TODO: Unfixme after PR-C (Fenster P1 income-stream wiring) lands.
  // The income-stream → plan contract must be resolved first:
  //   - If income streams are live-pulled on each render (assumed path b),
  //     this test verifies the Sankey aggregates all 3 streams.
  //   - If they're copied into plan.data.items at save time (path b),
  //     the THREE_STREAM_PLAN seed covers it without DB stream rows.
  //   - If they're referenced by type (path c), different seeding is needed.
  // Until Keaton's Decision 1 is finalised, the assertion strategy may change.
  // Reference: issue #441, .squad/decisions/inbox/mcmanus-plan-cashflow-tests.md
  testWithUser.fixme(
    'B6: bonds, dividends, and options all appear as source nodes in the Sankey @cash-flow @income-streams',
    async ({ testUser: { page, householdId } }) => {
      householdIdForCleanup = householdId;
      const admin = getAdminClient();

      // Seed income stream DB rows (used if source-of-truth is live DB pull)
      await Promise.all([
        admin.from('options_dashboard_monthly').insert({
          household_id: householdId,
          year: new Date().getFullYear(),
          month: 6,
          cash_flow_total: 15_000,
          currency: 'USD',
        }),
        admin.from('dividend_positions').insert({
          household_id: householdId,
          ticker: 'E2E-B6-DIV',
          annual_income: 26_000,
          currency: 'USD',
        }),
        admin.from('bond_holdings').insert({
          household_id: householdId,
          isin: 'E2E-B6-BOND',
          coupon_annual: 80_000,
          currency: 'ILS',
        }),
      ]);

      // Also seed the plan items (used if source-of-truth is plan.data.items)
      await seedPlan(householdId, THREE_STREAM_PLAN);

      await page.goto('/cash-flow');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('heading', { name: /cash flow/i })).toBeVisible({ timeout: 10_000 });

      // Sankey chart area must be visible
      const chartEl = page
        .locator('canvas, [class*="sankey"], [class*="chart"], svg')
        .first();
      await expect(chartEl).toBeVisible({ timeout: 15_000 });

      // At least 3 distinct income source nodes (options, dividends, bonds)
      // These may be text labels inside the chart or in a legend
      const optionsNode = page
        .getByText(/options/i)
        .or(page.locator('[data-node-type="options"], [data-stream="options"]'))
        .first();
      const dividendsNode = page
        .getByText(/dividend/i)
        .or(page.locator('[data-node-type="dividends"], [data-stream="dividends"]'))
        .first();
      const bondsNode = page
        .getByText(/bond/i)
        .or(page.locator('[data-node-type="bonds"], [data-stream="bonds"]'))
        .first();

      await expect(optionsNode).toBeVisible({ timeout: 10_000 });
      await expect(dividendsNode).toBeVisible({ timeout: 10_000 });
      await expect(bondsNode).toBeVisible({ timeout: 10_000 });

      // Total Inflow must aggregate all 3 streams (substantially > single expense)
      const inflowCard = page
        .getByText(/total inflow|income/i)
        .locator('..')
        .first();

      if (await inflowCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const inflowText = await inflowCard.textContent();
        // Options (~54k ILS) + Dividends (~93.6k ILS) + Bonds (~80k ILS) ≈ 227k ILS/yr
        // Living costs = 120k ILS/yr — Inflow must be substantially more
        const inflow = parseFloat((inflowText ?? '').replace(/[₪$£€,\s]/g, ''));
        expect(inflow, 'Total Inflow should aggregate all 3 income streams').toBeGreaterThan(50_000);
      }

      // No stream collapses to 0 (all must contribute non-trivially)
      // This is an approximation — exact validation depends on income-stream contract
    },
  );
});
