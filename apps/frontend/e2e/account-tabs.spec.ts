import { test, expect } from '@playwright/test';

test.describe('Trading accounts page — 3 tabs', () => {
  test('renders all 3 broker tabs regardless of DB state', async ({ page }) => {
    await page.goto('/trading/accounts');
    await expect(page.getByTestId('account-tab-ibkr')).toBeVisible();
    await expect(page.getByTestId('account-tab-schwab')).toBeVisible();
    await expect(page.getByTestId('account-tab-ira')).toBeVisible();
    await expect(page.getByTestId('account-tab-settings')).toBeVisible();
  });

  test('clicking Schwab tab activates it', async ({ page }) => {
    await page.goto('/trading/accounts');
    await page.getByTestId('account-tab-schwab').click();
    // Verify either positions table OR empty state OR not-configured banner is visible
    const positions = page.locator('[data-testid^="position-row-"]');
    const emptyBanner = page.getByTestId('manual-empty-banner');
    const notConfigured = page.getByTestId('account-not-configured');
    await expect(positions.or(emptyBanner).or(notConfigured)).toBeVisible();
  });
});

test.describe('Dividends page — 3 tabs', () => {
  test('renders all 3 account tabs', async ({ page }) => {
    await page.goto('/dividends');
    await expect(page.getByTestId('div-tab-ibkr')).toBeVisible();
    await expect(page.getByTestId('div-tab-schwab')).toBeVisible();
    await expect(page.getByTestId('div-tab-ira')).toBeVisible();
  });
});
