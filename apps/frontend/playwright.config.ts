import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Load .env.local for local runs (SUPABASE_SERVICE_ROLE_KEY, DEV_BASE_URL, etc.)
// In CI these come from secrets; locally they come from .env.local
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
} catch {
  // dotenv optional — ignore if not installed
}

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * BASE_URL env var selects the target:
 *   BASE_URL=http://localhost:3000          (default — local dev server)
 *   BASE_URL=https://<vercel-preview>.app   (deployed dev / CI)
 *
 * Legacy PLAYWRIGHT_BASE_URL still honoured for backwards compat.
 */
export default defineConfig({
  // Cover both legacy integration tests (tests/) and new tiered E2E suite (e2e/)
  testMatch: ['tests/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['list'],
    ['html', { open: 'never' }]
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* BASE_URL wins; fall back to legacy PLAYWRIGHT_BASE_URL, then localhost */
    baseURL: process.env.BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure for easier debugging */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
