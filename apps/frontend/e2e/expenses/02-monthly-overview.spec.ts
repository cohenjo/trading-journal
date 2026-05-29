/**
 * e2e/expenses/02-monthly-overview.spec.ts
 *
 * Redfoot (CC-10) — Journey 2: Monthly Overview tab
 *
 * Verifies:
 * - Stacked bar chart renders with the stubbed 3-month data
 * - Chart container has correct aria-label (role="img")
 * - Currency symbol ₪ appears in the Y-axis label area
 * - Date range buttons (3m / 6m / 12m) are present and clickable
 * - Transfers toggle works (label text and checkbox state)
 * - Empty state renders the Hebrew "אין נתונים לתקופה זו" message
 *
 * API stubs: monthly-summary (happy path) + empty state variant
 * Auth: auth-cookie fixture
 */

import { test as authTest, expect } from '../fixtures/auth-cookie';
import {
  monthlySummaryFixture,
  emptyMonthlySummaryFixture,
} from '../fixtures/expenses';

authTest.describe('@expenses 02 — Monthly Overview', () => {
  authTest('chart container renders with stubbed 3-month data', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(monthlySummaryFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    // Monthly tab is active by default; chart container is visible
    const chartContainer = page.getByRole('img', { name: 'גרף הוצאות חודשי לפי קטגוריה' });
    await expect(chartContainer).toBeVisible({ timeout: 10_000 });

    // The SVG should be rendered inside the chart container
    const svg = chartContainer.locator('svg');
    await expect(svg.first()).toBeVisible({ timeout: 5_000 });
  });

  authTest('Y-axis displays ₪ legend', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(monthlySummaryFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    // The Nivo bar chart renders the Y-axis legend as SVG text "₪"
    const chartContainer = page.getByRole('img', { name: 'גרף הוצאות חודשי לפי קטגוריה' });
    await expect(chartContainer).toBeVisible({ timeout: 10_000 });

    // Verify the ₪ axis legend text appears in the SVG
    await expect.poll(
      async () => {
        const axisText = await chartContainer.locator('text').allTextContents();
        return axisText.some((t) => t.includes('₪'));
      },
      { timeout: 5_000, message: 'Expected ₪ axis legend to appear in chart SVG' },
    ).toBe(true);
  });

  authTest('date range buttons are present (3m, 6m, 12m)', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(monthlySummaryFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    const rangeGroup = page.getByRole('group', { name: 'בחר טווח תאריכים' });
    await expect(rangeGroup).toBeVisible({ timeout: 5_000 });

    await expect(page.getByRole('button', { name: '3 חודשים' })).toBeVisible();
    await expect(page.getByRole('button', { name: '6 חודשים' })).toBeVisible();
    await expect(page.getByRole('button', { name: '12 חודשים' })).toBeVisible();
  });

  authTest('transfers toggle checkbox is unchecked by default', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(monthlySummaryFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    const transfersToggle = page.getByLabel('כלול העברות בסה״כ');
    await expect(transfersToggle).toBeVisible({ timeout: 5_000 });
    await expect(transfersToggle).not.toBeChecked();
  });

  authTest('toggling transfers checkbox re-fetches data', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(monthlySummaryFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    // Use waitForRequest + click in parallel to avoid the networkidle race condition:
    // React state updates are async, so networkidle may resolve before the re-fetch starts.
    const [refetchRequest] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().includes('/api/expenses/monthly-summary') && req.method() === 'GET',
        { timeout: 5_000 },
      ),
      page.getByLabel('כלול העברות בסה״כ').click(),
    ]);

    // Toggling includes transfers → exclude_transfers=false in the re-fetch
    expect(refetchRequest.url()).toContain('exclude_transfers=false');
  });

  authTest('empty state shows "אין נתונים לתקופה זו"', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyMonthlySummaryFixture),
      }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('אין נתונים לתקופה זו')).toBeVisible({ timeout: 10_000 });

    // Chart container should NOT be present when empty
    const chartContainer = page.getByRole('img', { name: 'גרף הוצאות חודשי לפי קטגוריה' });
    await expect(chartContainer).not.toBeVisible();
  });
});
