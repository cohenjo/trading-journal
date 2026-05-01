import { test, expect } from '../fixtures/auth-cookie';

test.describe('Progress Page', () => {
  test('renders page with empty state gracefully', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/progress', { waitUntil: 'networkidle' });
    
    // Check page loaded
    await expect(page.locator('h1')).toContainText(/Progress/i);
    
    // Check that net worth display exists (even if 0)
    await expect(page.locator('text=/Net Worth/i')).toBeVisible();
    
    // Check add button exists
    await expect(page.locator('button:has-text("Add Historic Record"), button:has-text("Add")')).toBeVisible();
    
    // Verify no console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
        errors.push(msg.text());
      }
    });
    
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });
  
  test('can open add history modal', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/progress');
    
    // Click add button
    await page.click('button:has-text("Add Historic Record"), button:has-text("Add")');
    await page.waitForTimeout(500);
    
    // Check if modal opened
    const modal = page.locator('[role="dialog"], div[class*="modal"]');
    await expect(modal).toBeVisible();
  });
  
  test('displays net worth history chart when data exists', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/progress');
    await page.waitForTimeout(1000);
    
    // Check for chart section
    const chartSection = page.locator('text=/Net Worth History/i');
    await expect(chartSection).toBeVisible();
    
    // Chart should either show data or "No data to display"
    const hasChart = await page.locator('canvas, svg').count() > 0;
    const hasEmptyMessage = await page.locator('text=/No data to display/i').count() > 0;
    expect(hasChart || hasEmptyMessage).toBe(true);
  });
  
  test('shows progress table', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/progress');
    
    // Check for table heading
    await expect(page.locator('text=/Progress Points/i')).toBeVisible();
    
    // Table should exist (even if empty)
    const hasTable = await page.locator('table, div[role="table"]').count() > 0;
    expect(hasTable).toBe(true);
  });
});
