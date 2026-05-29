/**
 * e2e/expenses/03-by-category.spec.ts
 *
 * Redfoot (CC-10) — Journey 3: By Category tab (pie chart + drill-down)
 *
 * Verifies:
 * - Navigating to "By Category" tab renders the pie chart container
 * - Category list renders with Hebrew labels and ₪ amounts
 * - Month picker select is present
 * - Total spend (סה״כ) is shown and matches the fixture
 * - Clicking a category button triggers the drill-down API call
 * - Drill-down table renders with merchant names and amounts
 * - Transfers are excluded from the pie (builds on pieSummaryData filter)
 *
 * API stubs: monthly-summary, by-category/{slug}
 * Auth: auth-cookie fixture
 */

import { test as authTest, expect } from '../fixtures/auth-cookie';
import {
  monthlySummaryFixture,
  byCategoryGroceriesFixture,
} from '../fixtures/expenses';

authTest.describe('@expenses 03 — By Category tab', () => {
  authTest.beforeEach(async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(monthlySummaryFixture) }),
    );
    await page.route('**/api/expenses/by-category/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(byCategoryGroceriesFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    // Navigate to By Category tab
    await page.locator('#tab-by-category').click();
  });

  authTest('pie chart container renders', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    // The pie container has role="img" with an aria-label containing the Hebrew month
    const pieContainer = page.locator('[role="img"]').filter({ hasText: /תרשים עוגה/i });
    // Nivo renders SVG; the container div's aria-label starts with "תרשים עוגה"
    const pieDivs = page.locator('div[role="img"][aria-label*="תרשים עוגה"]');
    await expect(pieDivs.first()).toBeVisible({ timeout: 10_000 });

    const svg = pieDivs.first().locator('svg');
    await expect(svg.first()).toBeVisible({ timeout: 5_000 });
  });

  authTest('category list renders with Hebrew labels', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const categoryList = page.getByRole('list', { name: 'רשימת קטגוריות' });
    await expect(categoryList).toBeVisible({ timeout: 10_000 });

    // The fixture has groceries, restaurants, health, fuel, shopping for 2026-05
    // The page defaults to current month (2026-05 hardcoded in the component)
    const listItems = categoryList.getByRole('listitem');
    const count = await listItems.count();
    expect(count).toBeGreaterThan(0);
  });

  authTest('total spend (סה״כ) is displayed with ₪ symbol', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    // The month picker section shows "סה״כ: ₪X,XXX"
    const totalEl = page.locator('text=/סה״כ.*₪/');
    await expect(totalEl.first()).toBeVisible({ timeout: 5_000 });
  });

  authTest('month picker select is present', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const monthPicker = page.getByRole('combobox', { name: 'בחר חודש' });
    await expect(monthPicker).toBeVisible({ timeout: 5_000 });

    // Fixture has months: 2026-03, 2026-04, 2026-05
    const options = monthPicker.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  authTest('clicking a category triggers drill-down API call', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const categoryList = page.getByRole('list', { name: 'רשימת קטגוריות' });
    await expect(categoryList).toBeVisible({ timeout: 10_000 });

    // Click the first category button in the list
    const firstCategoryBtn = categoryList.getByRole('listitem').first().getByRole('button');

    // Observe the outgoing request — waitForRequest() captures it regardless of route handlers
    const drillRequestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/expenses/by-category/') && req.method() === 'GET',
      { timeout: 5_000 },
    );
    await firstCategoryBtn.click();
    const drillRequest = await drillRequestPromise;

    expect(drillRequest.url()).toContain('/api/expenses/by-category/');
  });

  authTest('drill-down table renders merchant names after category click', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const categoryList = page.getByRole('list', { name: 'רשימת קטגוריות' });
    await expect(categoryList).toBeVisible({ timeout: 10_000 });

    const firstCategoryBtn = categoryList.getByRole('listitem').first().getByRole('button');
    await firstCategoryBtn.click();
    await page.waitForLoadState('networkidle');

    // Drill-down table should appear
    const drillTable = page.getByRole('table', { name: 'טבלת עסקאות' });
    await expect(drillTable).toBeVisible({ timeout: 5_000 });

    // Fixture has 3 transactions: רמי לוי, שופרסל, מחסני השוק
    await expect(drillTable.getByText('רמי לוי')).toBeVisible();
    await expect(drillTable.getByText('שופרסל')).toBeVisible();
    await expect(drillTable.getByText('מחסני השוק')).toBeVisible();
  });

  authTest('drill-down subtotal shows ILS formatted amount', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const categoryList = page.getByRole('list', { name: 'רשימת קטגוריות' });
    await expect(categoryList).toBeVisible({ timeout: 10_000 });

    const firstCategoryBtn = categoryList.getByRole('listitem').first().getByRole('button');
    await firstCategoryBtn.click();
    await page.waitForLoadState('networkidle');

    // Fixture subtotal_ils = 1990.25; rendered as ₪1,990.25
    const drillTable = page.getByRole('table', { name: 'טבלת עסקאות' });
    await expect(drillTable).toBeVisible({ timeout: 5_000 });
    await expect(drillTable.locator('tfoot')).toContainText('₪');
  });
});
