import { test, expect } from '../fixtures/auth-cookie';
import * as fs from 'fs';

const PAGES = [
  '/', '/current-finances', '/summary', '/cash-flow', '/settings',
  '/holdings', '/insurance', '/pension', '/dividends', '/dividends/estimations',
  '/backtest', '/ladder', '/ladder/scanner', '/options', '/tax-condor',
  '/after-i-leave', '/analyze', '/plan', '/progress',
  '/trading/accounts', '/login',
];

for (const path of PAGES) {
  test(`${path} authenticated render`, async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    const apiCalls: { url: string; status: number }[] = [];
    const consoleErrors: string[] = [];
    
    page.on('response', resp => {
      const url = resp.url();
      if (url.includes('/api/') || url.includes('supabase')) {
        apiCalls.push({ url, status: resp.status() });
      }
    });
    page.on('console', msg => { 
      if (msg.type() === 'error') consoleErrors.push(msg.text()); 
    });
    
    const resp = await page.goto(path, { waitUntil: 'networkidle', timeout: 15000 }).catch(e => null);
    const status = resp?.status() ?? 0;
    const finalUrl = page.url();
    const main = await page.locator('main').count();
    
    // Stash to a JSON file
    fs.appendFileSync('/tmp/walkthrough-results.jsonl', JSON.stringify({
      path, status, finalUrl, mainCount: main, apiCalls, consoleErrors,
    }) + '\n');
  });
}
