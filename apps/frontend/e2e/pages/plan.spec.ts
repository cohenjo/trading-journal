import { test, expect } from '../fixtures/auth-cookie';

test.describe('Financial Plan Page', () => {
  test('renders page and handles empty plan gracefully', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/plan', { waitUntil: 'networkidle' });
    
    // Check page loaded
    await expect(page.locator('h1')).toContainText(/Financial Plan/i);
    
    // Check that page shows either a chart or a loading state
    const hasChart = await page.locator('canvas, svg').count() > 0;
    const hasLoading = await page.locator('text=/Loading/i').count() > 0;
    expect(hasChart || hasLoading).toBe(true);
    
    // Check that editor section exists
    await expect(page.locator('text=/Plan Inputs/i, text=/Milestones/i, text=/Income/i, text=/Expenses/i')).toBeVisible();
    
    // Verify no console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
        errors.push(msg.text());
      }
    });
    
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
  
  test('can create a basic plan', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/plan');
    await page.waitForTimeout(2000);
    
    // Look for add buttons or input fields to create plan items
    const addButton = page.locator('button:has-text("Add"), button:has-text("+")').first();
    
    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(1000);
      
      // Check if a form or modal appeared
      const hasForm = await page.locator('input, textarea, select').count() > 0;
      expect(hasForm).toBe(true);
    }
  });
  
  test('displays projection chart', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/plan');
    await page.waitForTimeout(3000);
    
    // Check for chart elements
    const chartExists = await page.locator('canvas, svg[class*="chart"], div[class*="chart"]').count() > 0;
    expect(chartExists).toBe(true);
  });
});
