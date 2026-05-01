import { test, expect } from '../fixtures/auth-cookie';

test.describe('Backtest Page', () => {
  test('renders with authenticated session and allows backtest configuration', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const consoleErrors: string[] = [];
    
    page.on('console', msg => { 
      if (msg.type() === 'error') consoleErrors.push(msg.text()); 
    });
    
    await page.goto('/backtest', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Verify page loaded
    expect(page.url()).toContain('/backtest');
    await expect(page.locator('h1')).toContainText('Strategy Backtest');
    
    // Verify controls are present
    await expect(page.locator('select').first()).toBeVisible();
    await expect(page.locator('button', { hasText: 'Run Backtest' })).toBeVisible();
    
    // Check for strategy dropdown
    const strategySelect = page.locator('select').filter({ hasText: 'Iron Condor' });
    await expect(strategySelect).toBeVisible();
    
    // Verify no fatal console errors (ignore telemetry 401)
    const fatalErrors = consoleErrors.filter(e => 
      !e.includes('metrics/page-load') && 
      !e.includes('401')
    );
    expect(fatalErrors).toHaveLength(0);
  });
  
  test('handles empty state gracefully', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/backtest', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Even with no data, controls should be present
    await expect(page.locator('button', { hasText: 'Run Backtest' })).toBeVisible();
    
    // Should not show error state on initial load
    await expect(page.locator('text=/Error:/i')).not.toBeVisible();
  });
});
