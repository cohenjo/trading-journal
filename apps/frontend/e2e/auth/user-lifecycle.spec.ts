/**
 * e2e/auth/user-lifecycle.spec.ts
 *
 * P1 auth-tier tests: user provisioning, household auto-creation, and teardown.
 *
 * Tags: @auth
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_E2E_ALLOW_PROD=true  (if running against a non-dev Supabase URL)
 *
 * Run:
 *   npm run test:e2e:auth
 *   # or
 *   npx playwright test e2e/auth/user-lifecycle.spec.ts
 */

import { test, expect } from '../fixtures/test-user';
import { getAdminClient } from '../fixtures/admin';
import { provisionTestUser, teardownTestUser } from '../helpers/provision-test-user';

test.describe('test-user provisioning @auth', () => {
  test('creates a user with a valid userId and email @auth', async ({ testUser }) => {
    expect(testUser.userId).toBeTruthy();
    expect(testUser.email).toMatch(/^e2e_/);
  });

  test('auto-provisions a household for the created user @auth', async ({ testUser }) => {
    expect(testUser.householdId).toBeTruthy();
    expect(testUser.householdId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test('household_members row exists for the provisioned user @auth', async ({ testUser }) => {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('household_members')
      .select('user_id, household_id, role')
      .eq('user_id', testUser.userId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.household_id).toBe(testUser.householdId);
  });

  test('households row exists with created_by matching the provisioned user @auth', async ({ testUser }) => {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('households')
      .select('id, created_by')
      .eq('id', testUser.householdId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.created_by).toBe(testUser.userId);
  });

  test('auth session is injected — protected route resolves without redirect @auth', async ({
    testUser: { page },
  }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/summary$/);

    // Confirm we did NOT land on the login page
    const url = page.url();
    expect(url).not.toContain('/login');
    expect(url).not.toContain('/auth');
    expect(url).not.toContain('/signin');
  });
});

test.describe('teardown cascade verification @auth', () => {
  test('fixture cleanup RPC is denied to anonymous and authenticated clients @auth', async ({
    request,
    testUser,
  }) => {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const endpoint = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/e2e_reset_test_user`;
    for (const token of [anonKey, testUser.accessToken]) {
      const response = await request.post(endpoint, {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        data: { p_email: testUser.email },
      });
      expect([401, 403]).toContain(response.status());
      expect(await response.json()).toMatchObject({ code: '42501' });
    }
    const { data, error } = await getAdminClient()
      .from('household_members')
      .select('household_id')
      .eq('user_id', testUser.userId)
      .single();
    expect(error).toBeNull();
    expect(data?.household_id).toBe(testUser.householdId);
  });

  /**
   * This test verifies that deleting a user cascades correctly.
   * It provisions its own throwaway user (outside the fixture) so it can
   * delete the user mid-test and verify orphan-freedom.
   */
  test('deleting auth user cascades to household_members and households @auth', async () => {
    const user = await provisionTestUser();

    // Verify data exists before teardown
    const admin = getAdminClient();
    const { data: memberBefore, error: memberBeforeError } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.userId)
      .maybeSingle();
    expect(memberBeforeError).toBeNull();
    expect(memberBefore?.household_id).toBe(user.householdId);

    // Delete the auth user — should cascade
    await teardownTestUser(user.userId);

    // Household and member rows must be gone
    const { data: memberAfter, error: memberAfterError } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.userId)
      .maybeSingle();
    expect(memberAfterError).toBeNull();
    expect(memberAfter).toBeNull();

    const { data: householdAfter, error: householdAfterError } = await admin
      .from('households')
      .select('id')
      .eq('id', user.householdId)
      .maybeSingle();
    expect(householdAfterError).toBeNull();
    expect(householdAfter).toBeNull();

    const { data: authAfter, error: authAfterError } = await admin.auth.admin.getUserById(user.userId);
    expect(authAfter.user).toBeNull();
    expect(authAfterError?.status).toBe(404);
  });
});
