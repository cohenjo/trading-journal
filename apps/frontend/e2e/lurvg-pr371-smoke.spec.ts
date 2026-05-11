/**
 * LURVG smoke spec for PR #371 — regression guard for dividends/ladder/summary.
 */
import { test as authTest, expect } from './fixtures/auth-cookie';
import path from 'path';
import fs from 'fs';

const EVIDENCE_DIR = path.join(__dirname, 'lurvg-evidence');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

authTest.describe('PR #371 smoke — dividends/ladder/summary not broken', () => {
  authTest('/dividends — IBKR tab loads', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    await page.goto('/dividends');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/login/);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'pr371-smoke-dividends.png'), fullPage: true });
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
  });

  authTest('/ladder — loads', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    await page.goto('/ladder');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/login/);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'pr371-smoke-ladder.png'), fullPage: true });
    await expect(page.locator('main').first()).toBeVisible({ timeout: 10_000 });
  });

  authTest('/summary — loads', async ({ authenticatedUser }) => {
    const { page } = authenticatedUser;
    await page.goto('/summary');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/login/);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'pr371-smoke-summary.png'), fullPage: true });
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
  });
});
