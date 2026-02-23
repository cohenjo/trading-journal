import { test, expect } from '@playwright/test';

test.describe('Plan Assets', () => {
    test('should allow adding a new asset with expense details', async ({ page }) => {
        // Navigate to Plan page
        await page.goto('/plan');

        // Click on "Real Assets" tab
        await page.click('text=Real Assets');

        // Click "Add Asset"
        await page.click('text=+ Add Asset');

        // Select "House"
        await page.click('text=House');

        // Modal should be open on Details step
        await expect(page.locator('h2:has-text("New House")')).toBeVisible();

        // Check for Expense Fields
        await expect(page.locator('text=Yearly Maintenance (% of Value)')).toBeVisible();
        await expect(page.locator('text=Yearly Improvements (% of Value)')).toBeVisible();
        await expect(page.locator('text=Yearly Insurance (% of Value)')).toBeVisible();
        await expect(page.locator('text=Monthly HOA Fees ($)')).toBeVisible();

        // Fill in values
        await page.fill('input[placeholder="0.00"] >> nth=0', '1.0'); // Maintenance
        await page.fill('input[placeholder="0.00"] >> nth=1', '0.5'); // Improvement

        // Fill Name
        await page.fill('input[value="House"]', 'My Dream House');

        // Save
        await page.click('text=Add Item');

        // Verify it appears in the list
        await expect(page.locator('text=My Dream House')).toBeVisible();
    });

    test('should show linked status for assets matching current finances', async ({ page }) => {
        // Mock the finances response to include an asset
        await page.route('/api/finances/latest', async route => {
            const json = {
                net_worth: 500000,
                data: {
                    items: [
                        {
                            id: 'asset1',
                            name: 'Downtown Apt',
                            category: 'Assets',
                            value: 450000,
                            type: 'Real Estate',
                            details: {
                                loan_balance: 300000,
                                interest_rate: 4.5,
                                loan_end_year: 2045
                            }
                        }
                    ]
                }
            };
            await route.fulfill({ json });
        });

        await page.goto('/plan');
        await page.click('text=Real Assets');

        // Check for "Downtown Apt"
        // Use simpler locator strategy that targets the item container directly
        const assetItem = page.locator('div.group').filter({ hasText: 'Downtown Apt' });

        await expect(assetItem).toBeVisible();

        // Check for Linked Badge
        await expect(assetItem.locator('text=Linked')).toBeVisible();

        // Click to Edit
        await assetItem.locator('button:has-text("✏️")').click();

        // Check Linked Indicator in Modal
        await expect(page.locator('text=Linked to Current Finances')).toBeVisible();

        // Check Value is Disabled
        const valueInput = page.locator('input[disabled]');
        await expect(valueInput).toHaveValue('450000');

        // Check Financing Details
        await expect(page.locator('label:has-text("Financed?") input')).toBeChecked();

        // Down Payment Should be Value (450k) - Loan (300k) = 150k
        await expect(page.locator('text=Down Payment ($) >> .. >> input')).toHaveValue('150000');
        await expect(page.locator('text=Interest Rate (APR %) >> .. >> input')).toHaveValue('4.5');
    });
});
