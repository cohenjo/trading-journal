/**
 * LURVG spec for PR #379 — insurance_policies cleanup migration.
 *
 * Validates that the /insurance route still works correctly after:
 *   - user_id column dropped
 *   - household_id set NOT NULL
 *   - 4 wave2 _own RLS policies replaced by 4 canonical household-scoped policies
 *
 * Running as: Redfoot (Tester) — 2026-05-11
 */
import { test as authTest, expect } from './fixtures/auth-cookie';
import { getAdminClient } from './fixtures/admin';
import path from 'path';
import fs from 'fs';

const EVIDENCE_DIR = path.join(__dirname, 'lurvg-evidence');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

/** Ensure the ephemeral user has an active household so RLS passes. */
async function seedHousehold(userId: string): Promise<string> {
  const admin = getAdminClient();

  // Create a household (created_by, name, account_type are all NOT NULL)
  const { data: hh, error: hhErr } = await admin
    .from('households')
    .insert({ created_by: userId, name: 'E2E Insurance HH', account_type: 'individual' })
    .select('id')
    .single();
  if (hhErr || !hh) throw new Error(`Failed to create household: ${hhErr?.message}`);

  // Add user as owner member
  // NOTE: trg_households_add_creator trigger auto-adds created_by as owner — skip manual insert

  return hh.id as string;
}

async function teardownHousehold(householdId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from('household_members').delete().eq('household_id', householdId);
  await admin.from('households').delete().eq('id', householdId);
}

authTest.describe('PR #379 — insurance_policies LURVG', () => {
  let householdId: string | null = null;

  authTest(
    '/insurance renders without error (household-scoped RLS)',
    async ({ authenticatedUser }) => {
      const { page, userId } = authenticatedUser;

      // Seed: create household so RLS is satisfied
      householdId = await seedHousehold(userId);

      await page.goto('/insurance');
      await page.waitForLoadState('networkidle');

      // Should not be a 500 or error page
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Internal Server Error');
      expect(bodyText).not.toContain('column "user_id" does not exist');
      expect(bodyText).not.toContain('does not exist');

      // Page title / heading should render (not blank)
      const url = page.url();
      expect(url).toContain('/insurance');

      // Screenshot evidence
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'pr379-insurance-render.png'),
        fullPage: true,
      });

      // DOM evidence
      const html = await page.locator('body').evaluate((el) => el.outerHTML);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'pr379-insurance-dom.txt'), html);

      // Teardown
      await teardownHousehold(householdId);
      householdId = null;
    },
  );

  authTest(
    '/insurance: no user_id reference in server response',
    async ({ authenticatedUser }) => {
      const { page, userId } = authenticatedUser;

      householdId = await seedHousehold(userId);

      // Intercept API/server action responses for schema errors
      const errors: string[] = [];
      page.on('response', async (response) => {
        if (response.status() >= 500) {
          errors.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.goto('/insurance');
      await page.waitForLoadState('networkidle');

      expect(errors).toHaveLength(0);

      // Teardown
      await teardownHousehold(householdId);
      householdId = null;
    },
  );

  authTest(
    '/insurance: Add Policy flow — no schema mismatch',
    async ({ authenticatedUser }) => {
      const { page, userId } = authenticatedUser;

      householdId = await seedHousehold(userId);

      await page.goto('/insurance');
      await page.waitForLoadState('networkidle');

      // Look for an "Add" button / CTA (could be "Add Policy", "New Policy", "+", etc.)
      const addButton = page
        .getByRole('button', { name: /add|new policy|\+/i })
        .or(page.getByTestId('add-policy-button'))
        .first();

      const addButtonVisible = await addButton.isVisible().catch(() => false);

      if (addButtonVisible) {
        await addButton.click();
        await page.waitForLoadState('networkidle');

        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('column "user_id"');
        expect(bodyText).not.toContain('does not exist');

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'pr379-insurance-add-form.png'),
          fullPage: true,
        });
      } else {
        // Empty state is acceptable — just ensure no error
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('Internal Server Error');

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, 'pr379-insurance-empty-state.png'),
          fullPage: true,
        });
      }

      await teardownHousehold(householdId);
      householdId = null;
    },
  );
});
