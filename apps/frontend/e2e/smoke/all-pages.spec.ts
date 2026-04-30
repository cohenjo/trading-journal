/**
 * Comprehensive smoke test: All 22 frontend pages
 * 
 * Tests every page route for:
 * - HTTP 2xx response (or valid redirect)
 * - No 5xx errors on any network request
 * - No console errors
 * - Page body renders with content
 * - Basic DOM structure present
 */

import { test, expect } from '@playwright/test';

const PAGES = [
  // Wave 1: Quick wins (read-only dashboards)
  { path: '/', name: 'root', expectsRedirect: true },
  { path: '/summary', name: 'summary' },
  { path: '/cash-flow', name: 'cash-flow' },
  { path: '/current-finances', name: 'current-finances' },
  { path: '/settings', name: 'settings' },

  // Wave 2: CRUD core
  { path: '/dividends', name: 'dividends' },
  { path: '/dividends/estimations', name: 'dividends-estimations' },
  { path: '/holdings', name: 'holdings' },
  { path: '/insurance', name: 'insurance' },
  { path: '/pension', name: 'pension' },

  // Wave 3: Complex/compute
  { path: '/backtest', name: 'backtest' },
  { path: '/ladder', name: 'ladder' },
  { path: '/ladder/scanner', name: 'ladder-scanner' },
  { path: '/options', name: 'options' },
  { path: '/tax-condor', name: 'tax-condor' },

  // Wave 4: Polished features
  { path: '/after-i-leave', name: 'after-i-leave' },
  { path: '/analyze', name: 'analyze' },
  { path: '/plan', name: 'plan' },
  { path: '/progress', name: 'progress' },

  // Additional pages
  { path: '/trading/accounts', name: 'trading-accounts' },
  { path: '/login', name: 'login' },
  
  // Dynamic route - test with today's date
  { path: `/day/${new Date().toISOString().split('T')[0]}`, name: 'day-dynamic' },
];

test.describe('smoke / all pages', () => {
  for (const page of PAGES) {
    test(`${page.name} (${page.path}) loads without errors`, async ({ page: browserPage }) => {
      const consoleErrors: string[] = [];
      const failedRequests: Array<{ status: number; url: string }> = [];
      const apiCalls: Array<{ status: number; url: string; method: string }> = [];

      browserPage.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      browserPage.on('response', (response) => {
        const url = response.url();
        
        // Track API calls
        if (url.includes('/api/')) {
          apiCalls.push({
            status: response.status(),
            url: url,
            method: response.request().method(),
          });
        }

        // Track 5xx errors
        if (response.status() >= 500) {
          failedRequests.push({
            status: response.status(),
            url: url,
          });
        }
      });

      const startTime = Date.now();
      const response = await browserPage.goto(page.path, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      const loadTime = Date.now() - startTime;

      // Log basic page info
      console.log(`[${page.name}] Load time: ${loadTime}ms, Status: ${response?.status()}`);

      // Check HTTP status
      const status = response?.status() || 0;
      if (page.expectsRedirect) {
        expect(status, `Expected redirect (3xx) or 2xx for ${page.path}`).toBeLessThan(400);
      } else {
        expect(status, `Expected 2xx for ${page.path}`).toBeGreaterThanOrEqual(200);
        expect(status, `Expected 2xx for ${page.path}`).toBeLessThan(300);
      }

      // No 5xx errors
      expect(
        failedRequests,
        `5xx errors detected:\n${failedRequests.map(r => `  ${r.status} ${r.url}`).join('\n')}`
      ).toHaveLength(0);

      // Filter critical console errors (ignore common noise)
      const criticalErrors = consoleErrors.filter(
        (e) => 
          !e.includes('favicon') && 
          !e.includes('chrome-extension') &&
          !e.includes('Manifest:') &&
          !e.toLowerCase().includes('download the react devtools')
      );

      expect(
        criticalErrors,
        `Console errors:\n${criticalErrors.join('\n')}`
      ).toHaveLength(0);

      // Body should exist and have content
      const body = browserPage.locator('body');
      await expect(body).not.toBeEmpty();

      // Should have some text content (not just loading spinners)
      const bodyText = await body.textContent();
      expect(bodyText?.length || 0, 'Page should have text content').toBeGreaterThan(10);

      // Log API calls summary
      if (apiCalls.length > 0) {
        console.log(`[${page.name}] API calls: ${apiCalls.length}`);
        const failed = apiCalls.filter(c => c.status >= 400);
        if (failed.length > 0) {
          console.log(`[${page.name}] Failed API calls:`, failed);
        }
      }
    });
  }
});
