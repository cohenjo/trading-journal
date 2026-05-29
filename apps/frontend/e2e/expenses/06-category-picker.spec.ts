/**
 * e2e/expenses/06-category-picker.spec.ts
 *
 * Redfoot (CC-10) — Journey 6: CategoryPicker hierarchy
 *
 * NOTE: The CategoryPicker component uses the hardcoded EXPENSE_CATEGORIES
 * constant from @/types/expenses rather than the /api/expenses/categories
 * endpoint. The API endpoint (getCategories) exists in the lib layer but
 * is not yet wired into the picker. This is a known gap — tracked as:
 *   TODO(CC-9 / Hockney): Wire GET /api/expenses/categories into CategoryPicker
 *   so categories can be dynamically updated without a code deploy.
 *
 * This spec tests the static CategoryPicker hierarchy as it currently works:
 * - Opens the dropdown
 * - Shows top-level categories from EXPENSE_CATEGORIES (e.g. מזון וסופרמרקט)
 * - Expand arrow shows subcategories (e.g. מסעדות ▼ → משלוחים, מזון מהיר, מסעדות ישיבה)
 * - Search input filters by Hebrew name
 * - Selecting a category closes the picker and shows the selection
 * - Keyboard Escape closes the picker
 *
 * API stubs: unresolved (needed to render the picker in page context)
 * Auth: auth-cookie fixture
 */

import { test as authTest, expect } from '../fixtures/auth-cookie';
import { unresolvedFixture } from '../fixtures/expenses';

authTest.describe('@expenses 06 — CategoryPicker hierarchy', () => {
  authTest.beforeEach(async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/unresolved**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(unresolvedFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-unresolved').click();
    await page.waitForLoadState('networkidle');
  });

  authTest('picker opens and shows top-level category list', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Open picker for the first row (שופרסל)
    await table.getByRole('button', { name: 'בחר קטגוריה לעסקה שופרסל' }).click();

    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // Verify top-level categories from EXPENSE_CATEGORIES are visible
    await expect(listbox.getByRole('option', { name: 'מזון וסופרמרקט' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'מסעדות ומשלוחים' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'בריאות' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'קניות' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'העברות כסף' })).toBeVisible();
  });

  authTest('expanding a category shows its subcategories', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    await table.getByRole('button', { name: 'בחר קטגוריה לעסקה שופרסל' }).click();

    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // The "מסעדות ומשלוחים" category has 3 subcategories; find its expand button
    const expandBtn = listbox.getByRole('button', {
      name: /הרחב תת-קטגוריות של מסעדות ומשלוחים/,
    });
    await expect(expandBtn).toBeVisible({ timeout: 3_000 });
    await expandBtn.click();

    // Subcategories should now appear — use exact:true to avoid matching "מסעדות ומשלוחים"
    await expect(listbox.getByText('משלוחים', { exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(listbox.getByText('מזון מהיר', { exact: true })).toBeVisible();
    await expect(listbox.getByText('מסעדות ישיבה', { exact: true })).toBeVisible();
  });

  authTest('search input filters categories by Hebrew text', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    await table.getByRole('button', { name: 'בחר קטגוריה לעסקה שופרסל' }).click();

    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // The search input is inside the listbox
    const searchInput = listbox.getByRole('textbox', { name: 'חיפוש קטגוריה' });
    await searchInput.fill('דלק');

    // Only "דלק" should remain visible
    await expect(listbox.getByRole('option', { name: 'דלק' })).toBeVisible({ timeout: 3_000 });

    // מזון וסופרמרקט should NOT be visible
    await expect(listbox.getByRole('option', { name: 'מזון וסופרמרקט' })).not.toBeVisible();
  });

  authTest('selecting a category closes the picker and displays the selection', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    const pickerBtn = table.getByRole('button', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await pickerBtn.click();

    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await listbox.getByRole('option', { name: 'מזון וסופרמרקט' }).click();

    // Picker should close
    await expect(listbox).not.toBeVisible({ timeout: 3_000 });

    // The trigger button should now show the selected category name
    await expect(pickerBtn).toContainText('מזון וסופרמרקט');
  });

  authTest('Escape key closes the picker without selecting', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    const pickerBtn = table.getByRole('button', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await pickerBtn.click();

    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');

    await expect(listbox).not.toBeVisible({ timeout: 3_000 });

    // Button should still show placeholder text (no selection made)
    await expect(pickerBtn).toContainText('בחר קטגוריה...');
  });

  authTest('selecting a subcategory shows parent › subcategory display', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    const pickerBtn = table.getByRole('button', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await pickerBtn.click();

    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // Expand restaurants subcategories
    const expandBtn = listbox.getByRole('button', {
      name: /הרחב תת-קטגוריות של מסעדות ומשלוחים/,
    });
    await expandBtn.click();

    // Select "משלוחים" subcategory — exact match avoids hitting "מסעדות ומשלוחים"
    const deliveryOption = listbox.getByRole('option', { name: 'משלוחים', exact: true });
    await expect(deliveryOption).toBeVisible({ timeout: 3_000 });
    await deliveryOption.click();

    // Button should show "מסעדות ומשלוחים › משלוחים"
    await expect(pickerBtn).toContainText('מסעדות ומשלוחים');
    await expect(pickerBtn).toContainText('משלוחים');
  });
});
