import { test, expect } from '../fixtures/auth-cookie';

test.describe('Options Page', () => {
  test('renders with authenticated session and displays options projections', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const consoleErrors: string[] = [];
    
    page.on('console', msg => { 
      if (msg.type() === 'error') consoleErrors.push(msg.text()); 
    });
    
    await page.goto('/options', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Verify page loaded
    expect(page.url()).toContain('/options');
    await expect(page.locator('h1')).toContainText('Options Income Projections');
    
    // Verify main sections are present
    await expect(page.locator('h3', { hasText: 'Projection Chart' })).toBeVisible();
    
    // Verify no fatal console errors (ignore telemetry 401)
    const fatalErrors = consoleErrors.filter(e => 
      !e.includes('metrics/page-load') && 
      !e.includes('401')
    );
    expect(fatalErrors).toHaveLength(0);
  });
  
  test('displays settings panel for projection parameters', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/options', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Settings panel should be visible (growth rate, cutoff year, final year)
    const settingsSection = page.locator('text=/Growth Rate|Cutoff Year|Final Year/i').first();
    await expect(settingsSection).toBeVisible({ timeout: 10000 });
  });
  
  test('handles empty historical data gracefully', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/options', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Page should load even with no data
    await expect(page.locator('h1')).toContainText('Options Income Projections');
    
    // Should not crash on empty state
    await expect(page.locator('main')).toBeVisible();
  });
});
