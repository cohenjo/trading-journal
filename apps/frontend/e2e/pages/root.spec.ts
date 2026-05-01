/**
 * E2E test for Root (/) page
 * Issue #104 — Wave 1 functional validation
 */
import { test, expect } from '../fixtures/auth-cookie';

test.describe('Root Page', () => {
  test('redirects to summary page', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    // Navigate to root
    const resp = await page.goto('/', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Should redirect to /summary
    expect(page.url()).toContain('/summary');
    
    // Verify we landed on a valid page
    await expect(page).toHaveTitle(/Trading Journal/i);
    await expect(page.locator('h1')).toContainText('Income Summary');
  });
});
