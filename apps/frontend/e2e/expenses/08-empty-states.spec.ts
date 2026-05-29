/**
 * e2e/expenses/08-empty-states.spec.ts
 *
 * Redfoot (CC-10) — Journey 8: Empty state scenarios
 *
 * Verifies all empty-state UX messages are shown correctly when APIs return
 * empty data (not errors — graceful zero-data states):
 *
 * - Monthly summary `[]` → "אין נתונים לתקופה זו" (MonthlyOverview)
 * - Unresolved `{items: [], total: 0}` → "🎉 כל העסקאות מסווגות!" (UnresolvedQueue)
 * - Statements `{items: [], total: 0}` → "לא נמצאו דפי חשבון..." (StatementsList)
 * - By Category with no data for selected month → "אין נתונים לחודש זה" (CategoryPie)
 *
 * Auth: auth-cookie fixture
 */

import { test as authTest, expect } from '../fixtures/auth-cookie';
import {
  emptyMonthlySummaryFixture,
  unresolvedEmptyFixture,
  statementsEmptyFixture,
} from '../fixtures/expenses';

authTest.describe('@expenses 08 — Empty states', () => {
  authTest('monthly-summary empty → "אין נתונים לתקופה זו"', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyMonthlySummaryFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('אין נתונים לתקופה זו')).toBeVisible({ timeout: 10_000 });
    // Chart should not appear
    await expect(page.getByRole('img', { name: 'גרף הוצאות חודשי לפי קטגוריה' })).not.toBeVisible();
  });

  authTest('unresolved queue empty → "🎉 כל העסקאות מסווגות!"', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/unresolved**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(unresolvedEmptyFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-unresolved').click();
    await page.waitForLoadState('networkidle');

    // UnresolvedQueue renders "🎉 כל העסקאות מסווגות!" when items is empty and no search
    await expect(page.getByText('כל העסקאות מסווגות!')).toBeVisible({ timeout: 10_000 });
  });

  authTest('statements empty → upload prompt', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/statements**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statementsEmptyFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-statements').click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('לא נמצאו דפי חשבון. העלה PDF כדי להתחיל.')).toBeVisible({ timeout: 10_000 });
    // Table should not render
    await expect(page.getByRole('table', { name: 'דפי חשבון אשראי' })).not.toBeVisible();
  });

  authTest('by-category empty for selected month → "אין נתונים לחודש זה"', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    // Return data for 2026-03 only; the page defaults to 2026-05 (currentMonth())
    // So the pie will find no data for 2026-05 → empty state
    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { month: '2026-03', category_slug: 'groceries', category_name: 'Groceries', category_name_he: 'מזון וסופרמרקט', amount_ils: 500, txn_count: 3 },
        ]),
      }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-by-category').click();
    await page.waitForLoadState('networkidle');

    // The pie defaults to current month (2026-05 hardcoded in page.tsx) which has no data
    // CategoryPie renders "אין נתונים לחודש זה" when pieData is empty
    await expect(page.getByText('אין נתונים לחודש זה')).toBeVisible({ timeout: 10_000 });
  });

  authTest('unresolved empty count shows "0 עסקאות לא מסווגות"', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/unresolved**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(unresolvedEmptyFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-unresolved').click();
    await page.waitForLoadState('networkidle');

    // Component renders the total count from the API response
    await expect(page.getByText('0 עסקאות לא מסווגות')).toBeVisible({ timeout: 10_000 });
  });
});
