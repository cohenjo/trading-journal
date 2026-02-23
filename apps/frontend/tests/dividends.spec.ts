import { test, expect } from '@playwright/test';

test('Dividend Dashboard - Account & Position Workflow', async ({ page }) => {
    const accountName = `TEST_ACC_${Date.now()}`;

    // 1. Navigate to Dashboard
    await page.goto('/dividends');
    await expect(page.getByRole('heading', { name: 'Dividend Dashboard' })).toBeVisible();

    // 2. Create New Account
    await page.getByTitle('Manage Accounts').click();
    await page.getByPlaceholder('Enter account name...').fill(accountName);
    await page.getByRole('button', { name: 'Add Account' }).click();
    await expect(page.getByText(accountName).last()).toBeVisible();

    // 3. Go to new Account Tab
    await page.getByRole('button', { name: accountName }).first().click();

    // 4. Add Position (Verify Auto-Select)
    await page.getByRole('button', { name: 'Add Position' }).click();
    await expect(page.getByRole('heading', { name: 'Add Position', exact: true })).toBeVisible();

    // Verify account is auto-selected
    await expect(page.locator('#account')).toHaveValue(accountName);

    await page.getByLabel('Ticker').fill('MSFT');
    await page.getByLabel('Shares').fill('5');
    await page.getByRole('button', { name: 'Save Position' }).click();

    // 5. Verify Position Added
    await expect(page.getByRole('cell', { name: 'MSFT' })).toBeVisible({ timeout: 15000 });

    // 6. Delete Position (Verify Modal)
    await page.getByRole('button', { name: 'Delete position' }).first().click(); // Use first() just in case, though distinct account should have 1
    await expect(page.getByText('Are you sure you want to delete this position?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // Verify gone
    await expect(page.getByRole('cell', { name: 'MSFT' })).not.toBeVisible();

    // Cleanup - Delete Account
    await page.getByTitle('Manage Accounts').click();
    // Find the delete button SPECIFIC to this account
    // The list item contains the name and the button.
    // We can locate the row by text, then find the button inside it.
    // Find the delete button SPECIFIC to this account
    // Scope to the account list item using specific classes to avoid finding parent containers
    await page.locator('.bg-slate-950.border-slate-800', { hasText: accountName })
        .getByTitle('Delete Account').click();

    // Verify Modal
    await expect(page.getByText(`Are you sure you want to delete account "${accountName}"?`)).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // Verify gone (Count 0 to avoid strict mode issues if multiple ghosts existed)
    await expect(page.getByText(accountName)).toHaveCount(0);
});
