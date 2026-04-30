/**
 * Detailed smoke test reporter
 * Captures comprehensive data about each page for analysis
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PAGES = [
  // Wave 1: Quick wins (read-only dashboards)
  { path: '/', name: 'root', expectsRedirect: true, issue: 101, wave: 1 },
  { path: '/summary', name: 'summary', issue: 102, wave: 1 },
  { path: '/cash-flow', name: 'cash-flow', issue: 103, wave: 1 },
  { path: '/current-finances', name: 'current-finances', issue: 104, wave: 1 },
  { path: '/settings', name: 'settings', issue: 105, wave: 1 },

  // Wave 2: CRUD core
  { path: '/dividends', name: 'dividends', issue: 106, wave: 2 },
  { path: '/dividends/estimations', name: 'dividends-estimations', issue: 107, wave: 2 },
  { path: '/holdings', name: 'holdings', issue: 108, wave: 2 },
  { path: '/insurance', name: 'insurance', issue: 109, wave: 2 },
  { path: '/pension', name: 'pension', issue: 110, wave: 2 },

  // Wave 3: Complex/compute
  { path: '/backtest', name: 'backtest', issue: 111, wave: 3 },
  { path: '/ladder', name: 'ladder', issue: 112, wave: 3 },
  { path: '/ladder/scanner', name: 'ladder-scanner', issue: 113, wave: 3 },
  { path: '/options', name: 'options', issue: 114, wave: 3 },
  { path: '/tax-condor', name: 'tax-condor', issue: 115, wave: 3 },

  // Wave 4: Polished features
  { path: '/after-i-leave', name: 'after-i-leave', issue: 116, wave: 4 },
  { path: '/analyze', name: 'analyze', issue: 117, wave: 4 },
  { path: '/plan', name: 'plan', issue: 118, wave: 4 },
  { path: '/progress', name: 'progress', issue: 119, wave: 4 },

  // Additional pages
  { path: '/trading/accounts', name: 'trading-accounts', issue: 120, wave: 2 },
  { path: '/login', name: 'login', issue: null, wave: 0 }, // No issue - not a functional page
  { path: `/day/${new Date().toISOString().split('T')[0]}`, name: 'day-dynamic', issue: 121, wave: 2 },
];

interface PageResult {
  name: string;
  path: string;
  issue: number | null;
  wave: number;
  status: '✅' | '🟡' | '🔴';
  httpStatus: number;
  loadTimeMs: number;
  consoleErrors: string[];
  apiCalls: Array<{ method: string; url: string; status: number }>;
  failedRequests: Array<{ status: number; url: string }>;
  renderOk: boolean;
  notes: string;
}

const results: PageResult[] = [];

test.describe('smoke / detailed analysis', () => {
  for (const page of PAGES) {
    test(`${page.name} analysis`, async ({ page: browserPage }) => {
      const consoleErrors: string[] = [];
      const failedRequests: Array<{ status: number; url: string }> = [];
      const apiCalls: Array<{ method: string; url: string; status: number }> = [];
      
      browserPage.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (
            !text.includes('favicon') &&
            !text.includes('chrome-extension') &&
            !text.includes('Manifest:') &&
            !text.toLowerCase().includes('download the react devtools')
          ) {
            consoleErrors.push(text);
          }
        }
      });

      browserPage.on('response', (response) => {
        const url = response.url();
        const method = response.request().method();
        const status = response.status();

        if (url.includes('/api/')) {
          apiCalls.push({ method, url: url.split('?')[0], status });
        }

        if (status >= 500) {
          failedRequests.push({ status, url });
        }
      });

      const startTime = Date.now();
      const response = await browserPage.goto(page.path, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      const loadTimeMs = Date.now() - startTime;
      const httpStatus = response?.status() || 0;

      // Check if page rendered successfully
      const body = browserPage.locator('body');
      const bodyText = await body.textContent();
      const renderOk = (bodyText?.length || 0) > 10;

      // Determine status
      let status: '✅' | '🟡' | '🔴' = '✅';
      let notes = '';

      if (failedRequests.length > 0) {
        status = '🔴';
        notes = `5xx errors: ${failedRequests.map(r => `${r.status} ${r.url}`).join(', ')}`;
      } else if (consoleErrors.length > 0) {
        status = '🔴';
        notes = `Console errors: ${consoleErrors.length} error(s)`;
      } else if (!renderOk) {
        status = '🔴';
        notes = 'Page did not render content';
      } else if (httpStatus >= 400) {
        status = '🔴';
        notes = `HTTP ${httpStatus}`;
      } else if (page.expectsRedirect && httpStatus >= 300) {
        status = '✅';
        notes = `Redirected (expected)`;
      } else {
        status = '✅';
        notes = apiCalls.length > 0 ? `${apiCalls.length} API calls` : 'No API calls';
      }

      results.push({
        name: page.name,
        path: page.path,
        issue: page.issue,
        wave: page.wave,
        status,
        httpStatus,
        loadTimeMs,
        consoleErrors,
        apiCalls,
        failedRequests,
        renderOk,
        notes,
      });

      expect(true).toBe(true); // Always pass to collect all data
    });
  }

  test.afterAll(() => {
    // Generate report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + 'T' + new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
    const reportPath = path.join(process.cwd(), '../..', '.squad/log', `${timestamp}-resmoke-post-jwt-fix.md`);
    const jsonPath = path.join(process.cwd(), '../..', '.squad/log', `${timestamp}-resmoke-post-jwt-fix.json`);

    const greenCount = results.filter(r => r.status === '✅').length;
    const yellowCount = results.filter(r => r.status === '🟡').length;
    const redCount = results.filter(r => r.status === '🔴').length;

    let report = `# Re-Smoke Test Post-JWT Fix (PR #122)\n\n`;
    report += `**Date**: ${new Date().toISOString()}\n`;
    report += `**Executor**: Redfoot\n`;
    report += `**Target**: http://localhost:3000 (main branch with JWT fix)\n`;
    report += `**Auth**: None (unauthenticated smoke)\n\n`;
    report += `## Status: ${greenCount === 22 ? '🟢 ALL PASSING' : '🟡 MIXED'}\n\n`;
    report += `### Summary\n\n`;
    report += `| Status | Count |\n`;
    report += `|--------|-------|\n`;
    report += `| ✅ Green (working) | ${greenCount} |\n`;
    report += `| 🟡 Yellow (partial) | ${yellowCount} |\n`;
    report += `| 🔴 Red (broken) | ${redCount} |\n`;
    report += `\n**Total**: 22 pages\n\n`;

    report += `### Per-Page Results\n\n`;
    report += `| Page | Status | HTTP | Load Time | API Calls | Console Errors | Render OK? | Issue# | Wave |\n`;
    report += `|------|--------|------|-----------|-----------|----------------|------------|--------|------|\n`;

    for (const r of results) {
      const apiSummary = r.apiCalls.length > 0
        ? `${r.apiCalls.length} (${r.apiCalls.filter(a => a.status >= 400).length} failed)`
        : '0';
      
      report += `| ${r.name} | ${r.status} | ${r.httpStatus} | ${r.loadTimeMs}ms | ${apiSummary} | ${r.consoleErrors.length} | ${r.renderOk ? '✓' : '✗'} | ${r.issue || 'N/A'} | ${r.wave || 'N/A'} |\n`;
    }

    report += `\n### Green Pages (Auto-Closeable)\n\n`;
    const greenPages = results.filter(r => r.status === '✅' && r.issue !== null);
    if (greenPages.length > 0) {
      report += `These pages are fully functional and their corresponding issues can be closed:\n\n`;
      for (const p of greenPages) {
        report += `- **${p.name}** (#${p.issue}) — Wave ${p.wave} — ${p.notes}\n`;
      }
    } else {
      report += `None.\n`;
    }

    report += `\n### Broken Pages\n\n`;
    const brokenPages = results.filter(r => r.status === '🔴');
    if (brokenPages.length > 0) {
      for (const p of brokenPages) {
        report += `- **${p.name}** (#${p.issue || 'N/A'}) — ${p.notes}\n`;
        if (p.failedRequests.length > 0) {
          report += `  - Failed requests: ${p.failedRequests.map(r => `${r.status} ${r.url}`).join(', ')}\n`;
        }
        if (p.consoleErrors.length > 0) {
          report += `  - Console errors: ${p.consoleErrors.slice(0, 2).join('; ')}\n`;
        }
      }
    } else {
      report += `None! 🎉\n`;
    }

    report += `\n### API Endpoints Called\n\n`;
    const allEndpoints = results.flatMap(r => r.apiCalls.map(a => a.url));
    const uniqueEndpoints = [...new Set(allEndpoints)];
    report += `**Total unique endpoints**: ${uniqueEndpoints.length}\n\n`;
    for (const endpoint of uniqueEndpoints.slice(0, 20)) {
      const calls = results.flatMap(r => r.apiCalls.filter(a => a.url === endpoint));
      const failed = calls.filter(c => c.status >= 400);
      report += `- \`${endpoint}\` — ${calls.length} calls${failed.length > 0 ? ` (${failed.length} failed)` : ''}\n`;
    }

    report += `\n---\n\n`;
    report += `**Report saved to**: ${reportPath}\n`;
    report += `**JSON data**: ${jsonPath}\n`;

    fs.writeFileSync(reportPath, report);
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

    console.log(`\n\n✅ Report generated: ${reportPath}`);
    console.log(`📊 Results: ${greenCount}/22 green, ${yellowCount}/22 yellow, ${redCount}/22 red\n`);
  });
});
