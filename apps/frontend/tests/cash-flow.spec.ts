import { test, expect } from '@playwright/test';

test.describe('Cash Flow Page', () => {
  test('should load without legacy plan API calls', async ({ page }) => {
    const legacyPlanApiCalls: string[] = [];
    page.on('request', request => {
      const url = request.url();
      if (url.includes('/api/plans/')) legacyPlanApiCalls.push(url);
    });

    await page.goto('/cash-flow');

    expect(legacyPlanApiCalls).toHaveLength(0);
    await expect(page.locator('h1')).toContainText('Cash Flow Analysis');
  });
});
