/**
 * e2e/expenses/07-error-handling.spec.ts
 *
 * Redfoot (CC-10) — Journey 7: Error handling
 *
 * Verifies graceful degradation when API endpoints return errors:
 * - Monthly summary 500 → error message rendered, no white screen
 * - Statements 500 → error message in the statements panel
 * - Unresolved 500 → error toast from the UnresolvedQueue component
 * - POST resolve 500 → error toast "שגיאה בשמירת הסיווג"
 * - No unhandled React exceptions (no white screen / Error Boundary)
 *
 * Auth: auth-cookie fixture
 */

import { test as authTest, expect } from '../fixtures/auth-cookie';
import { unresolvedFixture } from '../fixtures/expenses';

authTest.describe('@expenses 07 — Error handling', () => {
  authTest('monthly-summary 500 → shows error message, not white screen', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal Server Error' }) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    // The page renders an inline error (⚠️ שגיאה בטעינת נתוני ההוצאות) per page.tsx
    await expect(page.getByText('שגיאה בטעינת נתוני ההוצאות')).toBeVisible({ timeout: 10_000 });

    // Page body should have meaningful content — not a blank page
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
  });

  authTest('statements 500 → shows error text in statements panel', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/statements**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal Server Error' }) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-statements').click();
    await page.waitForLoadState('networkidle');

    // StatementsList renders "שגיאה בטעינת הדפי חשבון" on fetch error
    await expect(page.getByText('שגיאה בטעינת הדפי חשבון')).toBeVisible({ timeout: 10_000 });
  });

  authTest('unresolved 500 → error toast "שגיאה בטעינת העסקאות"', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/unresolved**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal Server Error' }) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-unresolved').click();
    await page.waitForLoadState('networkidle');

    // UnresolvedQueue uses toast.error("שגיאה בטעינת העסקאות") on fetch failure
    await expect(page.getByText('שגיאה בטעינת העסקאות')).toBeVisible({ timeout: 10_000 });
  });

  authTest('resolve POST 500 → error toast "שגיאה בשמירת הסיווג"', async ({ authenticatedUser }) => {
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
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal Server Error' }) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-unresolved').click();
    await page.waitForLoadState('networkidle');

    const table = page.getByRole('table', { name: 'תור עסקאות לא מסווגות' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Select category and attempt confirm
    await table.getByRole('button', { name: 'בחר קטגוריה לעסקה שופרסל' }).click();
    const listbox = page.getByRole('listbox', { name: 'בחר קטגוריה לעסקה שופרסל' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await listbox.getByRole('option', { name: 'מזון וסופרמרקט' }).click();
    await table.getByRole('button', { name: 'אשר סיווג לעסקה שופרסל' }).click();

    // Error toast should appear
    await expect(page.getByText('שגיאה בשמירת הסיווג')).toBeVisible({ timeout: 5_000 });

    // Row should NOT be removed on error (optimistic removal only on success)
    await expect(table.getByText('שופרסל')).toBeVisible({ timeout: 3_000 });
  });

  authTest('page body is non-empty even when all API calls fail', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    // Fail everything
    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Server Error' }) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    // Page title should still render
    await expect(page.getByRole('heading', { name: 'הוצאות אשראי' })).toBeVisible({ timeout: 10_000 });

    // Tabs should still render (they don't depend on API data)
    await expect(page.locator('#tab-monthly')).toBeVisible();
    await expect(page.locator('#tab-unresolved')).toBeVisible();
    await expect(page.locator('#tab-statements')).toBeVisible();

    // No blank white screen — body has content
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(50);
  });
});
