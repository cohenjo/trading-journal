
import { test, expect } from '@playwright/test';

test.describe('Cash Flow Page', () => {

  test('should load and display cash flow sankey chart', async ({ page }) => {
    // 1. Mock API Responses
    
    // Mock Plans
    await page.route('/api/plans/latest', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          name: 'Test Plan',
          data: { items: [], milestones: [], settings: {} },
          updated_at: new Date().toISOString()
        })
      });
    });

    // Mock Finances
    await page.route('/api/finances/latest', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            net_worth: 500000,
            liquid_assets: 200000,
            data: { items: [] }
          })
        });
      });

    // Mock Simulation
    // We provide a single year projection with details
    await page.route('/api/plans/simulate', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            year: 2026,
            age: 46,
            income: 150000,
            expenses: 100000,
            tax_paid: 20000,
            withdrawals: 0,
            net_worth: 530000,
            income_details: [
                { name: 'My Job', type: 'Earned Income', value: 150000 }
            ],
            expense_details: [
                { name: 'Rent', category: 'Housing', value: 30000 },
                { name: 'Living', category: 'Living', value: 70000 }
            ],
            savings_details: [
                { name: '401k', type: 'Investment', value: 30000 }
            ]
          },
          {
            year: 2027,
            age: 47,
            income: 150000,
            expenses: 100000,
            tax_paid: 20000,
            withdrawals: 0,
            net_worth: 560000,
            income_details: [], 
            expense_details: [],
            savings_details: []
          }
        ])
      });
    });

    // 2. Navigate to Page
    await page.goto('/cash-flow');

    // 3. Verify Page Title
    await expect(page.locator('h1')).toContainText('Cash Flow Analysis');

    // 4. Verify Summary Cards (Calculated from mocks)
    // Inflow: 150k + 0 = 150k
    // Spending: 100k
    // Taxes: 20k
    // Savings: 150 - 100 - 20 = 30k
    
    // Check specific text values (format may vary so check mostly numbers)
    // $150,000
    await expect(page.getByText('$150,000')).toBeVisible(); 
    // $100,000
    await expect(page.getByText('$100,000')).toBeVisible();
    // $20,000
    await expect(page.getByText('$20,000')).toBeVisible();
    // $30,000
    await expect(page.getByText('$30,000')).toBeVisible();

    // 5. Verify Sankey Diagram Exists
    // It's an SVG/Canvas usually inside a div.
    // Nivo sankey usually renders SVGs.
    // The container has class "h-[600px]"
    const sankeyContainer = page.locator('.h-\\[600px\\]');
    await expect(sankeyContainer).toBeVisible();
    
    // Check if SVG elements are present (nodes/links)
    // Nivo nodes are usually rects or paths
    // We can just query for text in the diagram
    await expect(page.getByText('Income').first()).toBeVisible();
    await expect(page.getByText('Expenses').first()).toBeVisible();
    
    // Specific items from details
    await expect(page.getByText('My Job')).toBeVisible();
    await expect(page.getByText('Rent')).toBeVisible();
    
  });

});
