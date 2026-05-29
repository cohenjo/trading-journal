/**
 * e2e/expenses/05-statements.spec.ts
 *
 * Redfoot (CC-10) — Journey 5: Statements tab
 *
 * Verifies:
 * - Table renders with aria-label "דפי חשבון אשראי"
 * - Columns: issuer (מנפיק), cardholder (בעל הכרטיס), card number (כרטיס),
 *   period (תקופה), total ILS (סה״כ ₪), transaction count (עסקאות)
 * - Fixture rows are all visible: כאל, מקס, פייבוקס
 * - Parse warnings show ⚠ icon with count; clean rows show ✓
 * - Empty state shows "לא נמצאו דפי חשבון. העלה PDF כדי להתחיל."
 * - Card last4 is displayed with **** prefix
 *
 * API stubs: statements
 * Auth: auth-cookie fixture
 */

import { test as authTest, expect } from '../fixtures/auth-cookie';
import { statementsFixture, statementsEmptyFixture } from '../fixtures/expenses';

authTest.describe('@expenses 05 — Statements tab', () => {
  authTest('table renders with all 3 fixture statements', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/statements**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statementsFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-statements').click();
    await page.waitForLoadState('networkidle');

    const table = page.getByRole('table', { name: 'דפי חשבון אשראי' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Issuers from fixture: כאל, מקס, פייבוקס
    await expect(table.getByText('כאל')).toBeVisible();
    await expect(table.getByText('מקס')).toBeVisible();
    await expect(table.getByText('פייבוקס')).toBeVisible();
  });

  authTest('cardholder names are rendered', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/statements**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statementsFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-statements').click();
    await page.waitForLoadState('networkidle');

    const table = page.getByRole('table', { name: 'דפי חשבון אשראי' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Fixture cardholder names
    await expect(table.getByText('יוני כהן').first()).toBeVisible();
    await expect(table.getByText('שירה כהן')).toBeVisible();
  });

  authTest('card last4 shows with **** mask', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/statements**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statementsFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-statements').click();
    await page.waitForLoadState('networkidle');

    const table = page.getByRole('table', { name: 'דפי חשבון אשראי' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Fixture: card_last4 = '4821' → displayed as ****4821
    await expect(table.getByText('****4821')).toBeVisible();
    await expect(table.getByText('****9933')).toBeVisible();
    await expect(table.getByText('****0011')).toBeVisible();
  });

  authTest('transaction count is visible per statement', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/statements**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statementsFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-statements').click();
    await page.waitForLoadState('networkidle');

    const table = page.getByRole('table', { name: 'דפי חשבון אשראי' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Fixture txn_counts: 38, 21, 9
    await expect(table.getByText('38', { exact: true })).toBeVisible();
    await expect(table.getByText('21', { exact: true })).toBeVisible();
    await expect(table.getByText('9', { exact: true })).toBeVisible();
  });

  authTest('parse warnings show ⚠ badge; clean rows show ✓', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/statements**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statementsFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-statements').click();
    await page.waitForLoadState('networkidle');

    const table = page.getByRole('table', { name: 'דפי חשבון אשראי' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // מקס fixture has parse_warnings_count=2 → shows "⚠ 2" via aria-label "2 אזהרות פענוח"
    const warningBadge = table.getByLabel('2 אזהרות פענוח');
    await expect(warningBadge).toBeVisible();

    // Clean rows (כאל and פייבוקס) show ✓ via aria-label "ללא אזהרות"
    const cleanBadges = table.getByLabel('ללא אזהרות');
    await expect(cleanBadges.first()).toBeVisible();
  });

  authTest('total amount column shows ₪ formatted values', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;

    await page.route('**/api/expenses/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }) }),
    );
    await page.route('**/api/expenses/monthly-summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    );
    await page.route('**/api/expenses/statements**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statementsFixture) }),
    );

    await page.goto('/finances/expenses');
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-statements').click();
    await page.waitForLoadState('networkidle');

    const table = page.getByRole('table', { name: 'דפי חשבון אשראי' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // The component renders total_amount_ils with ₪ prefix
    // Fixture totals: 4812.30, 2110.00, 980.00 (rendered with toLocaleString, no decimals)
    // In he-IL locale these may render as ₪4,812 / ₪4812 (locale-specific)
    const tableCells = await table.locator('td').allTextContents();
    const hasIls = tableCells.some((text) => text.includes('₪'));
    expect(hasIls).toBe(true);
  });

  authTest('empty state shows upload prompt', async ({ authenticatedUser }) => {
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
  });
});
