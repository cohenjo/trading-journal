/**
 * LURVG Validation Spec: PR #375 — RLS Policies Fix (#374)
 *
 * Validates that after removing the createAdminClient() workaround and adding proper
 * RLS SELECT policies on dividend_payments + dividend_accruals, the standard
 * cookie-client createClient() correctly reads household-scoped data.
 *
 * Context:
 *   - PR #368 introduced createAdminClient() to bypass zero-policy RLS (issue #367)
 *   - PR #374 migration added household-scoped SELECT policies on dividend tables
 *     and disabled RLS on security_reference (global reference data)
 *   - PR #375 removes createAdminClient() from getDividendPositions(), switches back
 *     to createClient() — this LURVG proves the RLS policies permit reads
 *
 * RUNNING:
 *   SUPABASE_E2E_ALLOW_PROD=true npx playwright test e2e/lurvg-pr375-rls-policies.spec.ts \
 *     --project=chromium --reporter=list
 *
 * SEED STRATEGY:
 *   - Creates ephemeral test user + household + IBKR trading_account_config
 *   - Seeds stock_positions for JEPI, O, GS (tickers with real dividend_payments in prod)
 *   - New RLS policy allows the cookie-client user to read dividend_payments/accruals via:
 *       trading_account_config.account_id → is_household_member(household_id)
 *   - The RLS policies use a TEXT account_id join — the seed matches this exactly
 *
 * Evidence: apps/frontend/e2e/lurvg-evidence/
 *
 * Validated by: Redfoot (Tester) per LURVG Path 2.
 * High-stakes: migration already applied to prod DB. If dividends go empty on this
 * branch, 🔴 immediately — merge would break production.
 */

import { test as authTest, expect } from './fixtures/auth-cookie';
import path from 'path';
import fs from 'fs';
import { getAdminClient } from './fixtures/admin';
import { ensureHousehold } from './helpers/household';
import { seedTradingAccount } from './fixtures/seed-data';

const EVIDENCE_DIR = path.join(__dirname, 'lurvg-evidence');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const IBKR_TICKERS = ['JEPI', 'O', 'GS'];

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
  if (error) throw new Error(`[lurvg-pr375] seedStockPositions failed: ${error.message}`);
}

async function cleanupStockPositions(householdId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from('stock_positions').delete().eq('household_id', householdId);
}

async function cleanupTradingAccountConfig(householdId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from('trading_account_config').delete().eq('household_id', householdId);
}

// ─── Post-fix validation (squad/374-rls-policies branch) ────────────────────

authTest.describe(
  '[post-fix] PR #375 — cookie-client + RLS policies populate IBKR dividends',
  () => {
    let householdId: string | null = null;

    authTest(
      'post-fix: /dividends?account=ibkr — table populated with JEPI, O, GS via createClient()',
      async ({ authenticatedUser }) => {
        const { page, userId } = authenticatedUser;

        householdId = await ensureHousehold(userId, 'individual');
        if (!householdId) authTest.skip('Service-role env not configured');

        // CRITICAL: seed with the REAL IBKR broker account number that exists in
        // dividend_payments.account_id. The new RLS policy (migration 20260511102251)
        // requires: dividend_payments.account_id IN (SELECT account_id FROM
        // trading_account_config WHERE is_household_member(household_id))
        // Using a fake ID would cause RLS to return 0 rows — false negative.
        const { accountId: accountIdText } = await seedTradingAccount(householdId!, {
          name: 'LURVG PR375 IBKR',
          accountType: 'ibkr',
          accountId: 'U2515365',
        });

        const admin = getAdminClient();
        // Filter by BOTH account_id AND household_id — account_id may exist in
        // multiple households (e.g. Jony's real prod row), so .single() would fail
        // without the household_id scoping.
        const { data: configRow } = await admin
          .from('trading_account_config')
          .select('id')
          .eq('account_id', accountIdText)
          .eq('household_id', householdId!)
          .maybeSingle();

        if (!configRow) {
          authTest.skip('Could not retrieve seeded trading_account_config');
          return;
        }

        await seedStockPositions(householdId!, configRow.id, IBKR_TICKERS);

        try {
          await page.goto('/dividends?account=ibkr');
          await page.waitForLoadState('networkidle');

          // Assert positions table is visible and populated
          const positionsTable = page.getByTestId('dividends-positions-table');
          await expect(positionsTable).toBeVisible({ timeout: 15000 });

          // Check at least one of the seeded tickers appears
          const tableHtml = await positionsTable.evaluate((el) => el.outerHTML);
          const hasAnyTicker = IBKR_TICKERS.some((t) => tableHtml.includes(t));
          expect(hasAnyTicker).toBe(true);

          // Summary header should be non-zero
          const summaryHeader = page.locator('[data-testid="dividends-summary-header"], [data-testid="dividend-summary"], h1, h2').first();

          fs.writeFileSync(
            path.join(EVIDENCE_DIR, 'pr375-postfix-dividends-ibkr-dom.txt'),
            tableHtml,
          );

          await page.screenshot({
            path: path.join(EVIDENCE_DIR, 'pr375-postfix-dividends-ibkr-populated.png'),
            fullPage: true,
          });
        } finally {
          await cleanupStockPositions(householdId!);
          await cleanupTradingAccountConfig(householdId!);
        }
      },
    );

    authTest(
      'post-fix: /dividends?account=schwab — empty state (correct, no schwab data)',
      async ({ authenticatedUser }) => {
        const { page, userId } = authenticatedUser;

        const hid = await ensureHousehold(userId, 'individual');
        if (!hid) authTest.skip('Service-role env not configured');

        await page.goto('/dividends?account=schwab');
        await page.waitForLoadState('networkidle');

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'pr375-postfix-dividends-schwab-empty.png'),
          fullPage: true,
        });

        // Should NOT show a 500 error
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('500');
        expect(bodyText).not.toContain('Internal Server Error');
      },
    );

    authTest(
      'post-fix: /ladder?account=ibkr — bonds ladder populated',
      async ({ authenticatedUser }) => {
        const { page, userId } = authenticatedUser;
        const hid = await ensureHousehold(userId, 'individual');
        if (!hid) authTest.skip('Service-role env not configured');

        await page.goto('/ladder?account=ibkr');
        await page.waitForLoadState('networkidle');

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'pr375-postfix-ladder-ibkr-populated.png'),
          fullPage: true,
        });

        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('500');
        expect(bodyText).not.toContain('Internal Server Error');
      },
    );

    authTest(
      'post-fix: /summary — loads, income figures visible',
      async ({ authenticatedUser }) => {
        const { page, userId } = authenticatedUser;
        const hid = await ensureHousehold(userId, 'individual');
        if (!hid) authTest.skip('Service-role env not configured');

        await page.goto('/summary');
        await page.waitForLoadState('networkidle');

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'pr375-postfix-summary.png'),
          fullPage: true,
        });

        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('500');
        expect(bodyText).not.toContain('Internal Server Error');
      },
    );

    authTest(
      'post-fix: /trading/accounts — 3 account tabs visible (regression #371)',
      async ({ authenticatedUser }) => {
        const { page, userId } = authenticatedUser;
        const hid = await ensureHousehold(userId, 'individual');
        if (!hid) authTest.skip('Service-role env not configured');

        await page.goto('/trading/accounts');
        await page.waitForLoadState('networkidle');

        // Tabs are <button> elements with data-testid="account-tab-{type}" (not role=tablist)
        const ibkrTab = page.getByTestId('account-tab-ibkr');
        const schwabTab = page.getByTestId('account-tab-schwab');
        const iraTab = page.getByTestId('account-tab-ira');
        await expect(ibkrTab).toBeVisible({ timeout: 10000 });
        await expect(schwabTab).toBeVisible({ timeout: 10000 });
        await expect(iraTab).toBeVisible({ timeout: 10000 });

        const tabBarHtml = await ibkrTab.evaluate((el) => el.parentElement?.outerHTML ?? el.outerHTML);
        fs.writeFileSync(
          path.join(EVIDENCE_DIR, 'pr375-postfix-accounts-tabs-dom.txt'),
          tabBarHtml,
        );

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'pr375-postfix-accounts-tabs.png'),
          fullPage: true,
        });
      },
    );
  },
);
