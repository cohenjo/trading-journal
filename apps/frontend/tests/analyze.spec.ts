import { test, expect } from '@playwright/test';

test.describe('Company Analysis Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analyze');
    await expect(page.getByText('Company Analysis', { exact: true })).toBeVisible();
  });

  test('should display page load elements', async ({ page }) => {
    // Verify heading
    await expect(page.getByText('Company Analysis', { exact: true })).toBeVisible();
    
    // Verify ticker input with placeholder
    const tickerInput = page.getByPlaceholder('Enter ticker (e.g. AAPL)');
    await expect(tickerInput).toBeVisible();
    
    // Verify analyze button
    const analyzeButton = page.getByRole('button', { name: /analyze/i });
    await expect(analyzeButton).toBeVisible();
  });

  test('should display default empty state', async ({ page }) => {
    await expect(page.getByText('Enter a ticker symbol above to start analyzing.')).toBeVisible();
  });

  test('should have Long-Term Investor toggle pressed by default', async ({ page }) => {
    const longTermButton = page.getByRole('button', { name: /long-term investor/i });
    const shortTermButton = page.getByRole('button', { name: /short-term income/i });
    
    await expect(longTermButton).toBeVisible();
    await expect(shortTermButton).toBeVisible();
    
    // Check if Long-Term is pressed/active (aria-pressed attribute)
    const isPressed = await longTermButton.getAttribute('aria-pressed');
    expect(isPressed).toBe('true');
  });

  test('should switch between view toggles', async ({ page }) => {
    const longTermButton = page.getByRole('button', { name: /long-term investor/i });
    const shortTermButton = page.getByRole('button', { name: /short-term income/i });
    
    // Click Short-Term Income
    await shortTermButton.click();
    
    // Verify Short-Term is now active
    const shortTermState = await shortTermButton.getAttribute('aria-pressed');
    expect(shortTermState).toBe('true');
    
    // Click back to Long-Term
    await longTermButton.click();
    
    // Verify Long-Term is active again
    const longTermState = await longTermButton.getAttribute('aria-pressed');
    expect(longTermState).toBe('true');
  });

  test('should search for a ticker and display results', async ({ page }) => {
    test.setTimeout(30000);
    
    // Fill in ticker
    const tickerInput = page.getByPlaceholder('Enter ticker (e.g. AAPL)');
    await tickerInput.fill('AAPL');
    
    // Click Analyze button
    const analyzeButton = page.getByRole('button', { name: /analyze/i });
    await analyzeButton.click();
    
    // Wait for "Viewing: AAPL" to appear (indicates successful API response)
    await expect(page.getByText('Viewing: AAPL')).toBeVisible({ timeout: 15000 });
  });

  test('should load long-term view sections after search', async ({ page }) => {
    test.setTimeout(30000);
    
    // Perform search
    const tickerInput = page.getByPlaceholder('Enter ticker (e.g. AAPL)');
    await tickerInput.fill('AAPL');
    const analyzeButton = page.getByRole('button', { name: /analyze/i });
    await analyzeButton.click();
    
    // Wait for results to load
    await expect(page.getByText('Viewing: AAPL')).toBeVisible({ timeout: 15000 });
    
    // Verify main section headings appear
    await expect(page.getByText('Financial Scorecard')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Valuation Benchmarks')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('AI Synthesis')).toBeVisible({ timeout: 10000 });
  });

  test('should display Financial Scorecard metrics', async ({ page }) => {
    test.setTimeout(30000);
    
    // Perform search
    const tickerInput = page.getByPlaceholder('Enter ticker (e.g. AAPL)');
    await tickerInput.fill('AAPL');
    const analyzeButton = page.getByRole('button', { name: /analyze/i });
    await analyzeButton.click();
    
    // Wait for Financial Scorecard section
    await expect(page.getByText('Financial Scorecard')).toBeVisible({ timeout: 15000 });
    
    // Verify metric labels are present
    await expect(page.getByText(/ROIC vs WACC/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/5Y Revenue CAGR/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/5Y FCF CAGR/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Net Debt \/ EBITDA/i)).toBeVisible({ timeout: 5000 });
  });

  test('should display Valuation Benchmarks metrics', async ({ page }) => {
    test.setTimeout(30000);
    
    // Perform search
    const tickerInput = page.getByPlaceholder('Enter ticker (e.g. AAPL)');
    await tickerInput.fill('AAPL');
    const analyzeButton = page.getByRole('button', { name: /analyze/i });
    await analyzeButton.click();
    
    // Wait for Valuation Benchmarks section
    await expect(page.getByText('Valuation Benchmarks')).toBeVisible({ timeout: 15000 });
    
    // Verify metric labels are present
    await expect(page.getByText(/Forward P\/E/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/PEG Ratio/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/EV \/ FCF/i)).toBeVisible({ timeout: 5000 });
  });

  test('should display DCF Calculator with sliders', async ({ page }) => {
    test.setTimeout(30000);
    
    // Perform search
    const tickerInput = page.getByPlaceholder('Enter ticker (e.g. AAPL)');
    await tickerInput.fill('AAPL');
    const analyzeButton = page.getByRole('button', { name: /analyze/i });
    await analyzeButton.click();
    
    // Wait for DCF Calculator section
    await expect(page.getByText('DCF What-If Calculator')).toBeVisible({ timeout: 15000 });
    
    // Verify calculator elements
    await expect(page.getByText(/Growth Rate/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Discount Rate/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Fair Value Per Share/i)).toBeVisible({ timeout: 5000 });
    
    // Verify sliders exist (look for input type="range")
    const sliders = page.locator('input[type="range"]');
    await expect(sliders.first()).toBeVisible({ timeout: 5000 });
  });

  test('should display short-term view when toggled', async ({ page }) => {
    test.setTimeout(30000);
    
    // Perform search
    const tickerInput = page.getByPlaceholder('Enter ticker (e.g. AAPL)');
    await tickerInput.fill('AAPL');
    const analyzeButton = page.getByRole('button', { name: /analyze/i });
    await analyzeButton.click();
    
    // Wait for initial results
    await expect(page.getByText('Viewing: AAPL')).toBeVisible({ timeout: 15000 });
    
    // Switch to Short-Term Income view
    const shortTermButton = page.getByRole('button', { name: /short-term income/i });
    await shortTermButton.click();
    
    // Verify the view has changed (Short-Term view should have different content)
    // We can verify the toggle is active
    const shortTermState = await shortTermButton.getAttribute('aria-pressed');
    expect(shortTermState).toBe('true');
  });

  test('should handle invalid ticker gracefully', async ({ page }) => {
    test.setTimeout(30000);
    
    // Try to search for an invalid ticker
    const tickerInput = page.getByPlaceholder('Enter ticker (e.g. AAPL)');
    await tickerInput.fill('INVALIDTICKER123XYZ');
    const analyzeButton = page.getByRole('button', { name: /analyze/i });
    await analyzeButton.click();
    
    // Wait a moment for the API to respond
    await page.waitForTimeout(5000);
    
    // Check that either an error message is shown or results don't load
    // The "Viewing:" text should not appear for invalid tickers
    const viewingText = page.getByText(/Viewing: INVALIDTICKER123XYZ/i);
    
    // Either the error is shown or viewing text is not present
    const isVisible = await viewingText.isVisible().catch(() => false);
    
    // If no error handling UI exists, at minimum verify the viewing text doesn't show
    // or an error toast/message appears
    if (isVisible) {
      // If viewing text shows, check that no data sections loaded
      const hasFinancialScorecard = await page.getByText('Financial Scorecard').isVisible().catch(() => false);
      expect(hasFinancialScorecard).toBe(false);
    }
  });
});
