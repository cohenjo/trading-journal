import { test, expect } from '@playwright/test';

test.describe('Current Finances - Assets', () => {
    test.beforeEach(async ({ page }) => {
        // Mock empty initial state or consistent state
        await page.route('/api/finances/latest', async route => {
            await route.fulfill({ json: { data: { items: [] } } });
        });
        await page.goto('/current-finances');
    });

    test('should add a new asset with financing details', async ({ page }) => {
        // 1. Click Add Asset (Assets tab is default usually, or click it)
        await page.click('text=Assets');
        await page.click('button:has-text("+ Add Asset")');

        // New Step: Select Type "House" (or generic)
        await page.click('button:has-text("House")');

        // 2. Fill Basic Info
        // Name should be pre-filled as "House", change it
        await page.fill('input[value="House"]', 'Beach House'); // Name
        await page.fill('input[value="0"]', '500000'); // Value
        // Type input is now "House", we can leave it or check it
        await expect(page.locator('input[placeholder="e.g. Cash, Stock"]')).toHaveValue('House');

        // 3. Check Financing Section Visibility
        await expect(page.locator('text=Financing Details')).toBeVisible();

        // 4. Fill Financing Details
        // Initial Purchase Price
        await page.fill('text=Initial Purchase Price ($) >> .. >> input', '450000');

        // Loan Balance
        await page.fill('text=Current Loan Balance ($) >> .. >> input', '300000');

        // Interest Rate
        await page.fill('text=Interest Rate (%) >> .. >> input', '3.5');

        // Loan End Year
        await page.fill('text=Loan End Year >> .. >> input', '2050');

        // 5. Save
        // Mock the POST request to verify payload
        const savePromise = page.waitForRequest(request =>
            request.url().includes('/api/finances/') && request.method() === 'POST'
        );
        await page.click('button:has-text("Save")');
        const saveRequest = await savePromise;
        const postData = saveRequest.postDataJSON();

        // 6. Verify Payload
        const newItem = postData.items.find((i: any) => i.name === 'Beach House');
        expect(newItem).toBeTruthy();
        expect(newItem.value).toBe(500000);
        expect(newItem.details.purchase_price).toBe(450000);
        expect(newItem.details.loan_balance).toBe(300000);
        expect(newItem.details.interest_rate).toBe(3.5);
        expect(newItem.details.loan_end_year).toBe(2050);
        expect(newItem.details.fully_owned).toBeUndefined();
    });

    test('should hide financing fields when Fully Owned is checked', async ({ page }) => {
        await page.click('text=Assets');
        await page.click('button:has-text("+ Add Asset")');

        // Select "Car"
        await page.click('button:has-text("Car")');

        // Checkbox label "Fully Owned?"
        const checkbox = page.locator('label:has-text("Fully Owned?") input');

        // Initially fields visible
        await expect(page.locator('text=Current Loan Balance ($)')).toBeVisible();

        // Check it
        await checkbox.check();

        // Fields hidden
        await expect(page.locator('text=Current Loan Balance ($)')).toBeHidden();

        // Save and verify payload has fully_owned: true
        // Save and verify payload has fully_owned: true
        await page.fill('input[value="Car"]', 'Paid Off Car');
        await page.fill('input[value="0"]', '20000');
        // Type is pre-filled as Car

        const savePromise = page.waitForRequest(request =>
            request.url().includes('/api/finances/') && request.method() === 'POST'
        );
        await page.click('button:has-text("Save")');
        const saveRequest = await savePromise;
        const postData = saveRequest.postDataJSON();

        const newItem = postData.items.find((i: any) => i.name === 'Paid Off Car');
        expect(newItem.details.fully_owned).toBe(true);
    });
});
