/**
 * R2 E2E regression tests for Issue #340 Phase 2 — Accounts phase 2
 *
 * Covers:
 *   - Three account type tabs (ibkr / schwab / ira) appear with correct labels
 *   - IBKR tab is read-only (shows refresh-button, no add-position-button)
 *   - Schwab / IRA tabs are manual (show add-position-button, no refresh-button)
 *
 * Pattern follows the existing `trading-accounts.spec.ts` E2E test.
 * Accounts are seeded with lowercase account_type values (Phase 2 migration).
 */

import { test, expect } from '../fixtures/test-user';
import { cleanupHouseholdData, seedTradingAccount } from '../fixtures/seed-data';

test.describe('Phase 2 — accounts tab / header @auth', () => {
  test('three account-type tabs render with correct labels', async ({ testUser: { page, householdId } }) => {
    // Seed one account per type so all three tabs appear
    await seedTradingAccount(householdId, { name: 'E2E IBKR', accountType: 'ibkr' });
    await seedTradingAccount(householdId, { name: 'E2E Schwab', accountType: 'schwab' });
    await seedTradingAccount(householdId, { name: 'E2E IRA', accountType: 'ira' });

    try {
      await page.goto('/trading/accounts', { waitUntil: 'networkidle', timeout: 20_000 });

      // All three tabs visible with correct display labels
      await expect(page.getByTestId('account-tab-ibkr')).toBeVisible();
      await expect(page.getByTestId('account-tab-schwab')).toBeVisible();
      await expect(page.getByTestId('account-tab-ira')).toBeVisible();

      await expect(page.getByTestId('account-tab-ibkr')).toHaveText('InteractiveBrokers');
      await expect(page.getByTestId('account-tab-schwab')).toHaveText('Schwab');
      await expect(page.getByTestId('account-tab-ira')).toHaveText('LeumiIRA');
    } finally {
      await cleanupHouseholdData(householdId);
    }
  });

  test('IBKR tab is read-only — shows refresh-button, not add-position-button', async ({ testUser: { page, householdId } }) => {
    await seedTradingAccount(householdId, { name: 'E2E IBKR RO', accountType: 'ibkr' });

    try {
      await page.goto('/trading/accounts', { waitUntil: 'networkidle', timeout: 20_000 });

      // Click IBKR tab explicitly before asserting — active tab determines which AccountHeader renders
      await page.getByTestId('account-tab-ibkr').click();
      await expect(page.getByTestId('refresh-button')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('add-position-button')).not.toBeVisible();
    } finally {
      await cleanupHouseholdData(householdId);
    }
  });

  test('Schwab tab is manual — shows add-position-button, not refresh-button', async ({ testUser: { page, householdId } }) => {
    await seedTradingAccount(householdId, { name: 'E2E IBKR', accountType: 'ibkr' });
    await seedTradingAccount(householdId, { name: 'E2E Schwab Manual', accountType: 'schwab' });

    try {
      await page.goto('/trading/accounts', { waitUntil: 'networkidle', timeout: 20_000 });

      // Switch to Schwab tab
      await page.getByTestId('account-tab-schwab').click();

      await expect(page.getByTestId('add-position-button')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('refresh-button')).not.toBeVisible();
    } finally {
      await cleanupHouseholdData(householdId);
    }
  });

  test('IRA tab is manual — shows add-position-button, not refresh-button', async ({ testUser: { page, householdId } }) => {
    await seedTradingAccount(householdId, { name: 'E2E IBKR', accountType: 'ibkr' });
    await seedTradingAccount(householdId, { name: 'E2E IRA Manual', accountType: 'ira' });

    try {
      await page.goto('/trading/accounts', { waitUntil: 'networkidle', timeout: 20_000 });

      await page.getByTestId('account-tab-ira').click();

      await expect(page.getByTestId('add-position-button')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('refresh-button')).not.toBeVisible();
    } finally {
      await cleanupHouseholdData(householdId);
    }
  });
});
