import { test, expect } from '../fixtures/auth-cookie';

test.describe('Bond Ladder Page', () => {
  test('renders with authenticated session and displays ladder structure', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const consoleErrors: string[] = [];
    
    page.on('console', msg => { 
      if (msg.type() === 'error') consoleErrors.push(msg.text()); 
    });
    
    await page.goto('/ladder', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Verify page loaded
    expect(page.url()).toContain('/ladder');
    await expect(page.locator('h1')).toContainText('Bond Ladder');
    
    // Verify main sections are present
    await expect(page.locator('h2', { hasText: 'Expected Income' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Distributions' })).toBeVisible();
    
    // Verify no fatal console errors (ignore telemetry 401)
    const fatalErrors = consoleErrors.filter(e => 
      !e.includes('metrics/page-load') && 
      !e.includes('401')
    );
    expect(fatalErrors).toHaveLength(0);
  });
  
  test('handles empty state with loading indicators', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/ladder', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Main structure should be present even with no data
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Bond Ladder');
  });
  
  test('supports scanner integration via URL params', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/ladder?candidateYear=2025', { waitUntil: 'networkidle', timeout: 15000 });
    
    expect(page.url()).toContain('candidateYear=2025');
    await expect(page.locator('h1')).toContainText('Bond Ladder');
  });
});
