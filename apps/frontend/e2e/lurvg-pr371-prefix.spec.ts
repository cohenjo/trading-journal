/**
 * LURVG pre-fix spec for PR #371 (issue #359)
 *
 * Purpose: Reproduce-Before-Fix validation on main branch.
 *
 * Bug hypothesis: On main, `saveTradingConfig` has NO duplicate-prevention
 * guard. When a second `account_type=schwab` row is inserted for the same
 * household, the DB has no unique constraint on (household_id, account_type),
 * so the INSERT silently succeeds — the user sees a SUCCESS banner when
 * they should see a friendly "already configured" error.
 *
 * This spec CONFIRMS the bug is visible on main:
 *   - Pre-seed a Schwab row (admin)
 *   - Submit a second Schwab via the form
 *   - Assert the success banner is shown (the bug — should have been rejected)
 *   - Capture screenshot as evidence
 *
 * After this spec passes on main, the fix branch should be validated with
 * add-broker-form.spec.ts (Hockney's spec) which expects the rejection.
 *
 * RUNNING (on main, local prod build on :3000):
 *   SUPABASE_E2E_ALLOW_PROD=true npx playwright test e2e/lurvg-pr371-prefix.spec.ts \
 *     --project=chromium --reporter=list
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

authTest.describe('PR #371 pre-fix: duplicate-add silently succeeds on main', () => {
  authTest(
    'duplicate Schwab add shows SUCCESS banner (bug: should be rejected)',
    async ({ authenticatedUser }) => {
      const { page, userId } = authenticatedUser;

      const householdId = await ensureHousehold(userId, 'individual');
      if (!householdId) authTest.skip('Service-role env not configured');

      // Pre-seed a Schwab config so the duplicate scenario triggers
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

        // Navigate to Settings tab (main uses tab-settings, fix branch uses account-tab-settings)
        await page.getByTestId('tab-settings').click();
        await page.waitForTimeout(500);

        // Open the add-new-broker form
        await page.getByRole('button', { name: /add broker/i }).click();
        await page.waitForTimeout(300);

        // Fill in a duplicate Schwab (use getByTitle since label has no htmlFor attribute)
        await page.getByTitle('Account Name').fill('Duplicate Schwab Attempt');
        await page.getByTitle('Account Type').selectOption('schwab');

        await page.getByRole('button', { name: /save settings/i }).click();
        await page.waitForTimeout(2000);

        // BUG: On main, no duplicate check → INSERT succeeds → success banner shown
        // This screenshot captures the buggy behavior as evidence
        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'pr371-prebug-broker-add-silent-fail.png'),
          fullPage: true,
        });

        // Capture the DOM state for evidence
        const successVisible = await page.getByTestId('settings-save-success').isVisible();
        const errorVisible = await page.getByTestId('settings-save-error').isVisible();

        const domState = `Pre-fix duplicate Schwab add result:
success banner visible: ${successVisible}
error banner visible: ${errorVisible}
Expected on main (bug): success=true, error=false (duplicate silently accepted)
Expected on fix branch: success=false, error=true ("already configured" message)
`;
        fs.writeFileSync(path.join(EVIDENCE_DIR, 'pr371-prebug-dom-state.txt'), domState);

        // On main the duplicate should SUCCEED (bug) — success banner appears
        // If this assertion fails, the bug was already fixed on main
        await expect(page.getByTestId('settings-save-success')).toBeVisible({ timeout: 5_000 });

        // Confirm: no error banner shown (bug — should have been shown)
        await expect(page.getByTestId('settings-save-error')).not.toBeVisible();

      } finally {
        await cleanupBrokerConfigs(householdId!);
        await ensureNoHousehold(userId);
      }
    },
  );
});
