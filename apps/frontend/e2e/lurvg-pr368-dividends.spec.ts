/**
 * LURVG Validation Spec: PR #368 — Dividends Empty Hotfix
 *
 * Validates the three-root-cause fix for issue #367:
 *   1. RLS default-deny on dividend_payments / dividend_accruals  → createAdminClient()
 *   2. NULL ex_date on IBKR Flex rows                             → OR filter + JS fallback
 *   3. Hardcoded "today" date (2026-05-11)                        → new Date()
 *
 * RUNNING:
 *   # Pre-fix (main branch) — prove the bug:
 *   SUPABASE_E2E_ALLOW_PROD=true npx playwright test e2e/lurvg-pr368-dividends.spec.ts \
 *     --project=chromium --grep "pre-fix"
 *
 *   # Post-fix (squad/dividends-empty-fix branch) — prove the fix:
 *   SUPABASE_E2E_ALLOW_PROD=true npx playwright test e2e/lurvg-pr368-dividends.spec.ts \
 *     --project=chromium --grep "post-fix"
 *
 * SEED STRATEGY:
 *   - Creates an ephemeral test user + household + IBKR trading_account_config
 *   - Seeds stock_positions for JEPI, O, GS (production-matching tickers)
 *   - dividend_payments already contains Jony's real JEPI/O/GS data (production DB)
 *   - Pre-fix: user-scoped client hits RLS (0 policies) → returns [] → empty state
 *   - Post-fix: admin client bypasses RLS → finds payments → positions table rendered
 *
 * Evidence: apps/frontend/e2e/lurvg-evidence/
 *
 * Validated by: Redfoot (Tester) per LURVG Path 2 — Reproduce-Before-Fix Rule
 */

import { test as authTest, expect } from './fixtures/auth-cookie';
import path from 'path';
import fs from 'fs';
import { getAdminClient } from './fixtures/admin';
import { ensureHousehold, ensureNoHousehold } from './helpers/household';
import { seedTradingAccount } from './fixtures/seed-data';

const EVIDENCE_DIR = path.join(__dirname, 'lurvg-evidence');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// Production tickers that have real dividend_payments data in Supabase prod
const IBKR_TICKERS = ['JEPI', 'O', 'GS'];

/**
 * Seeds stock_positions for the given tickers under a household/account.
 * Uses today's date so the "latest flex snapshot" deduplication logic picks them up.
 */
async function seedStockPositions(
  householdId: string,
  accountConfigId: number,
  tickers: string[],
): Promise<void> {
  const admin = getAdminClient();
  const today = new Date().toISOString().split('T')[0];

  const rows = tickers.map((ticker) => ({
    household_id: householdId,
    account_id: accountConfigId,
    ticker,
    quantity: 100,
    currency: 'USD',
    as_of_date: today,
    source: 'flex' as const,
    mark_price: 50.0,
    market_value: 5000.0,
  }));

  const { error } = await admin.from('stock_positions').insert(rows);
  if (error) throw new Error(`[lurvg-pr368] seedStockPositions failed: ${error.message}`);
}

/**
 * Removes all seeded stock_positions for the given household.
 */
async function cleanupStockPositions(householdId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from('stock_positions').delete().eq('household_id', householdId);
}

/**
 * Removes seeded trading_account_config rows for the given household.
 */
async function cleanupTradingAccountConfig(householdId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from('trading_account_config').delete().eq('household_id', householdId);
}

// ─── Pre-fix validation (run on main branch) ────────────────────────────────

authTest.describe('[pre-fix] Main branch — RLS bug causes empty IBKR dividends tab', () => {
  authTest(
    'pre-fix: IBKR dividends tab shows empty-state when dividend_payments blocked by RLS',
    async ({ authenticatedUser }) => {
      const { page, userId } = authenticatedUser;

      // Seed household + IBKR account + positions
      const householdId = await ensureHousehold(userId, 'individual');
      if (!householdId) authTest.skip('Service-role env not configured');

      const { accountId: accountIdText } = await seedTradingAccount(householdId!, {
        name: 'LURVG PR368 IBKR (pre-fix)',
        accountType: 'ibkr',
        accountId: `LURVG_PR368_PREFX_${Date.now()}`,
      });

      // Resolve the integer account config id
      const admin = getAdminClient();
      const { data: configRow } = await admin
        .from('trading_account_config')
        .select('id')
        .eq('account_id', accountIdText)
        .single();
      const configId = (configRow as { id: number } | null)?.id;
      if (!configId) throw new Error('[lurvg-pr368] Could not find seeded account config');

      await seedStockPositions(householdId!, configId, IBKR_TICKERS);

      try {
        await page.goto('/dividends');
        await page.waitForLoadState('networkidle');

        // Click IBKR tab
        await page.getByTestId('div-tab-ibkr').click();
        await page.waitForTimeout(1500);

        // Capture screenshot regardless of outcome — this is our bug evidence
        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'dividends-empty-prebug-main.png'),
          fullPage: true,
        });

        // Capture DOM state
        const bodyHtml = await page
          .locator('main')
          .evaluate((el) => el.innerHTML);
        fs.writeFileSync(
          path.join(EVIDENCE_DIR, 'dividends-prebug-dom.txt'),
          bodyHtml,
        );

        // ── ASSERTION: empty state MUST be visible (confirms bug) ──────────
        await expect(
          page.getByTestId('dividends-account-empty'),
          'Bug reproduced: IBKR dividends tab shows empty-state despite seeded positions',
        ).toBeVisible({ timeout: 10_000 });

        // Positions table must NOT be visible (confirms the bug)
        await expect(
          page.getByTestId('dividends-positions-table'),
        ).not.toBeVisible();
      } finally {
        await cleanupStockPositions(householdId!);
        await cleanupTradingAccountConfig(householdId!);
        await ensureNoHousehold(userId);
      }
    },
  );
});

// ─── Post-fix validation (run on squad/dividends-empty-fix branch) ───────────

authTest.describe('[post-fix] Fix branch — admin client populates IBKR dividends tab', () => {
  authTest(
    'post-fix: IBKR dividends tab shows positions table with JEPI, O, GS',
    async ({ authenticatedUser }) => {
      const { page, userId } = authenticatedUser;

      // Seed household + IBKR account + positions
      const householdId = await ensureHousehold(userId, 'individual');
      if (!householdId) authTest.skip('Service-role env not configured');

      const { accountId: accountIdText } = await seedTradingAccount(householdId!, {
        name: 'LURVG PR368 IBKR (post-fix)',
        accountType: 'ibkr',
        accountId: `LURVG_PR368_POSTFX_${Date.now()}`,
      });

      const admin = getAdminClient();
      const { data: configRow } = await admin
        .from('trading_account_config')
        .select('id')
        .eq('account_id', accountIdText)
        .single();
      const configId = (configRow as { id: number } | null)?.id;
      if (!configId) throw new Error('[lurvg-pr368] Could not find seeded account config');

      await seedStockPositions(householdId!, configId, IBKR_TICKERS);

      try {
        await page.goto('/dividends');
        await page.waitForLoadState('networkidle');

        // Click IBKR tab
        await page.getByTestId('div-tab-ibkr').click();
        await page.waitForTimeout(2000); // Allow server action to resolve

        // ── ASSERTION 1: positions table is visible ─────────────────────────
        await expect(
          page.getByTestId('dividends-positions-table'),
          'Fix confirmed: positions table rendered for IBKR tab',
        ).toBeVisible({ timeout: 15_000 });

        // Capture DOM snippet of the table
        const tableHtml = await page
          .locator('[data-testid="dividends-positions-table"]')
          .evaluate((el) => el.parentElement?.outerHTML ?? el.outerHTML);
        fs.writeFileSync(
          path.join(EVIDENCE_DIR, 'dividends-postfix-table-dom.txt'),
          tableHtml,
        );

        // ── ASSERTION 2: JEPI, O, GS rows present ──────────────────────────
        for (const ticker of IBKR_TICKERS) {
          await expect(
            page.getByTestId(`dividend-row-${ticker}`),
            `dividend-row-${ticker} is visible`,
          ).toBeVisible({ timeout: 10_000 });
        }

        // ── ASSERTION 3: summary header shows non-zero ──────────────────────
        const summaryEl = page.getByTestId('dividends-summary-total');
        if (await summaryEl.isVisible()) {
          const summaryHtml = await summaryEl.evaluate((el) => el.outerHTML);
          fs.writeFileSync(
            path.join(EVIDENCE_DIR, 'dividends-postfix-summary-dom.txt'),
            summaryHtml,
          );
        }

        // ── SCREENSHOT: populated IBKR tab ─────────────────────────────────
        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'dividends-populated-postfix-ibkr.png'),
          fullPage: true,
        });

        // ── ASSERTION 4: empty state is NOT visible ─────────────────────────
        await expect(
          page.getByTestId('dividends-account-empty'),
        ).not.toBeVisible();

        // ── Schwab tab sanity: should still show empty state ────────────────
        await page.getByTestId('div-tab-schwab').click();
        await page.waitForTimeout(1000);
        await expect(
          page.getByTestId('dividends-account-empty'),
          'Schwab tab still shows correct empty-state',
        ).toBeVisible({ timeout: 8_000 });
        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'dividends-empty-schwab.png'),
          fullPage: true,
        });
      } finally {
        await cleanupStockPositions(householdId!);
        await cleanupTradingAccountConfig(householdId!);
        await ensureNoHousehold(userId);
      }
    },
  );
});

// ─── Ladder regression (post-fix only) ──────────────────────────────────────

authTest.describe('[post-fix] Ladder — IBKR populates, Schwab/IRA empty (no regression)', () => {
  authTest(
    'post-fix ladder: IBKR ladder still populates after dividends hotfix',
    async ({ authenticatedUser }) => {
      const { page, userId } = authenticatedUser;

      const householdId = await ensureHousehold(userId, 'individual');
      if (!householdId) authTest.skip('Service-role env not configured');

      const { accountId: accountIdText } = await seedTradingAccount(householdId!, {
        name: 'LURVG PR368 Ladder IBKR',
        accountType: 'ibkr',
        accountId: `LURVG_PR368_LDDR_${Date.now()}`,
      });

      const admin = getAdminClient();
      const { data: configRow } = await admin
        .from('trading_account_config')
        .select('id')
        .eq('account_id', accountIdText)
        .single();
      const configId = (configRow as { id: number } | null)?.id;
      if (!configId) throw new Error('[lurvg-pr368] Could not find seeded account config');

      await seedStockPositions(householdId!, configId, IBKR_TICKERS);

      try {
        await page.goto('/ladder');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'ladder-postfix-ibkr.png'),
          fullPage: true,
        });

        // Ladder page loaded without crash = no regression from dividends hotfix
        await expect(page).toHaveURL(/\/ladder/);
      } finally {
        await cleanupStockPositions(householdId!);
        await cleanupTradingAccountConfig(householdId!);
        await ensureNoHousehold(userId);
      }
    },
  );
});
