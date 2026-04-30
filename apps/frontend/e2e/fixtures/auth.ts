/**
 * Playwright fixtures for authenticated E2E tests.
 *
 * Provides:
 *   authenticatedUser  — throwaway Supabase user, signed in, page with live session
 *   householdOwner     — authenticated user + a household row seeded via admin API
 *
 * Usage:
 *   import { test } from '../fixtures/auth';
 *   test('holdings page', async ({ authenticatedUser: { page } }) => { ... });
 */

import { test as base, type Page } from '@playwright/test';
import { createBrowserClient } from '@supabase/ssr';
import { createE2eUser, deleteE2eUser } from './admin';

export interface AuthUserFixture {
  page: Page;
  userId: string;
  email: string;
  password: string;
}

export interface HouseholdOwnerFixture extends AuthUserFixture {
  householdId: string;
}

/**
 * Sign in via the Supabase browser client inside the Playwright browser context.
 * This sets the auth cookies the SSR middleware expects.
 */
async function signInWithSupabase(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      '[e2e/auth] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }

  // Navigate to the app first so document.cookie is scoped to the right origin
  await page.goto('/');

  // Run sign-in inside the browser context so cookies are set in the browser jar
  const result = await page.evaluate(
    async ([url, key, em, pw]) => {
      // @ts-expect-error — evaluated in browser, supabase loaded via CDN-less inline
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const client = createClient(url, key, {
        auth: { persistSession: true, storageKey: 'sb-session' },
      });
      const { data, error } = await client.auth.signInWithPassword({ email: em, password: pw });
      return { userId: data?.user?.id ?? null, error: error?.message ?? null };
    },
    [supabaseUrl, anonKey, email, password] as [string, string, string, string],
  );

  if (result.error || !result.userId) {
    throw new Error(`[e2e/auth] signInWithPassword failed: ${result.error}`);
  }

  // Reload so Next.js SSR middleware picks up the new session cookies
  await page.reload();
}

export const test = base.extend<{
  authenticatedUser: AuthUserFixture;
  householdOwner: HouseholdOwnerFixture;
}>({
  authenticatedUser: async ({ page }, use) => {
    const { id, email, password } = await createE2eUser();

    await signInWithSupabase(page, email, password);

    await use({ page, userId: id, email, password });

    // Teardown: delete the throwaway user
    await deleteE2eUser(id);
  },

  householdOwner: async ({ page }, use) => {
    const { id, email, password } = await createE2eUser();

    await signInWithSupabase(page, email, password);

    // TODO (round 2): seed a household row via admin Supabase client
    // and return householdId. For now placeholder value.
    const householdId = 'pending-round-2';

    await use({ page, userId: id, email, password, householdId });

    await deleteE2eUser(id);
  },
});

export { expect } from '@playwright/test';
