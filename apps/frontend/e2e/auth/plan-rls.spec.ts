/**
 * e2e/auth/plan-rls.spec.ts
 *
 * A5: Multi-user RLS isolation — plans table is household-scoped.
 *
 * Tags: @plan-persistence @rls @auth @regression
 *
 * Verifies that PostgREST RLS (`is_household_member()`) prevents User B
 * from seeing User A's plan items and vice versa.
 *
 * Pattern: Two separate testUser fixture instances in one describe block,
 * each with independent browser context (separate cookie jars).
 *
 * Reference: e2e/auth/user-lifecycle.spec.ts for provisioning patterns.
 * Reference: e2e/lurvg-pr375-rls-policies.spec.ts for RLS pattern.
 */

import { test as base, expect } from '@playwright/test';
import { createE2eUser, makeE2eEmail, getAdminClient } from '../fixtures/admin';
import { teardownTestUser } from '../helpers/provision-test-user';
import { seedPlan, cleanupPlanData } from '../fixtures/plan-fixtures';

const PASSWORD = 'E2eTestPass!1';

/**
 * Obtains a Supabase session via password grant and injects the auth cookie.
 * Mirrors the pattern in e2e/fixtures/test-user.ts.
 */
async function injectAuthCookie(
  context: import('@playwright/test').BrowserContext,
  email: string,
): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const resp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });

  if (!resp.ok) {
    throw new Error(`[plan-rls] password grant failed for ${email}: ${resp.status}`);
  }

  const session = await resp.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at?: number;
    token_type: string;
    user: unknown;
  };
  if (!session.expires_at) {
    session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
  }

  const ref = supabaseUrl.replace('https://', '').split('.')[0];
  const cookieName = `sb-${ref}-auth-token`;
  const cookieValue = 'base64-' + Buffer.from(JSON.stringify(session), 'utf-8').toString('base64url');

  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
      expires: session.expires_at,
    },
  ]);

  return session.access_token;
}

/**
 * Waits for household auto-provision trigger to fire.
 */
async function waitForHousehold(userId: string): Promise<string> {
  const admin = getAdminClient();
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const { data } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (data?.household_id) return data.household_id as string;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`[plan-rls] household not provisioned for ${userId} within 8s`);
}

// ─────────────────────────────────────────────────────────────────────────────
// A5 — Multi-user RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

base.describe('A5: /plan RLS isolation between households @plan-persistence @rls @auth @regression', () => {
  let userAId: string;
  let userBId: string;
  let householdAId: string;
  let householdBId: string;

  base.afterAll(async () => {
    await Promise.all([
      userAId ? cleanupPlanData(householdAId).catch(() => void 0) : Promise.resolve(),
      userBId ? cleanupPlanData(householdBId).catch(() => void 0) : Promise.resolve(),
      userAId ? teardownTestUser(userAId).catch(() => void 0) : Promise.resolve(),
      userBId ? teardownTestUser(userBId).catch(() => void 0) : Promise.resolve(),
    ]);
  });

  base(
    'A5: User B cannot see User A\'s plan items and vice versa @plan-persistence @rls',
    async ({ browser }) => {
      // Provision two independent users
      const emailA = makeE2eEmail();
      const emailB = makeE2eEmail();

      const [{ id: idA }, { id: idB }] = await Promise.all([
        createE2eUser(emailA, PASSWORD),
        createE2eUser(emailB, PASSWORD),
      ]);
      userAId = idA;
      userBId = idB;

      // Wait for households
      [householdAId, householdBId] = await Promise.all([
        waitForHousehold(idA),
        waitForHousehold(idB),
      ]);

      // Seed distinct plan items for each user
      await Promise.all([
        seedPlan(householdAId, {
          name: 'User A Plan',
          items: [{ name: 'Salary A', category: 'Income', value: 30_000, currency: 'ILS', frequency: 'Monthly' }],
        }),
        seedPlan(householdBId, {
          name: 'User B Plan',
          items: [{ name: 'Salary B', category: 'Income', value: 20_000, currency: 'ILS', frequency: 'Monthly' }],
        }),
      ]);

      // --- User A context ---
      const ctxA = await browser.newContext();
      const pageA = await ctxA.newPage();
      await injectAuthCookie(ctxA, emailA);
      await pageA.goto('/plan');
      await pageA.waitForLoadState('domcontentloaded');
      // User A sees their own salary
      await expect(pageA.getByText('Salary A')).toBeVisible({ timeout: 10_000 });
      // User A does NOT see User B's salary
      await expect(pageA.getByText('Salary B')).toHaveCount(0);
      await ctxA.close();

      // --- User B context ---
      const ctxB = await browser.newContext();
      const pageB = await ctxB.newPage();
      await injectAuthCookie(ctxB, emailB);
      await pageB.goto('/plan');
      await pageB.waitForLoadState('domcontentloaded');
      // User B sees their own salary
      await expect(pageB.getByText('Salary B')).toBeVisible({ timeout: 10_000 });
      // User B does NOT see User A's salary
      await expect(pageB.getByText('Salary A')).toHaveCount(0);
      await ctxB.close();
    },
  );
});
