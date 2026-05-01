import { test, expect } from '../fixtures/auth-cookie';

test.describe('Tax Condor Page', () => {
  test('renders with authenticated session and displays recommender form', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const consoleErrors: string[] = [];
    
    page.on('console', msg => { 
      if (msg.type() === 'error') consoleErrors.push(msg.text()); 
    });
    
    await page.goto('/tax-condor', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Verify page loaded
    expect(page.url()).toContain('/tax-condor');
    await expect(page.locator('h1')).toContainText('Tax Condor Recommender');
    
    // Verify input controls are present
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await expect(page.locator('input[type="number"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Get Recommendations' })).toBeVisible();
    
    // Verify no fatal console errors (ignore telemetry 401)
    const fatalErrors = consoleErrors.filter(e => 
      !e.includes('metrics/page-load') && 
      !e.includes('401')
    );
    expect(fatalErrors).toHaveLength(0);
  });
  
  test('allows user to input symbol and budget', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/tax-condor', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Verify default values are set
    const symbolInput = page.locator('input[type="text"]').first();
    await expect(symbolInput).toHaveValue('NDX');
    
    const budgetInput = page.locator('input[type="number"]');
    await expect(budgetInput).toHaveValue('2000');
    
    // User can change values
    await symbolInput.fill('SPX');
    await expect(symbolInput).toHaveValue('SPX');
    
    await budgetInput.fill('3000');
    await expect(budgetInput).toHaveValue('3000');
  });
  
  test('handles empty recommendations state', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/tax-condor', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Before fetching, should show empty state message
    await expect(page.locator('text=/No recommendations found/i')).toBeVisible({ timeout: 5000 });
  });
  
  test('supports live data toggle', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/tax-condor', { waitUntil: 'networkidle', timeout: 15000 });
    
    const liveDataCheckbox = page.locator('input[type="checkbox"]#useLiveData');
    await expect(liveDataCheckbox).toBeVisible();
    
    // Should be unchecked by default
    await expect(liveDataCheckbox).not.toBeChecked();
    
    // User can toggle it
    await liveDataCheckbox.check();
    await expect(liveDataCheckbox).toBeChecked();
  });
});
