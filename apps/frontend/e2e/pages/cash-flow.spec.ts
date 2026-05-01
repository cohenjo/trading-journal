/**
 * E2E test for Cash Flow page
 * Issue #103 — Wave 1 functional validation
 */
import { test, expect } from '../fixtures/auth-cookie';

test.describe('Cash Flow Page', () => {
  test('renders without errors and year slider works', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const consoleErrors: string[] = [];
    
    // Track console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    // Navigate to page
    const resp = await page.goto('/cash-flow', { waitUntil: 'networkidle', timeout: 15000 });
    expect(resp?.status()).toBe(200);
    
    // Verify page loaded
    await expect(page).toHaveTitle(/Trading Journal/i);
    await expect(page.locator('h1')).toContainText('Cash Flow Analysis');
    
    // Verify year display is present
    const currentYear = new Date().getFullYear();
    await expect(page.getByText(currentYear.toString())).toBeVisible();
    
    // Verify slider exists and is interactive
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();
    
    // Test slider interaction
    const initialValue = await slider.inputValue();
    await slider.fill((currentYear + 5).toString());
    await page.waitForTimeout(500); // Let simulation run
    
    // Verify summary cards are present
    await expect(page.getByText('Total Inflow')).toBeVisible();
    await expect(page.getByText('Spending')).toBeVisible();
    await expect(page.getByText('Taxes')).toBeVisible();
    await expect(page.getByText('Net Savings')).toBeVisible();
    
    // Verify Sankey chart area exists
    const sankeyContainer = page.locator('.max-w-6xl').first();
    await expect(sankeyContainer).toBeVisible();
    
    // Verify no console errors (excluding telemetry 401)
    const realErrors = consoleErrors.filter(err => !err.includes('/api/metrics/page-load'));
    expect(realErrors).toHaveLength(0);
  });
});
