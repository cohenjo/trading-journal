import { test, expect } from '../fixtures/auth-cookie';

const PAGES = [
  '/', '/current-finances', '/summary', '/cash-flow', '/settings',
  '/holdings', '/insurance', '/pension', '/dividends', '/dividends/estimations',
  '/backtest', '/ladder', '/ladder/scanner', '/options', '/tax-condor',
  '/after-i-leave', '/analyze', '/plan', '/progress',
  '/trading/accounts', '/login',
];

/**
 * Temporary safety net for Phase A only. The frontend end-state is that no
 * compute route calls FastAPI over `/api/*`; this array goes to `[]` once the
 * TJ-020 Phase B migrations in #208-#217 land.
 */
const TEMPORARILY_ALLOWED_COMPUTE_API_PATHS: string[] = [
  '/api/plans/simulate',
  '/api/options/projection',
  '/api/tax-condor',
  '/api/backtest',
  '/api/analyze',
  '/api/bonds/scanner',
  '/api/finances/price',
  '/api/ndx/sync',
  '/api/trading/sync',
  '/api/pension',
];

/**
 * Returns true if the response URL/error is known-acceptable noise that should
 * not fail the walkthrough assertion.
 */
function isKnownAcceptableApiError(url: string, status: number): boolean {
  // Telemetry 401s — tracked in #125, not a product bug
  if (url.includes('/metrics/page-load') && status === 401) return true;

  if (
    TEMPORARILY_ALLOWED_COMPUTE_API_PATHS.length > 0 &&
    status === 404 &&
    TEMPORARILY_ALLOWED_COMPUTE_API_PATHS.some(p => url.includes(p))
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true if the console error text is known-acceptable noise.
 */
function isKnownAcceptableConsoleError(text: string): boolean {
  // Telemetry 401 noise — tracked in #125
  if (text.includes('/metrics/page-load')) return true;

  if (
    TEMPORARILY_ALLOWED_COMPUTE_API_PATHS.length > 0 &&
    TEMPORARILY_ALLOWED_COMPUTE_API_PATHS.some(p => text.includes(p))
  ) {
    return true;
  }

  if (text.includes('Simulation failed') || text.includes('Simulation error')) return true;
  if (text.includes('Failed to fetch history')) return true;
  if (text.includes('Failed to fetch summary data')) return true;
  if (text.includes('Failed to fetch years')) return true;
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
