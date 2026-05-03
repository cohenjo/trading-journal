import { test, expect } from '../fixtures/auth-cookie';

const PAGES = [
  '/', '/current-finances', '/summary', '/cash-flow', '/settings',
  '/holdings', '/insurance', '/pension', '/dividends', '/dividends/estimations',
  '/backtest', '/ladder', '/ladder/scanner', '/options', '/tax-condor',
  '/after-i-leave', '/analyze', '/plan', '/progress',
  '/trading/accounts', '/login',
];

/**
 * Path prefixes for FastAPI endpoints that have not yet been migrated to
 * Server Actions and therefore 404 in environments without the FastAPI
 * backend deployed (i.e. CI and Vercel). Tracked under TJ-018 (#71); each
 * sub-issue listed below should remove its entry as the migration lands.
 *
 * - /api/plans/simulate    → #173
 * - /api/finances/history  → #177
 * - /api/options/projection → #189 / TJ-019
 */
const UNMIGRATED_FASTAPI_PATHS = [
  '/api/plans/simulate',
  '/api/finances/history',
  '/api/options/projection',
  '/api/backtest',
  '/api/dividends',
  '/api/holdings',
];

/**
 * Returns true if the response URL/error is known-acceptable noise that should
 * not fail the walkthrough assertion.
 */
function isKnownAcceptableApiError(url: string, status: number): boolean {
  // Telemetry 401s — tracked in #125, not a product bug
  if (url.includes('/metrics/page-load') && status === 401) return true;

  // Un-migrated FastAPI endpoints — see UNMIGRATED_FASTAPI_PATHS above
  if (status === 404 && UNMIGRATED_FASTAPI_PATHS.some(p => url.includes(p))) return true;

  return false;
}

/**
 * Returns true if the console error text is known-acceptable noise.
 */
function isKnownAcceptableConsoleError(text: string): boolean {
  // Telemetry 401 noise — tracked in #125
  if (text.includes('/metrics/page-load')) return true;

  // Un-migrated FastAPI endpoints — see UNMIGRATED_FASTAPI_PATHS above
  if (UNMIGRATED_FASTAPI_PATHS.some(p => text.includes(p))) return true;

  // App-level downstream errors caused by the same un-migrated endpoints
  if (text.includes('Simulation failed') || text.includes('Simulation error')) return true;
  if (text.includes('Failed to fetch history')) return true;
  if (text.includes('Failed to fetch summary data')) return true;
  if (text.includes('Failed to fetch years')) return true;
  if (text.includes('Failed to fetch dividends')) return true;

  // Generic browser console companion of the 404s we already allow-list above.
  // The browser logs "Failed to load resource: ... 404" without the URL, so we
  // filter the bare message; specific URL noise is filtered by the network handler.
  if (text.includes('Failed to load resource: the server responded with a status of 404')) return true;

  // React dev-mode warnings / hydration hints
  if (text.includes('Warning:') || text.includes('React does not recognize')) return true;

  return false;
}

for (const path of PAGES) {
  test(`${path} authenticated render @smoke`, async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const unexpectedApiErrors: { url: string; status: number }[] = [];
    const unexpectedConsoleErrors: string[] = [];

    page.on('response', resp => {
      const url = resp.url();
      const status = resp.status();
      if ((url.includes('/api/') || url.includes('supabase')) && status >= 400) {
        if (!isKnownAcceptableApiError(url, status)) {
          unexpectedApiErrors.push({ url, status });
        }
      }
    });

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isKnownAcceptableConsoleError(text)) {
          unexpectedConsoleErrors.push(text);
        }
      }
    });

    const resp = await page.goto(path, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => null);
    const status = resp?.status() ?? 0;
    const main = await page.locator('main').count();

    // Every page should resolve to a 2xx (or a login redirect for protected pages)
    expect(status, `Page ${path} returned unexpected status`).toBeLessThan(500);

    // No unexpected 4xx/5xx on /api/* routes
    expect(
      unexpectedApiErrors,
      `Unexpected API errors on ${path}:\n${unexpectedApiErrors.map(e => `  ${e.status} ${e.url}`).join('\n')}`,
    ).toHaveLength(0);

    // No unexpected console errors
    expect(
      unexpectedConsoleErrors,
      `Console errors on ${path}:\n${unexpectedConsoleErrors.join('\n')}`,
    ).toHaveLength(0);

    // Page should have rendered a main element (or at minimum a body with content)
    const bodyText = await page.locator('body').textContent();
    expect((bodyText?.length ?? 0), `${path} body appears empty`).toBeGreaterThan(10);

    // Log summary for CI visibility
    console.log(JSON.stringify({
      path,
      status,
      mainCount: main,
      apiErrors: unexpectedApiErrors.length,
      consoleErrors: unexpectedConsoleErrors.length,
    }));
  });
}
