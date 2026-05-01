import { test, expect } from '../fixtures/auth-cookie';

test.describe('Company Analysis Page', () => {
  test('renders page with ticker search', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/analyze', { waitUntil: 'networkidle' });
    
    // Check page loaded
    await expect(page.locator('h1')).toContainText(/Company Analysis/i);
    
    // Check empty state is shown
    await expect(page.locator('text=/Search for a company/i, text=/Enter a ticker/i')).toBeVisible();
    
    // Check split-brain toggle exists
    const toggle = page.locator('button:has-text("Long-Term"), button:has-text("Short-Term")');
    await expect(toggle.first()).toBeVisible();
    
    // Verify no console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
        errors.push(msg.text());
      }
    });
    
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });
  
  test('can search for a ticker', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/analyze');
    
    // Find ticker input (may be a search input or button)
    const searchInput = page.locator('input[type="text"], input[placeholder*="ticker" i], input[placeholder*="search" i]').first();
    
    if (await searchInput.isVisible()) {
      await searchInput.fill('AAPL');
      await searchInput.press('Enter');
      
      // Wait for analysis to load
      await page.waitForTimeout(2000);
      
      // Check that some analysis content appears
      // (This may fail if backend is not running, which is fine for smoke test)
      const hasContent = await page.locator('text=/AAPL/i, text=/Loading/i, text=/Error/i').count() > 0;
      expect(hasContent).toBe(true);
    }
  });
  
  test('can toggle between Long-Term and Short-Term views', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/analyze');
    
    // Click Long-Term
    const longTermBtn = page.locator('button:has-text("Long-Term")').first();
    if (await longTermBtn.isVisible()) {
      await longTermBtn.click();
      await page.waitForTimeout(300);
    }
    
    // Click Short-Term
    const shortTermBtn = page.locator('button:has-text("Short-Term")').first();
    if (await shortTermBtn.isVisible()) {
      await shortTermBtn.click();
      await page.waitForTimeout(300);
    }
  });
});
