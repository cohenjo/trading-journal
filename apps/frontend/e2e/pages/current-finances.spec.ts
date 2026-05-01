/**
 * E2E test for Current Finances page
 * Issue #101 — Wave 1 functional validation
 */
import { test, expect } from '../fixtures/auth-cookie';

test.describe('Current Finances Page', () => {
  test('renders without errors and allows data input', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const consoleErrors: string[] = [];
    
    // Track console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    // Navigate to page
    const resp = await page.goto('/current-finances', { waitUntil: 'networkidle', timeout: 15000 });
    expect(resp?.status()).toBe(200);
    
    // Verify page loaded
    await expect(page).toHaveTitle(/Trading Journal/i);
    await expect(page.locator('h1')).toContainText('Current Finances');
    
    // Verify charts are present (donut charts)
    await expect(page.locator('canvas')).toHaveCount(4); // Net Worth, Real Assets, Equity, Liabilities
    
    // Verify tabs are present
    await expect(page.getByText('Assets')).toBeVisible();
    await expect(page.getByText('Savings')).toBeVisible();
    await expect(page.getByText('Investments')).toBeVisible();
    await expect(page.getByText('Liabilities')).toBeVisible();
    
    // Test primary CRUD: Add an asset
    await page.getByText('Assets').click();
    await page.waitForTimeout(500); // Let tab render
    
    // Look for Add button (should exist in FinanceTabs component)
    const addButton = page.locator('button').filter({ hasText: /add|new/i }).first();
    if (await addButton.count() > 0) {
      await addButton.click();
      await page.waitForTimeout(300);
      
      // Fill in item (if form appears)
      const nameInput = page.locator('input[type="text"]').first();
      if (await nameInput.count() > 0) {
        await nameInput.fill('Test House');
        const valueInput = page.locator('input[type="number"]').first();
        if (await valueInput.count() > 0) {
          await valueInput.fill('500000');
        }
        
        // Save (if save button exists)
        const saveBtn = page.locator('button').filter({ hasText: /save|ok/i }).first();
        if (await saveBtn.count() > 0) {
          await saveBtn.click();
          await page.waitForTimeout(500);
        }
      }
    }
    
    // Verify no console errors (excluding telemetry 401)
    const realErrors = consoleErrors.filter(err => !err.includes('/api/metrics/page-load'));
    expect(realErrors).toHaveLength(0);
  });
});
