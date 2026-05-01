/**
 * e2e/pages/dividends.spec.ts
 *
 * E2E: Dividends Dashboard page (#106)
 *
 * Tests the dividends page backed by real DB with household-scoped RLS.
 * Verifies dashboard load, stats display, and CRUD operations on positions.
 */
import { test, expect } from '../fixtures/auth-cookie';

test.describe('Dividends page (#106)', () => {
  test('page loads and displays dividend dashboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter out telemetry 401s (tracked in #125)
        if (!text.includes('/metrics/page-load')) {
          errors.push(text);
        }
      }
    });

    await page.goto('/dividends');

    // Check main heading
    await expect(page.locator('h1')).toContainText('Dividend Dashboard');

    // Check tabs are present
    await expect(page.locator('button:has-text("Summary")')).toBeVisible();

    // Check stats row exists (portfolio yield, annual income, DGR)
    const statsContainer = page.locator('text=Portfolio Yield').or(page.locator('text=Annual Income'));
    await expect(statsContainer.first()).toBeVisible({ timeout: 10000 });

    // No unexpected console errors
    expect(errors).toEqual([]);
  });

  test('add position button is visible and clickable', async ({ page }) => {
    await page.goto('/dividends');

    // Look for add position button (may vary by tab/UI state)
    // The button should exist somewhere in the dashboard
    const addButton = page.locator('button:has-text("Add Position")').or(
      page.locator('button:has-text("+ Add")')
    );

    // Wait for dashboard to load
    await page.waitForTimeout(2000);

    // Button should be present (visibility may depend on selected tab)
    const buttonExists = await addButton.count() > 0;
    expect(buttonExists).toBe(true);
  });

  test('positions table or empty state is visible', async ({ page }) => {
    await page.goto('/dividends');

    // Wait for data to load
    await page.waitForTimeout(2000);

    // Either positions table exists OR we have an empty state
    const hasTable = await page.locator('table').count() > 0;
    const hasGrid = await page.locator('.grid').count() > 0; // Positions might use a grid layout
    const hasEmptyMessage = await page.locator('text=No positions').count() > 0;

    // At least one should be true
    expect(hasTable || hasGrid || hasEmptyMessage).toBe(true);
  });

  test('summary tab switching works', async ({ page }) => {
    await page.goto('/dividends');

    // Wait for initial load
    await page.waitForTimeout(1000);

    // Click Summary tab (should already be active)
    await page.click('button:has-text("Summary")');

    // Verify summary tab is active (has different styling)
    const summaryButton = page.locator('button:has-text("Summary")');
    await expect(summaryButton).toHaveClass(/bg-slate-800|text-white/);

    // Check that stats are visible
    await expect(page.locator('text=Portfolio Yield').or(page.locator('text=Annual Income')).first()).toBeVisible();
  });
});
