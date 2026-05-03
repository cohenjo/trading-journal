/**
 * e2e/flows/household-bootstrap.spec.ts
 *
 * Tests for the household bootstrap / onboarding flow:
 *
 *   (a) Existing-household login — no banner, app loads normally.
 *   (b) Sign-out flow — sidebar-signout → /login, Supabase session cookie cleared.
 *   (c) [skip] First-login household picker — opens dialog, default Individual,
 *       can choose Joint, confirm calls RPC, banner disappears.
 *
 * Tags: @auth
 *
 * data-testid dependencies (Fenster's PR — not yet merged):
 *   household-banner        — onboarding banner shown when no household exists
 *   household-banner-setup  — CTA button inside the banner
 *   account-type-individual — Individual option in AccountTypePickerDialog
 *   account-type-joint      — Joint option in AccountTypePickerDialog
 *   account-type-confirm    — Confirm button in AccountTypePickerDialog
 *   sidebar-signout         — Sign Out button in the app sidebar
 *   signed-in-email         — Element showing the current user's email
 *
 * RPC dependency (Hockney's PR — not yet merged):
 *   ensure_household        — called on confirm to create/update household type
 *   v_my_active_household   — view used to check household presence
 *
 * Requires env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_E2E_ALLOW_PROD=true  (if running against a non-dev Supabase URL)
 */

import { test, expect } from '../fixtures/test-user';
import { ensureHousehold, ensureNoHousehold, hasServiceRoleEnv } from '../helpers/household';

test.describe('household bootstrap @auth', () => {
  // ── (a) Existing household — banner must NOT appear ───────────────────────

  test(
    'existing-household login: no banner, app loads normally @auth',
    async ({ testUser: { page, userId } }) => {
      if (!hasServiceRoleEnv()) {
        test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY not set — skipping household state assertion');
        return;
      }

      // Ensure the user definitely has a household (fixture should have done this, but be explicit)
      await ensureHousehold(userId, 'individual');

      const serverErrors: string[] = [];
      page.on('response', (resp) => {
        if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
      });

      // Gracefully skip when no local dev server is available
      try {
        await page.goto('/', { timeout: 8_000 });
      } catch {
        test.skip(true, 'No local dev server running — start with `npm run dev` on port 3999');
        return;
      }
      await page.waitForLoadState('domcontentloaded');

      // No 5xx errors
      expect(serverErrors).toHaveLength(0);

      // The household-banner MUST NOT be visible for an established user
      const banner = page.getByTestId('household-banner');
      await expect(banner).not.toBeVisible({ timeout: 8_000 });
    },
  );

  // ── (b) Sign-out flow ──────────────────────────────────────────────────────

  test(
    'sign-out: sidebar-signout → /login, session cookie cleared @auth',
    async ({ testUser: { page } }) => {
      // Gracefully skip when no local dev server is available
      try {
        await page.goto('/', { timeout: 8_000 });
      } catch {
        test.skip(true, 'No local dev server running — start with `npm run dev` on port 3999');
        return;
      }
      await page.waitForLoadState('domcontentloaded');

      // Sign-out button must be present in the sidebar (Fenster's data-testid).
      // Skip gracefully if Fenster's AccountTypePickerDialog + sidebar work isn't merged yet.
      const signoutBtn = page.getByTestId('sidebar-signout');
      const signoutExists = await signoutBtn.count() > 0;
      if (!signoutExists) {
        test.skip(
          true,
          'sidebar-signout testid not found — pending Fenster AccountTypePickerDialog PR',
        );
        return;
      }
      await expect(signoutBtn).toBeVisible({ timeout: 10_000 });
      await signoutBtn.click();

      // Should land on /login after sign-out
      await page.waitForURL(/\/login/, { timeout: 10_000 });
      expect(page.url()).toContain('/login');

      // Verify the Supabase session cookie is gone
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
      const ref = supabaseUrl.replace('https://', '').split('.')[0];
      const authCookieName = `sb-${ref}-auth-token`;

      const cookies = await page.context().cookies();
      const authCookie = cookies.find((c) => c.name === authCookieName);

      // Cookie must be absent or have an empty value after sign-out
      expect(authCookie?.value ?? '').toBe('');
    },
  );

  // ── (c) First-login household picker ──────────────────────────────────────
  // Skipped until:
  //   — Fenster's AccountTypePickerDialog + data-testids ship (household-banner,
  //     household-banner-setup, account-type-{individual,joint}, account-type-confirm)
  //   — Hockney's ensure_household RPC + v_my_active_household view are deployed
  // See: #155 (fixme pattern for backend-dependent tests)

  test.skip(
    'first-login: picker opens, default Individual, can choose Joint, confirm calls RPC, banner disappears @auth',
    async ({ testUser: { page, userId } }) => {
      // TODO: unblock when Fenster's AccountTypePickerDialog ships AND
      //       Hockney's ensure_household RPC is deployed.
      // Tracking: follow the test.fixme pattern in current-finances.spec.ts (#155).

      if (!hasServiceRoleEnv()) {
        test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY not set — cannot manipulate household state');
        return;
      }

      // Remove the auto-provisioned household so the user appears as a first-time visitor
      await ensureNoHousehold(userId);

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Banner MUST appear when there is no household
      const banner = page.getByTestId('household-banner');
      await expect(banner).toBeVisible({ timeout: 8_000 });

      // CTA button opens the AccountTypePickerDialog
      const setupBtn = page.getByTestId('household-banner-setup');
      await expect(setupBtn).toBeVisible();
      await setupBtn.click();

      // Individual option is selected by default
      const individualOption = page.getByTestId('account-type-individual');
      await expect(individualOption).toBeVisible({ timeout: 5_000 });
      await expect(individualOption).toHaveAttribute('aria-checked', 'true');

      // Switch to Joint
      const jointOption = page.getByTestId('account-type-joint');
      await expect(jointOption).toBeVisible();
      await jointOption.click();
      await expect(jointOption).toHaveAttribute('aria-checked', 'true');

      // Confirm → triggers ensure_household RPC (Hockney)
      const confirmBtn = page.getByTestId('account-type-confirm');
      await expect(confirmBtn).toBeVisible();
      await confirmBtn.click();

      // Banner must disappear once the household is established
      await expect(banner).not.toBeVisible({ timeout: 10_000 });
    },
  );
});
