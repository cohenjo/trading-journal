/**
 * E2E spec: Add Broker form (#359)
 *
 * Validates the 3-layer fix for issue #359:
 *   1. Frontend form uses canonical lowercase account_type tokens
 *   2. Server action normalizes + validates account_type
 *   3. Duplicate prevention: friendly error when account_type already exists
 *
 * RUNNING:
 *   SUPABASE_E2E_ALLOW_PROD=true npx playwright test e2e/add-broker-form.spec.ts \
 *     --project=chromium --reporter=list
 *
 * SEED STRATEGY:
 *   - Creates an ephemeral test user + household (no pre-existing broker configs)
 *   - Adds a Schwab account via the form UI
 *   - Asserts success banner + page reload shows 3 tabs
 *   - Negative test: second Schwab add should show "already configured" error
 *   - Cleanup: delete all trading_account_config rows for the test household
 */

import { test as authTest, expect } from './fixtures/auth-cookie';
import path from 'path';
import fs from 'fs';
import { getAdminClient } from './fixtures/admin';
import { ensureHousehold, ensureNoHousehold } from './helpers/household';

const EVIDENCE_DIR = path.join(__dirname, 'lurvg-evidence');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

async function cleanupBrokerConfigs(householdId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from('trading_account_config').delete().eq('household_id', householdId);
}

authTest.describe('Add Broker form — #359 fix', () => {
  authTest(
    'adds a Schwab account via Settings form and shows success; all 3 tabs visible after reload',
    async ({ authenticatedUser }) => {
      const { page, userId } = authenticatedUser;

      const householdId = await ensureHousehold(userId, 'individual');
      if (!householdId) authTest.skip('Service-role env not configured');

      try {
        // Navigate to the accounts page and open the Settings tab
        await page.goto('/trading/accounts');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('account-tab-settings').click();
        await page.waitForTimeout(500);

        // Click "Add Broker" to reset the form to a new-account state
        await page.getByRole('button', { name: /add broker/i }).click();
        await page.waitForTimeout(300);

        // Fill in the form: Schwab
        await page.getByTitle('Account Name').fill('My Schwab Account');
        await page.getByTitle('Account Type').selectOption('schwab');

        // Submit
        await page.getByRole('button', { name: /save settings/i }).click();
        await page.waitForTimeout(1500);

        // Assert success banner is visible
        await expect(
          page.getByTestId('settings-save-success'),
          'Success banner should appear after saving Schwab account',
        ).toBeVisible({ timeout: 10_000 });

        // Assert no error banner
        await expect(page.getByTestId('settings-save-error')).not.toBeVisible();

        // Screenshot evidence
        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'add-broker-schwab-success.png'),
          fullPage: true,
        });

        // Reload and assert all 3 broker tabs are still visible (always rendered)
        await page.reload();
        await page.waitForLoadState('networkidle');

        await expect(page.getByTestId('account-tab-ibkr')).toBeVisible();
        await expect(page.getByTestId('account-tab-schwab')).toBeVisible();
        await expect(page.getByTestId('account-tab-ira')).toBeVisible();

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'add-broker-schwab-after-reload.png'),
          fullPage: true,
        });
      } finally {
        await cleanupBrokerConfigs(householdId!);
        await ensureNoHousehold(userId);
      }
    },
  );

  authTest(
    'negative: second Schwab add shows "already configured" error (duplicate prevention)',
    async ({ authenticatedUser }) => {
      const { page, userId } = authenticatedUser;

      const householdId = await ensureHousehold(userId, 'individual');
      if (!householdId) authTest.skip('Service-role env not configured');

      // Pre-seed a Schwab config so the duplicate check triggers
      const admin = getAdminClient();
      await admin.from('trading_account_config').insert({
        household_id: householdId,
        name: 'Pre-existing Schwab',
        account_type: 'schwab',
        host: '127.0.0.1',
        port: 4001,
        client_id: 1,
        compute_options_income: false,
      });

      try {
        await page.goto('/trading/accounts');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('account-tab-settings').click();
        await page.waitForTimeout(500);

        // Try to add another Schwab account
        await page.getByRole('button', { name: /add broker/i }).click();
        await page.waitForTimeout(300);

        await page.getByTitle('Account Name').fill('Duplicate Schwab');
        await page.getByTitle('Account Type').selectOption('schwab');

        await page.getByRole('button', { name: /save settings/i }).click();
        await page.waitForTimeout(1500);

        // Assert error banner is shown with "already configured" message
        await expect(
          page.getByTestId('settings-save-error'),
          'Error banner should appear when adding a duplicate account type',
        ).toBeVisible({ timeout: 10_000 });

        const errorText = await page.getByTestId('settings-save-error').textContent();
        expect(errorText?.toLowerCase()).toContain('already configured');

        // No success banner
        await expect(page.getByTestId('settings-save-success')).not.toBeVisible();

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'add-broker-schwab-duplicate-error.png'),
          fullPage: true,
        });
      } finally {
        await cleanupBrokerConfigs(householdId!);
        await ensureNoHousehold(userId);
      }
    },
  );
});
