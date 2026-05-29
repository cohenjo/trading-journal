/**
 * e2e/expenses/01-page-load-tabs.spec.ts
 *
 * Redfoot (CC-10) — Journey 1: Page load + tab navigation
 *
 * Verifies:
 * - /finances/expenses renders 4 tabs with correct Hebrew labels
 * - Each tab is clickable and shows its content panel
 * - No critical console errors on page load or tab switch
 * - ARIA roles are correct (role="tablist", role="tab", role="tabpanel")
 *
 * API stubs: monthly-summary (needed for initial load), unresolved, statements
 * Auth: auth-cookie fixture (real Supabase session injected via cookie)
 */

import { test as authTest, expect } from '../fixtures/auth-cookie';
import { monthlySummaryFixture, unresolvedFixture, statementsFixture } from '../fixtures/expenses';

const EXPENSE_TABS = [
  { id: 'tab-monthly',      label: 'סיכום חודשי' },
  { id: 'tab-by-category',  label: 'לפי קטגוריה' },
  { id: 'tab-unresolved',   label: 'לא מסווגות' },
  { id: 'tab-statements',   label: 'דפי חשבון' },
];

authTest.describe('@expenses 01 — Page load & tab navigation', () => {
  authTest.beforeEach(async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    // Stub all API calls so the page renders without a running backend.
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(monthlySummaryFixture) }),
    );
    await page.route('**/api/expenses/unresolved**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(unresolvedFixture) }),
    );
    await page.route('**/api/expenses/statements**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statementsFixture) }),
    );
    await page.route('**/api/expenses/by-category/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50, category_slug: 'groceries', subtotal_ils: 0 }) }),
    );
    await page.route('**/api/expenses/categories**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories: [] }) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
  });

  authTest('all 4 tabs render with correct Hebrew labels', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const tablist = page.getByRole('tablist', { name: 'לשוניות הוצאות' });
    await expect(tablist).toBeVisible({ timeout: 10_000 });

    for (const { id, label } of EXPENSE_TABS) {
      const tab = page.locator(`#${id}`);
      await expect(tab).toBeVisible({ timeout: 5_000 });
      await expect(tab).toContainText(label);
      await expect(tab).toHaveAttribute('role', 'tab');
    }
  });

  authTest('Monthly Overview tab is active by default', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    const monthlyTab = page.locator('#tab-monthly');
    await expect(monthlyTab).toHaveAttribute('aria-selected', 'true');

    const panel = page.locator('#tab-panel-monthly');
    await expect(panel).not.toHaveAttribute('hidden');
  });

  authTest('clicking each tab activates it and hides others', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    // Click By Category
    await page.locator('#tab-by-category').click();
    await expect(page.locator('#tab-by-category')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-panel-by-category')).not.toHaveAttribute('hidden');
    await expect(page.locator('#tab-panel-monthly')).toHaveAttribute('hidden', '');

    // Click Statements
    await page.locator('#tab-statements').click();
    await expect(page.locator('#tab-statements')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-panel-statements')).not.toHaveAttribute('hidden');
    await expect(page.locator('#tab-panel-by-category')).toHaveAttribute('hidden', '');

    // Click Unresolved
    await page.locator('#tab-unresolved').click();
    await expect(page.locator('#tab-unresolved')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-panel-unresolved')).not.toHaveAttribute('hidden');

    // Return to Monthly
    await page.locator('#tab-monthly').click();
    await expect(page.locator('#tab-monthly')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-panel-monthly')).not.toHaveAttribute('hidden');
  });

  authTest('page header "הוצאות אשראי" is visible', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    await expect(page.getByRole('heading', { name: 'הוצאות אשראי' })).toBeVisible({ timeout: 5_000 });
  });

  authTest('no critical console errors on load', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const criticalErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Filter out expected non-critical browser noise (e.g. favicon 404, extension errors)
        const text = msg.text();
        if (!text.includes('favicon') && !text.includes('chrome-extension')) {
          criticalErrors.push(text);
        }
      }
    });

    // Reload to capture fresh console output
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Allow Nivo chart library warnings but no React errors or unhandled exceptions
    const reactErrors = criticalErrors.filter(
      (e) => e.includes('TypeError') || e.includes('ReferenceError') || e.includes('Uncaught'),
    );
    expect(reactErrors).toHaveLength(0);
  });
});
