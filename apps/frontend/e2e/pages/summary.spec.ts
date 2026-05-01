/**
 * E2E test for Summary page
 * Issue #102 — Wave 1 functional validation
 */
import { test, expect } from '../fixtures/auth-cookie';

test.describe('Summary Page', () => {
  test('renders without errors and displays income chart', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const consoleErrors: string[] = [];
    
    // Track console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    // Navigate to page
    const resp = await page.goto('/summary', { waitUntil: 'networkidle', timeout: 15000 });
    expect(resp?.status()).toBe(200);
    
    // Verify page loaded
    await expect(page).toHaveTitle(/Trading Journal/i);
    await expect(page.locator('h1')).toContainText('Income Summary');
    
    // Verify chart section is present
    await expect(page.getByText('Projected Income Stacking')).toBeVisible();
    
    // Verify legend items
    await expect(page.getByText('Options')).toBeVisible();
    await expect(page.getByText('Dividends')).toBeVisible();
    await expect(page.getByText('Bond Ladder')).toBeVisible();
    
    // Verify chart canvas exists (lightweight-charts creates canvas)
    await expect(page.locator('canvas')).toHaveCount(1);
    
    // Summary page is read-only dashboard, no CRUD to test
    // Just verify data loads without errors
    await page.waitForTimeout(1000); // Let data settle
    
    // Verify no console errors (excluding telemetry 401)
    const realErrors = consoleErrors.filter(err => !err.includes('/api/metrics/page-load'));
    expect(realErrors).toHaveLength(0);
  });
});
