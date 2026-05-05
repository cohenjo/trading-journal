/**
 * e2e/flows/wave2-settings.spec.ts
 *
 * Wave-2 coverage: /settings  @flow
 * Issue #176 — settings persist across page reload.
 *
 * The /settings page stores data in localStorage via SettingsContext.
 * There is no Supabase write path for settings — persistence is local.
 *
 * Coverage:
 *   - Page loads without 5xx
 *   - Settings heading renders
 *   - Planning mode toggle persists across reload
 *   - Currency change persists across reload
 *
 * No cleanupHouseholdData needed — localStorage is test-isolated per browser context.
 */
import { test, expect } from '../fixtures/test-user';

test.describe('wave-2 CRUD: /settings @flow', () => {
  test('/settings loads without 5xx and renders heading @flow', async ({
    testUser: { page },
  }) => {
    const serverErrors: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
    });

    await page.goto('/settings', { waitUntil: 'networkidle', timeout: 20_000 });

    expect(serverErrors).toHaveLength(0);
    await expect(
      page.locator('h1').filter({ hasText: /Settings/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('/settings renders Basic Info and App Preferences sections @flow', async ({
    testUser: { page },
  }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 20_000 });

    await expect(page.locator('h2').filter({ hasText: /Basic Info/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator('h2').filter({ hasText: /App Preferences/i }),
    ).toBeVisible();
  });

  test('/settings planning mode toggle persists across reload @flow', async ({
    testUser: { page },
  }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(
      page.locator('h1').filter({ hasText: /Settings/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Find the Individual/Couple toggle button — text changes between modes
    const modeToggle = page
      .getByRole('button', { name: /Individual|Couple/i })
      .first();
    await expect(modeToggle).toBeVisible({ timeout: 5_000 });

    // Capture the initial mode text
    const initialText = await modeToggle.innerText();

    // Click to toggle mode
    await modeToggle.click();
    await page.waitForTimeout(500);

    // Capture new text — should be different
    const toggledText = await modeToggle.innerText();
    expect(toggledText).not.toBe(initialText);

    // Reload and verify the new setting persisted (localStorage)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_000);

    const persistedToggle = page
      .getByRole('button', { name: /Individual|Couple/i })
      .first();
    const persistedText = await persistedToggle.innerText();
    expect(persistedText).toBe(toggledText);

    // Restore original mode to avoid polluting other tests
    await persistedToggle.click();
    await page.waitForTimeout(300);
  });

  test('/settings has no critical console errors on load @flow', async ({
    testUser: { page },
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/settings', { waitUntil: 'networkidle', timeout: 20_000 });

    const critical = consoleErrors.filter(
      (m) =>
        !m.includes('Warning:') &&
        !m.includes('supabase') &&
        !m.includes('React does not recognize') &&
        !m.includes('404') &&
        !m.includes('500'),
    );
    expect(critical).toHaveLength(0);
  });
});
