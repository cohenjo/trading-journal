
import { test, expect } from '@playwright/test';

test.describe('Cash Flow Page', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to Cash Flow page
    await page.goto('/cash-flow');
  });

  test('should render chart and load without runtime error', async ({ page }) => {
    // 1. Verify Header
    await expect(page.getByText('Cash Flow Analysis', { exact: true })).toBeVisible();

    // 2. Verify Chart Loading (The Sankey component)
    // We expect the chart container to be visible.
    // The class is h-[600px] w-full
    const chartContainer = page.locator('.h-\\[600px\\].w-full');
    await expect(chartContainer).toBeVisible();
  });

  test('should interact with the Year slider', async ({ page }) => {
    // Verify current year is displayed in header/title area (Large font)
    const currentYear = new Date().getFullYear().toString();
    // Use locator for the specific styling of the main year display
    await expect(page.locator('.text-3xl.font-mono').getByText(currentYear)).toBeVisible();

    // Verify slider exists
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();
    
    // Change value (this triggers state update and re-render of Sankey)
    // Moving to next year
    const nextYear = (new Date().getFullYear() + 1).toString();
    await slider.fill(nextYear);
    
    // Verify Text Update
    await expect(page.locator('.text-3xl.font-mono').getByText(nextYear)).toBeVisible();
    
    // Verify chart is still visible
    const chartContainer = page.locator('.h-\\[600px\\].w-full');
    await expect(chartContainer).toBeVisible();
  });
});
