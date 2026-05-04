import { test, expect } from '../fixtures/test-user';
import { cleanupHouseholdData, seedTradingAccount } from '../fixtures/seed-data';

const UPDATED_ACCOUNT_NAME = 'E2E Edited IBKR Account';

test.describe('trading accounts settings @auth', () => {
  test('user sees an existing IBKR account and can edit it', async ({ testUser: { page, householdId } }) => {
    await seedTradingAccount(householdId, {
      name: 'E2E IBKR Account',
      accountId: 'E2E_IBKR_001',
      computeOptionsIncome: true,
    });

    try {
      await page.goto('/trading/accounts', { waitUntil: 'networkidle', timeout: 20_000 });

      await expect(page.getByRole('heading', { name: /Trading Accounts/i })).toBeVisible();
      await expect(page.getByRole('button', { name: 'E2E IBKR Account' })).toBeVisible();
      await expect(page.getByText(/IBKR Account:/)).toBeVisible();

      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('button', { name: /E2E IBKR Account \(IBKR\)/ })).toBeVisible();

      await page.getByTitle('Account Name').fill(UPDATED_ACCOUNT_NAME);
      await page.getByRole('button', { name: 'Save Settings' }).click();

      await expect(page.getByText('Settings saved successfully!')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: new RegExp(`${UPDATED_ACCOUNT_NAME} \\(IBKR\\)`) })).toBeVisible();
      await expect(page.getByText(/Failed to create trading account settings\./)).toHaveCount(0);
    } finally {
      await cleanupHouseholdData(householdId);
    }
  });
});
