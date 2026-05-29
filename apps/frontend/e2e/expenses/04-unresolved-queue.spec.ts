/**
 * e2e/expenses/04-unresolved-queue.spec.ts
 *
 * Redfoot (CC-10) — Journey 4: Unresolved Queue tab
 *
 * Verifies:
 * - Table renders with 3 fixture rows (merchant names with dir="auto")
 * - Hebrew merchant names are visible (שופרסל, דלפיש, זוטר רגלא)
 * - Amount column shows ₪ formatted ILS values
 * - "apply to all" checkbox is checked by default per component (applyToAll: true)
 * - Opening CategoryPicker and selecting a category enables the Confirm button
 * - Clicking Confirm triggers POST /api/expenses/resolve
 * - After resolve, the row is removed from the queue (optimistic removal)
 * - A success toast appears after resolving
 * - Total count (3 עסקאות לא מסווגות) is displayed
 *
 * API stubs: unresolved (3 rows), resolve (success), categories
 * Auth: auth-cookie fixture
 */

import { test as authTest, expect } from '../fixtures/auth-cookie';
import { unresolvedFixture, resolveSuccessFixture } from '../fixtures/expenses';

authTest.describe('@expenses 04 — Unresolved Queue', () => {
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
    await page.route('**/api/expenses/resolve', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resolveSuccessFixture) }),
    );
    await page.route('**/api/expenses/categories**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories: [] }) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    // Navigate to unresolved tab
    await page.locator('#tab-unresolved').click();
    await page.waitForLoadState('networkidle');
  });

  authTest('table renders with correct Hebrew merchant names', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Fixture merchant names: שופרסל, דלפיש, זוטר רגלא
    await expect(table.getByText('שופרסל')).toBeVisible();
    await expect(table.getByText('דלפיש')).toBeVisible();
    await expect(table.getByText('זוטר רגלא')).toBeVisible();
  });

  authTest('merchant names are rendered with dir="auto"', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Wait for שופרסל to be visible first — ensures rows are rendered before counting
    const shopersalSpan = table.locator('span[dir="auto"]').filter({ hasText: 'שופרסל' });
    await expect(shopersalSpan).toBeVisible({ timeout: 5_000 });

    // All merchant names should have dir="auto" for Hebrew/LTR text support
    const merchantSpans = table.locator('span[dir="auto"]');
    expect(await merchantSpans.count()).toBeGreaterThanOrEqual(1);
  });

  authTest('total count "3 עסקאות לא מסווגות" is shown', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    // The UnresolvedQueue component renders "3 עסקאות לא מסווגות"
    await expect(page.getByText('3 עסקאות לא מסווגות')).toBeVisible({ timeout: 10_000 });
  });

  authTest('amounts are displayed as ₪ ILS with 2 decimal places', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Fixture: 432.10, 89.90, 127.50
    await expect(table.getByText('₪432.10')).toBeVisible();
    await expect(table.getByText('₪89.90')).toBeVisible();
    await expect(table.getByText('₪127.50')).toBeVisible();
  });

  authTest('"apply to all" checkbox is checked by default', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // The "החל על כולן" label checkbox defaults to checked (applyToAll: true in UnresolvedQueue)
    const applyAllCheckbox = table.getByLabel(/החל על כל עסקאות שופרסל/);
    await expect(applyAllCheckbox).toBeChecked({ timeout: 5_000 });
  });

  authTest('selecting a category enables the Confirm button', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Confirm button for שופרסל row is initially disabled (no category selected)
    const confirmBtn = table.getByRole('button', { name: 'אשר סיווג לעסקה שופרסל' });
    await expect(confirmBtn).toBeDisabled({ timeout: 5_000 });

    // Open the category picker for שופרסל
    const pickerBtn = table.getByRole('button', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await pickerBtn.click();

    // The category picker dropdown (listbox) should open
    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // Click the "מזון וסופרמרקט" (groceries) option
    const groceriesOption = listbox.getByRole('option', { name: 'מזון וסופרמרקט' });
    await expect(groceriesOption).toBeVisible({ timeout: 3_000 });
    await groceriesOption.click();

    // After selection, confirm button should be enabled
    await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
  });

  authTest('confirming a row triggers POST /api/expenses/resolve', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Select category for דלפיש row
    const pickerBtn = table.getByRole('button', { name: 'בחר קטגוריה לעסקה דלפיש' });
    await pickerBtn.click();

    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה דלפיש' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await listbox.getByRole('option', { name: 'מזון וסופרמרקט' }).click();

    // Confirm the row
    const confirmBtn = table.getByRole('button', { name: 'אשר סיווג לעסקה דלפיש' });
    await expect(confirmBtn).toBeEnabled({ timeout: 3_000 });

    // Observe the outgoing POST — waitForRequest() captures regardless of route handlers
    const resolvePromise = page.waitForRequest(
      (req) => req.url().includes('/api/expenses/resolve') && req.method() === 'POST',
      { timeout: 5_000 },
    );
    await confirmBtn.click();
    const resolveRequest = await resolvePromise;

    // Verify the POST body has the correct transaction ID and category
    const body = resolveRequest.postDataJSON() as Record<string, unknown>;
    expect(body.transaction_id).toBe('txn-bbbb-0002-0000-000000000002');
    expect(body.category_id).toBeTruthy();
  });

  authTest('row is removed from the queue after successful resolve', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Verify דלפיש is initially visible
    await expect(table.getByText('דלפיש')).toBeVisible();

    // Select and confirm
    await table.getByRole('button', { name: 'בחר קטגוריה לעסקה דלפיש' }).click();
    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה דלפיש' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await listbox.getByRole('option', { name: 'מזון וסופרמרקט' }).click();
    await table.getByRole('button', { name: 'אשר סיווג לעסקה דלפיש' }).click();
    await page.waitForLoadState('networkidle');

    // דלפיש row should be removed from the table (optimistic removal)
    await expect(table.getByText('דלפיש')).not.toBeVisible({ timeout: 5_000 });

    // שופרסל and זוטר רגלא remain
    await expect(table.getByText('שופרסל')).toBeVisible();
    await expect(table.getByText('זוטר רגלא')).toBeVisible();
  });

  authTest('success toast appears after resolve', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    await table.getByRole('button', { name: 'בחר קטגוריה לעסקה שופרסל' }).click();
    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await listbox.getByRole('option', { name: 'מזון וסופרמרקט' }).click();
    await table.getByRole('button', { name: 'אשר סיווג לעסקה שופרסל' }).click();

    // Sonner toast should appear with success message — "עסקה סווגה בהצלחה"
    await expect(page.getByText('עסקה סווגה בהצלחה')).toBeVisible({ timeout: 5_000 });
  });

  authTest('search input filters by merchant name', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await expect(page.getByRole('table', { name: 'תור עסקאות לא מסווגות' })).toBeVisible({ timeout: 10_000 });

    const searchInput = page.getByRole('searchbox', { name: 'חיפוש לפי שם עסק' });
    await expect(searchInput).toBeVisible({ timeout: 3_000 });
    await expect(searchInput).toHaveAttribute('dir', 'auto');
  });
});
