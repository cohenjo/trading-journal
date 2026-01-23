
import { test, expect } from '@playwright/test';

test.describe('Plan Page', () => {

  test('should load without simulation error', async ({ page }) => {
    // 1. Mock API Responses to isolate from backend (initially) OR use real backend?
    // User wants to "fix until it passes", implying we should hit the real backend or sufficiently realistic mock.
    // Given the context is "Internal Server Error", testing against a mock that returns 200 won't help us fix the backend.
    // However, playwright usually tests against the running local server.
    // If we mock 200 OK, the test passes but the bug remains.
    // But debugging the backend is best done with python scripts.
    // Let's use this test to verify the "User Experience".
    
    // We will spy on the response to /api/plans/simulate
    let simulationResponsePromise = page.waitForResponse(response => 
      response.url().includes('/api/plans/simulate') && response.status() === 200
    );

    // 2. Navigate to Page
    await page.goto('/plan');

    // 3. Wait for simulation
    // If it fails with 500, the promise above might not resolve or we can catch it.
    try {
        const response = await simulationResponsePromise;
        expect(response.ok()).toBeTruthy();
    } catch (e) {
        // If timeout, it means we didn't get a 200 OK
        const errorResponse = await page.waitForResponse(response => 
            response.url().includes('/api/plans/simulate')
        );
        console.log(`Simulation returned status: ${errorResponse.status()}`);
        if (!errorResponse.ok()) {
            console.log('Error Body:', await errorResponse.text());
        }
        expect(errorResponse.status()).toBe(200);
    }
    
    // 4. Verify Chart Container exists
    await expect(page.locator('.recharts-responsive-container').first()).toBeVisible({ timeout: 10000 });
    
  });

});
