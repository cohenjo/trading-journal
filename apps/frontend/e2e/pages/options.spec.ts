import { test, expect } from '../fixtures/auth-cookie';

test.describe('Options Page', () => {
  test('renders the Phase 3 dashboard shell for authenticated users', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/options', { waitUntil: 'networkidle', timeout: 15000 });

    expect(page.url()).toContain('/options');
    await expect(page.locator('h1')).toContainText('Options Income Dashboard');
    await expect(page.getByTestId('freshness-badge')).toBeVisible();

    const fatalErrors = consoleErrors.filter((error) =>
      !error.includes('metrics/page-load') &&
      !error.includes('401') &&
      !error.includes('Failed to load resource'),
    );
    expect(fatalErrors).toHaveLength(0);
  });
});
