import { test, expect } from '@playwright/test';

test.describe('Plan Page', () => {
  test('should load with Server Action simulation', async ({ page }) => {
    const legacyPlanApiCalls: string[] = [];
    page.on('request', request => {
      const url = request.url();
      if (url.includes('/api/plans/')) legacyPlanApiCalls.push(url);
    });

    await page.goto('/plan');

    expect(legacyPlanApiCalls).toHaveLength(0);
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
