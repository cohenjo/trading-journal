/**
 * e2e/flows/wave2-insurance.spec.ts
 *
 * Wave-2 CRUD coverage: /insurance  @flow
 * Issue #176 — insurance policy add/edit/delete round-trip.
 *
 * The /insurance page stores rows in `insurance_policies` (household-scoped).
 * All mutations go through Next.js Server Actions → Supabase; no FastAPI dependency.
 *
 * Coverage:
 *   create — click "+ Add Policy", fill required provider field, save, assert row appears
 *   edit   — click ✏️ on existing row, change provider, save, assert update
 *   delete — click 🗑️ on existing row, confirm dialog, assert row disappears
 *
 * Notes:
 *   - Delete uses window.confirm; Playwright auto-accepts dialogs by default.
 *   - Provider is the only required field; other fields are optional.
 *
 * Teardown: cleanupHouseholdData removes insurance_policies rows.
 */
import { test, expect } from '../fixtures/test-user';
import { cleanupHouseholdData } from '../fixtures/seed-data';

const PROVIDER_CREATE = 'E2E Clal Life';
const PROVIDER_EDITED = 'E2E Clal Life (Updated)';

test.describe('wave-2 CRUD: /insurance @flow', () => {
  test('/insurance loads without 5xx and renders heading @flow', async ({
    testUser: { page, householdId },
  }) => {
    try {
      const serverErrors: string[] = [];
      page.on('response', (resp) => {
        if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
      });

      await page.goto('/insurance', { waitUntil: 'networkidle', timeout: 20_000 });

      expect(serverErrors).toHaveLength(0);
      await expect(
        page.locator('h1').filter({ hasText: /Insurance Policies/i }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: /\+ Add Policy/i })).toBeVisible();
    } finally {
      await cleanupHouseholdData(householdId).catch((err: Error) =>
        console.warn(`[wave2-insurance] cleanup warning: ${err.message}`),
      );
    }
  });

  test('create an insurance policy and verify it appears @flow', async ({
    testUser: { page, householdId },
  }) => {
    try {
      await page.goto('/insurance', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await expect(
        page.locator('h1').filter({ hasText: /Insurance Policies/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Open the add form
      await page.getByRole('button', { name: /\+ Add Policy/i }).click();

      // Fill required provider field
      const providerInput = page.getByPlaceholder(/Clal, Migdal, Harel/i);
      await expect(providerInput).toBeVisible({ timeout: 5_000 });
      await providerInput.fill(PROVIDER_CREATE);

      // Sum insured (required for meaningful test data)
      const sumInsuredInput = page.getByPlaceholder(/Covers remaining mortgage/i);
      if (await sumInsuredInput.isVisible()) {
        await sumInsuredInput.fill('500000');
      }

      // Save the policy
      const saveBtn = page.getByRole('button', { name: /^Save$/ });
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();

      // Provider name should appear in the policies table
      await expect(page.getByText(PROVIDER_CREATE)).toBeVisible({ timeout: 10_000 });

      // No error banner
      await expect(page.locator('text=Failed to save')).toHaveCount(0);
    } finally {
      await cleanupHouseholdData(householdId).catch((err: Error) =>
        console.warn(`[wave2-insurance] cleanup warning: ${err.message}`),
      );
    }
  });

  test('edit an insurance policy provider name @flow', async ({
    testUser: { page, householdId },
  }) => {
    try {
      await page.goto('/insurance', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await expect(
        page.locator('h1').filter({ hasText: /Insurance Policies/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Create a policy first
      await page.getByRole('button', { name: /\+ Add Policy/i }).click();
      const providerInput = page.getByPlaceholder(/Clal, Migdal, Harel/i);
      await expect(providerInput).toBeVisible({ timeout: 5_000 });
      await providerInput.fill(PROVIDER_CREATE);
      await page.getByRole('button', { name: /^Save$/ }).click();
      await expect(page.getByText(PROVIDER_CREATE)).toBeVisible({ timeout: 10_000 });

      // Click the edit (✏️) button on the created row
      const editBtn = page.locator('button').filter({ hasText: '✏️' }).first();
      await expect(editBtn).toBeVisible({ timeout: 5_000 });
      await editBtn.click();

      // The form should be pre-filled with the provider name
      const editProviderInput = page.getByPlaceholder(/Clal, Migdal, Harel/i);
      await expect(editProviderInput).toBeVisible({ timeout: 5_000 });
      await editProviderInput.fill(PROVIDER_EDITED);

      // Save the edit
      await page.getByRole('button', { name: /^Save$/ }).click();

      // Updated provider should appear in the table
      await expect(page.getByText(PROVIDER_EDITED)).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanupHouseholdData(householdId).catch((err: Error) =>
        console.warn(`[wave2-insurance] cleanup warning: ${err.message}`),
      );
    }
  });

  test('delete an insurance policy and verify it disappears @flow', async ({
    testUser: { page, householdId },
  }) => {
    try {
      await page.goto('/insurance', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await expect(
        page.locator('h1').filter({ hasText: /Insurance Policies/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Create a policy to delete
      await page.getByRole('button', { name: /\+ Add Policy/i }).click();
      const providerInput = page.getByPlaceholder(/Clal, Migdal, Harel/i);
      await expect(providerInput).toBeVisible({ timeout: 5_000 });
      await providerInput.fill('E2E Delete Insurance Target');
      await page.getByRole('button', { name: /^Save$/ }).click();
      await expect(page.getByText('E2E Delete Insurance Target')).toBeVisible({ timeout: 10_000 });

      // Accept window.confirm dialog for delete
      page.on('dialog', (dialog) => dialog.accept());

      // Click the delete (🗑️) button
      const deleteBtn = page.locator('button').filter({ hasText: '🗑️' }).first();
      await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
      await deleteBtn.click();

      // Row should disappear
      await expect(
        page.getByText('E2E Delete Insurance Target'),
      ).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await cleanupHouseholdData(householdId).catch((err: Error) =>
        console.warn(`[wave2-insurance] cleanup warning: ${err.message}`),
      );
    }
  });
});
