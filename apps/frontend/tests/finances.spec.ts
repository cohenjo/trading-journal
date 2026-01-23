import { test, expect } from '@playwright/test';

test.describe('Current Finances Page', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to the page
    await page.goto('/current-finances');
    // Ensure page loaded
    await expect(page.getByText('Current Finances', { exact: true })).toBeVisible();
  });

  test('should display default empty state or list', async ({ page }) => {
    // Check for the "Add Assets" button if list is empty, or item cards if populated
    // We assume default state might have items or not.
    // Let's check tab switching.
    
    // Switch to Liabilities
    await page.getByRole('button', { name: 'Liabilities' }).click();
    await expect(page.getByRole('button', { name: 'Liabilities' })).toHaveClass(/border-blue-500/);

    // Switch back to Assets
    await page.getByRole('button', { name: 'Assets' }).click();
    await expect(page.getByRole('button', { name: 'Assets' })).toHaveClass(/border-blue-500/);
  });

  test('should add a new asset item', async ({ page }) => {
    const testAssetName = `Test Asset ${Date.now()}`;

    // 1. Click Add Asset (This button text depends on active tab, default is Asset)
    // "Add Asset" or "Add Assets"? The code says `Add {activeTab.slice(0, -1)}` -> "Add Asset"
    await page.getByRole('button', { name: 'Add Asset' }).click();

    // 2. Modal should open
    const modal = page.locator('form');
    await expect(modal).toBeVisible();

    // 3. Fill Form
    await modal.getByLabel('Name').fill(testAssetName);
    await modal.getByLabel('Value ($)').fill('50000');
    await modal.getByLabel('Type').fill('Real Estate');
    
    // Add a detail
    await modal.getByPlaceholder('Key (e.g. Bank)').fill('Location');
    await modal.getByPlaceholder('Value').fill('Suburb');
    await modal.getByRole('button', { name: '+' }).click();

    // 4. Save
    await modal.getByRole('button', { name: 'Save' }).click();
    
    // 5. Verify Item appears in list
    // It should be saved to backend.
    await expect(page.getByText(testAssetName)).toBeVisible();
    await expect(page.getByText('$50,000.00')).toBeVisible(); // Currency formatted
    await expect(page.getByText('Location: Suburb')).toBeVisible();

    // 6. Reload page to verify persistence
    await page.reload();
    await expect(page.getByText(testAssetName)).toBeVisible();
  });

  test('should delete an asset', async ({ page }) => {
    // First ensure we have an item to delete (reuse the one from previous test if order is guaranteed, 
    // or create one). Playwright tests run in parallel by default? No, usually sequentially in same file?
    // Safer to create a new one.
    
    const deleteMeName = `Delete Me ${Date.now()}`;
    
    // Create Item
    await page.getByRole('button', { name: 'Add Asset' }).click();
    await page.locator('form').getByLabel('Name').fill(deleteMeName);
    await page.locator('form').getByLabel('Value ($)').fill('100');
    await page.locator('form').getByLabel('Type').fill('Junk');
    await page.locator('form').getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText(deleteMeName)).toBeVisible();

    // Handle Confirm Dialog
    page.on('dialog', dialog => dialog.accept());

    // Click Delete button for this item
    // The delete button is within the card. We need to find the card that contains the name.
    const card = page.locator('div', { has: page.getByText(deleteMeName) }).first();
    // Delete button has title="Delete"
    // Need to hover to make it visible? Code says `opacity-0 group-hover:opacity-100`.
    // However, in Playwright, we can force click or hover.
    await card.hover();
    await card.getByTitle('Delete').click();

    // Verify it's gone
    await expect(page.getByText(deleteMeName)).not.toBeVisible();
  });

});
