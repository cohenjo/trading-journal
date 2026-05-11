import { test, expect } from '../fixtures/test-user';
import { cleanupHouseholdData, seedTradingAccount } from '../fixtures/seed-data';

const UPDATED_ACCOUNT_NAME = 'E2E Edited IBKR Account';

test.describe('trading accounts @auth', () => {
  test('renders 3-tab layout and allows editing an IBKR account @smoke', async ({ testUser: { page, householdId } }) => {
    await seedTradingAccount(householdId, {
      name: 'E2E IBKR Account',
      accountId: 'E2E_IBKR_001',
      computeOptionsIncome: true,
    });

    try {
      await page.goto('/trading/accounts', { waitUntil: 'networkidle', timeout: 20_000 });

      // Heading reflects the refactored page title
      await expect(page.getByRole('heading', { name: /Stock Positions/i })).toBeVisible();

      // All 3 account tabs are always rendered (hardcoded in UI per PRs #354 + #355)
      await expect(page.getByTestId('account-tab-ibkr')).toBeVisible();
      await expect(page.getByTestId('account-tab-schwab')).toBeVisible();
      await expect(page.getByTestId('account-tab-ira')).toBeVisible();

      // Default active tab is IBKR — seeded account header should be visible
      await expect(page.getByRole('heading', { name: /E2E IBKR Account/i, level: 2 })).toBeVisible();

      // Switch to Settings tab and verify the seeded account appears
      await page.getByTestId('account-tab-settings').click();
      // Settings list button: "{name} ({account_type})" — account_type stored lowercase
      await expect(page.getByRole('button', { name: /E2E IBKR Account \(ibkr\)/i })).toBeVisible();

      // Edit account name and save
      await page.getByTitle('Account Name').fill(UPDATED_ACCOUNT_NAME);
      await page.getByRole('button', { name: 'Save Settings' }).click();

      await expect(page.getByTestId('settings-save-success')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: new RegExp(`${UPDATED_ACCOUNT_NAME} \\(ibkr\\)`, 'i') })).toBeVisible();
    } finally {
      await cleanupHouseholdData(householdId);
    }
  });
});
