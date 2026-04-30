import { chromium, Page } from '@playwright/test';
import { getAdminClient } from './fixtures/admin';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const TEST_USER_EMAIL = 'redfoot-test@example.com';
const TEST_USER_PASSWORD = 'E2eTestPass!1';

const ROUTES = ['/', '/after-i-leave', '/analyze', '/auth', '/backtest', '/cash-flow', '/current-finances', '/day', '/dividends', '/holdings', '/insurance', '/ladder', '/login', '/options', '/pension', '/plan', '/progress', '/settings', '/summary', '/tax-condor', '/trading'];

interface RouteResult {
  route: string;
  classification: string;
  httpStatus: number;
  consoleErrors: string[];
  apiCalls: Array<{ url: string; status: number; method: string }>;
  crudAttempted: boolean;
  crudResult?: string;
  screenshot: string;
  notes: string[];
}

const results: RouteResult[] = [];
let consoleErrors: string[] = [];
let apiCalls: Array<{ url: string; status: number; method: string }> = [];

async function ensureTestUser(): Promise<{ userId: string }> {
  console.log(`Ensuring test user exists: ${TEST_USER_EMAIL}`);
  const admin = getAdminClient();
  const { data: users } = await admin.auth.admin.listUsers();
  const existingUser = users?.users.find((u) => u.email === TEST_USER_EMAIL);
  
  if (existingUser) {
    console.log(`✅ Test user already exists (${existingUser.id})`);
    return { userId: existingUser.id };
  }
  
  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
    email_confirm: true,
  });
  
  if (error) throw new Error(`Failed to create test user: ${error.message}`);
  console.log(`✅ Test user created (${data.user.id})`);
  return { userId: data.user.id };
}

async function login(page: Page): Promise<void> {
  console.log(`Logging in as ${TEST_USER_EMAIL}`);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  
  const loginResult = await page.evaluate(async ({ url, key, email, password }) => {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(url, key);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };
    return { success: true, userId: data.user?.id };
  }, { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
  
  if (!loginResult.success) throw new Error(`Login failed: ${loginResult.error}`);
  console.log(`✅ Logged in successfully (user: ${loginResult.userId})`);
  await page.waitForTimeout(2000);
}

async function testRoute(page: Page, route: string): Promise<RouteResult> {
  console.log(`\n📍 Testing: ${route}`);
  consoleErrors = [];
  apiCalls = [];
  
  const result: RouteResult = {
    route,
    classification: '✅ Working',
    httpStatus: 0,
    consoleErrors: [],
    apiCalls: [],
    crudAttempted: false,
    screenshot: '',
    notes: [],
  };
  
  try {
    const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 15000 });
    result.httpStatus = response?.status() || 0;
    await page.waitForTimeout(5000);
    
    result.consoleErrors = [...consoleErrors];
    result.apiCalls = [...apiCalls];
    
    const currentUrl = page.url();
    if (currentUrl.includes('/login') && route !== '/login') {
      result.classification = '🔴 Broken';
      result.notes.push('Redirected to /login - auth guard triggered');
    }
    
    const errorText = await page.locator('text=/error|failed|not found|404/i').count();
    if (errorText > 0) {
      result.classification = '🔴 Broken';
      result.notes.push('Error message found in DOM');
    }
    
    const emptyText = await page.locator('text=/no data|empty|no records/i').count();
    if (emptyText > 0) {
      result.notes.push('Empty state detected');
      if (result.classification === '✅ Working') result.classification = '🟡 Renders but data missing';
    }
    
    const failedApis = result.apiCalls.filter(call => call.status >= 400);
    if (failedApis.length > 0) {
      result.notes.push(`${failedApis.length} API call(s) failed`);
      if (result.classification === '✅ Working') result.classification = '🟡 Renders but data missing';
    }
    
    if (result.consoleErrors.length > 0) {
      result.notes.push(`${result.consoleErrors.length} console error(s)`);
      if (result.classification === '✅ Working') result.classification = '🟡 Renders but data missing';
    }
    
    const screenshotName = `${route.replace(/\//g, '_') || 'root'}.png`;
    const screenshotPath = path.join(__dirname, 'screenshots/walkthrough', screenshotName);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshot = screenshotName;
    
    console.log(`  Status: ${result.httpStatus} | Classification: ${result.classification}`);
    console.log(`  APIs: ${result.apiCalls.length} | Errors: ${result.consoleErrors.length}`);
    
  } catch (err) {
    result.classification = '🔴 Broken';
    result.notes.push(`Exception: ${err}`);
    console.log(`  ❌ Exception: ${err}`);
  }
  
  return result;
}

async function generateReport(results: RouteResult[]): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = `/Users/jocohe/projects/trading-journal/.squad/log/${timestamp}-authenticated-walkthrough.md`;
  
  const working = results.filter(r => r.classification === '✅ Working').length;
  const missing = results.filter(r => r.classification === '🟡 Renders but data missing').length;
  const broken = results.filter(r => r.classification === '🔴 Broken').length;
  
  let report = `# Authenticated Walkthrough Report\n\n**Generated:** ${new Date().toISOString()}\n**Test User:** ${TEST_USER_EMAIL}\n**Frontend:** ${BASE_URL}\n**Backend:** http://localhost:8000\n\n## Summary\n\n- ✅ **Working:** ${working}\n- 🟡 **Renders but data missing:** ${missing}\n- 🔴 **Broken:** ${broken}\n- **Total:** ${results.length}\n\n## Page Results\n\n| Route | Status | HTTP | APIs | Errors | Screenshot |\n|-------|--------|------|------|--------|------------|\n`;
  
  for (const result of results) {
    const apiSummary = `${result.apiCalls.length} (${result.apiCalls.filter(a => a.status >= 400).length} fail)`;
    report += `| \`${result.route}\` | ${result.classification} | ${result.httpStatus} | ${apiSummary} | ${result.consoleErrors.length} | [📸](../apps/frontend/e2e/screenshots/walkthrough/${result.screenshot}) |\n`;
  }
  
  report += `\n## Detailed Findings\n\n`;
  for (const result of results) {
    report += `### ${result.route}\n\n- **Classification:** ${result.classification}\n- **HTTP Status:** ${result.httpStatus}\n- **Console Errors:** ${result.consoleErrors.length}\n- **API Calls:** ${result.apiCalls.length}\n\n`;
    
    if (result.notes.length > 0) {
      report += `**Notes:**\n`;
      for (const note of result.notes) report += `- ${note}\n`;
      report += `\n`;
    }
    
    if (result.apiCalls.length > 0) {
      report += `**API Calls:**\n`;
      for (const api of result.apiCalls) {
        const icon = api.status >= 400 ? '❌' : '✅';
        report += `- ${icon} \`${api.method} ${api.url}\` → ${api.status}\n`;
      }
      report += `\n`;
    }
  }
  
  report += `## Top Issues\n\n`;
  const apiFailures = results.flatMap(r => r.apiCalls.filter(a => a.status >= 400));
  
  if (broken > 0) {
    report += `### 🔴 Broken Pages (${broken})\n\n`;
    for (const result of results.filter(r => r.classification === '🔴 Broken')) {
      report += `- **${result.route}**: ${result.notes.join(', ')}\n`;
    }
    report += `\n`;
  }
  
  if (apiFailures.length > 0) {
    report += `### API Failures\n\n`;
    const failuresByEndpoint = apiFailures.reduce((acc, call) => {
      const key = `${call.method} ${call.url} → ${call.status}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const sorted = Object.entries(failuresByEndpoint).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [endpoint, count] of sorted) report += `- ${endpoint} (${count}x)\n`;
  }
  
  fs.writeFileSync(reportPath, report);
  console.log(`\n📊 Report written to: ${reportPath}`);
  return reportPath;
}

async function main() {
  console.log('🚀 Starting authenticated walkthrough...\n');
  
  await ensureTestUser();
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('localhost:8000') || url.includes('supabase.co')) {
      apiCalls.push({ url: url.replace(/\?.*$/, ''), status: response.status(), method: response.request().method() });
    }
  });
  
  try {
    await login(page);
    
    console.log('\n🔐 Verifying authentication...');
    await page.goto(`${BASE_URL}/current-finances`, { waitUntil: 'networkidle' });
    if (page.url().includes('/login')) throw new Error('Authentication failed - redirected to /login');
    console.log('✅ Authentication verified\n');
    
    for (const route of ROUTES) {
      const result = await testRoute(page, route);
      results.push(result);
    }
    
    const reportPath = await generateReport(results);
    
    const working = results.filter(r => r.classification === '✅ Working').length;
    const missing = results.filter(r => r.classification === '🟡 Renders but data missing').length;
    const broken = results.filter(r => r.classification === '🔴 Broken').length;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 WALKTHROUGH COMPLETE');
    console.log('='.repeat(60));
    console.log(`✅ ${working} green / 🟡 ${missing} yellow / 🔴 ${broken} red`);
    console.log(`📄 Report: ${reportPath}`);
    console.log('='.repeat(60) + '\n');
    
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
