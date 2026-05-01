import { test, expect } from '../fixtures/auth-cookie';

test.describe('After I Leave Page', () => {
  test('renders page with empty state gracefully', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/after-i-leave', { waitUntil: 'networkidle' });
    
    // Check page loaded
    await expect(page.locator('h1')).toContainText(/After I Leave|אחרי שאעזוב/i);
    
    // Check language toggle works
    const langToggle = page.locator('button:has-text("English"), button:has-text("עברית")').first();
    await expect(langToggle).toBeVisible();
    
    // Check PDF download button exists
    const pdfButton = page.locator('button:has-text("Download PDF"), button:has-text("PDF")');
    await expect(pdfButton).toBeVisible();
    
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
  
  test('toggles language between English and Hebrew', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    
    await page.goto('/after-i-leave');
    
    // Toggle to Hebrew
    await page.click('button:has-text("עברית")');
    await page.waitForTimeout(500);
    
    // Check RTL is applied
    const content = page.locator('[dir="rtl"]');
    await expect(content).toBeVisible();
    
    // Toggle back to English
    await page.click('button:has-text("English")');
    await page.waitForTimeout(500);
    
    const ltrContent = page.locator('[dir="ltr"]');
    await expect(ltrContent).toBeVisible();
  });
});
