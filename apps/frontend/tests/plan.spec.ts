import { test, expect } from '@playwright/test';

test.describe('Financial Plan Page', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/plan');
    await expect(page.getByText('Financial Plan', { exact: true })).toBeVisible();
  });

  test('should render chart and load without error', async ({ page }) => {
    // Check if chart container exists
    const chart = page.locator('.w-full.relative').first();
    await expect(chart).toBeVisible();
  });

  test('should add a milestone without crashing', async ({ page }) => {
    // 1. Switch to Milestones Tab
    await page.getByRole('button', { name: 'Milestones' }).click();
    await expect(page.getByRole('button', { name: 'Milestones' })).toHaveClass(/text-violet-400/);

    const testMilestoneName = `Retirement ${Date.now()}`;
    
    // 2. Handle Prompts
    // prompt 1: Name, prompt 2: Years
    let promptIndex = 0;
    page.on('dialog', async dialog => {
      if (promptIndex === 0) {
          expect(dialog.message()).toContain('Milestone Name');
          await dialog.accept(testMilestoneName);
      } else if (promptIndex === 1) {
          expect(dialog.message()).toContain('Years from now');
          await dialog.accept('10');
      }
      promptIndex++;
    });

    // 3. Click Add Milestone
    // The button text changes based on active tab
    await page.getByRole('button', { name: '+ Add Milestone' }).click();

    // 4. Verify Milestone appears in list
    await expect(page.getByText(testMilestoneName)).toBeVisible();

    // 5. Verify Page didn't crash (Chart still visible)
    // If setMarkers crashed, React error boundary might catch it or page goes blank.
    const chart = page.locator('.w-full.relative').first();
    await expect(chart).toBeVisible();
    
    // Check for chart markers? Hard to check canvas content, but absence of error is good.
    // If the component crashed, the entire React tree often unmounts or shows error.
  });
});
