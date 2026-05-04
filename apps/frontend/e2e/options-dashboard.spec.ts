import { test, expect } from './fixtures/test-user';
import { cleanupHouseholdData, seedOptionsDashboard } from './fixtures/seed-data';

test.describe('Options Income Dashboard Phase 3', () => {
  test('renders all dashboard widgets from cooked Supabase tables', async ({ testUser: { page, householdId } }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await seedOptionsDashboard(householdId);

    try {
      await page.goto('/options', { waitUntil: 'networkidle', timeout: 20_000 });

      await expect(page.getByRole('heading', { name: /Options Income Dashboard/i })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('freshness-badge')).toBeVisible();
      await expect(page.getByTestId('variance-gap-badge')).toBeVisible();
      await expect(page.getByTestId('efficiency-gauges')).toContainText('Pending — Phase 4');
      await expect(page.getByTestId('net-cash-flow-chart')).toBeVisible();
      await expect(page.getByTestId('trade-lifecycle-timeline')).toBeVisible();
      await expect(page.getByTestId('roll-efficiency-donut')).toBeVisible();
      await expect(page.getByText(/Neutral = realized P&L within ±\$25/)).toBeVisible();

      const critical = consoleErrors.filter((message) =>
        !message.includes('metrics/page-load') &&
        !message.includes('401') &&
        !message.includes('Failed to load resource'),
      );
      expect(critical).toHaveLength(0);
    } finally {
      await cleanupHouseholdData(householdId);
    }
  });
});
