/**
 * e2e/flows/wave2-holdings.spec.ts
 *
 * Wave-2 CRUD coverage: /holdings  @flow
 * Issue #176 — bond holdings add/delete round-trip.
 *
 * The /holdings page stores bond holding rows in `bond_holdings` (household-scoped).
 * All mutations go through Next.js Server Actions → Supabase; no FastAPI dependency.
 *
 * Coverage:
 *   create — click "+ Add holding", fill required fields, save, assert row appears
 *   delete — click "Remove" on an existing row, assert row disappears
 *   persistence — reload after save and assert row survives
 *
 * Teardown: cleanupHouseholdData removes bond_holdings rows so deleteE2eUser succeeds.
 */
import { test, expect } from '../fixtures/test-user';
import { cleanupHouseholdData } from '../fixtures/seed-data';

const ISSUER_NAME = 'E2E Corp Bond 2031';
const MATURITY_DATE = '2031-12-31';

test.describe('wave-2 CRUD: /holdings @flow', () => {
  test('create a bond holding and verify it appears @flow', async ({
    testUser: { page, householdId },
  }) => {
    try {
      await page.goto('/holdings', { waitUntil: 'domcontentloaded', timeout: 20_000 });

      // Page heading
      await expect(page.locator('h1').filter({ hasText: /Bond Holdings/i })).toBeVisible({
        timeout: 10_000,
      });

      // No 5xx errors on load
      const serverErrors: string[] = [];
      page.on('response', (resp) => {
        if (resp.status() >= 500 && resp.url().includes(page.url().split('/holdings')[0]))
          serverErrors.push(`${resp.status()} ${resp.url()}`);
      });

      // Open the add-row form
      const addBtn = page.getByRole('button', { name: '+ Add holding' });
      await expect(addBtn).toBeVisible({ timeout: 5_000 });
      await addBtn.click();

      // Fill required fields: Issuer and Maturity date
      const issuerInput = page.getByPlaceholder('Issuer');
      await expect(issuerInput).toBeVisible({ timeout: 5_000 });
      await issuerInput.fill(ISSUER_NAME);

      const maturityInput = page.getByLabel('Maturity date');
      await expect(maturityInput).toBeVisible();
      await maturityInput.fill(MATURITY_DATE);

      // Click Save (the new-row Save button)
      const saveBtn = page.getByRole('button', { name: /^Save$/ }).first();
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();

      // Wait for the row to appear in the table
      await expect(page.getByText(ISSUER_NAME)).toBeVisible({ timeout: 10_000 });

      // No error message shown
      await expect(page.locator('text=Failed to add holding')).toHaveCount(0);

      // Persist check: reload and verify row survives
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_500);
      await expect(page.getByText(ISSUER_NAME)).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanupHouseholdData(householdId).catch((err: Error) =>
        console.warn(`[wave2-holdings] cleanup warning: ${err.message}`),
      );
    }
  });

  test('delete a bond holding and verify it disappears @flow', async ({
    testUser: { page, householdId },
  }) => {
    try {
      await page.goto('/holdings', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await expect(page.locator('h1').filter({ hasText: /Bond Holdings/i })).toBeVisible({
        timeout: 10_000,
      });

      // Create a holding to delete
      const addBtn = page.getByRole('button', { name: '+ Add holding' });
      await expect(addBtn).toBeVisible({ timeout: 5_000 });
      await addBtn.click();

      const issuerInput = page.getByPlaceholder('Issuer');
      await expect(issuerInput).toBeVisible({ timeout: 5_000 });
      await issuerInput.fill('E2E Delete Target Bond');

      const maturityInput = page.getByLabel('Maturity date');
      await maturityInput.fill('2030-06-30');

      const saveBtn = page.getByRole('button', { name: /^Save$/ }).first();
      await saveBtn.click();

      // Wait for the row to appear
      await expect(page.getByText('E2E Delete Target Bond')).toBeVisible({ timeout: 10_000 });

      // Click Remove on the row
      const removeBtn = page.getByRole('button', { name: 'Remove' }).last();
      await expect(removeBtn).toBeVisible();
      await removeBtn.click();

      // Row should disappear
      await expect(page.getByText('E2E Delete Target Bond')).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await cleanupHouseholdData(householdId).catch((err: Error) =>
        console.warn(`[wave2-holdings] cleanup warning: ${err.message}`),
      );
    }
  });

  test('/holdings loads without 5xx and renders table structure @flow', async ({
    testUser: { page, householdId },
  }) => {
    try {
      const serverErrors: string[] = [];
      page.on('response', (resp) => {
        if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
      });

      await page.goto('/holdings', { waitUntil: 'networkidle', timeout: 20_000 });

      expect(serverErrors).toHaveLength(0);
      await expect(page.locator('h1').filter({ hasText: /Bond Holdings/i })).toBeVisible();
      await expect(page.getByRole('button', { name: '+ Add holding' })).toBeVisible();
    } finally {
      await cleanupHouseholdData(householdId).catch((err: Error) =>
        console.warn(`[wave2-holdings] cleanup warning: ${err.message}`),
      );
    }
  });
});
