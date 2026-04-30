/**
 * e2e/fixtures/auth.ts
 *
 * Playwright fixtures for authenticated test sessions.
 *
 * Sign-in is performed inside the browser context via page.evaluate() + supabase-js
 * loaded from esm.sh.  This ensures that @supabase/ssr sets the correct cookies that
 * the Next.js middleware expects — a plain fetch()-based sign-in does NOT work because
 * the SSR cookie jar lives in the browser context, not in the Node test process.
 */
import { test as base, expect, Page } from '@playwright/test';
import { createE2eUser, deleteE2eUser, makeE2eEmail } from './admin';

export interface AuthFixtures {
  /** A one-off throwaway user signed in for this test. */
  authenticatedUser: { page: Page; email: string; userId: string };
  /** Same as authenticatedUser but labelled as the household owner role. */
  householdOwner: { page: Page; email: string; userId: string };
}

async function signInInBrowser(
  page: Page,
  email: string,
  password: string,
  supabaseUrl: string,
  supabaseAnonKey: string
): Promise<void> {
  await page.evaluate(
    async ({ url, anonKey, email, password }) => {
      // Dynamically import supabase-js from CDN so SSR cookies are set in browser context
      const { createClient } = await import(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — CDN import; typed in playwright evaluate context
        'https://esm.sh/@supabase/supabase-js@2'
      );
      const client = createClient(url, anonKey);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`Sign-in failed: ${error.message}`);
    },
    { url: supabaseUrl, anonKey: supabaseAnonKey, email, password }
  );
}

const PASSWORD = 'E2eTestPass!1';

export const test = base.extend<AuthFixtures>({
  authenticatedUser: async ({ page }, use) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const email = makeE2eEmail();
    const { id: userId } = await createE2eUser(email, PASSWORD);

    // Navigate to app first so cookies are set in the correct origin
    await page.goto('/');
    await signInInBrowser(page, email, PASSWORD, supabaseUrl, supabaseAnonKey);

    await use({ page, email, userId });

    await deleteE2eUser(userId);
  },

  householdOwner: async ({ page }, use) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const email = makeE2eEmail();
    const { id: userId } = await createE2eUser(email, PASSWORD);

    await page.goto('/');
    await signInInBrowser(page, email, PASSWORD, supabaseUrl, supabaseAnonKey);

    await use({ page, email, userId });

    await deleteE2eUser(userId);
  },
});

export { expect };
