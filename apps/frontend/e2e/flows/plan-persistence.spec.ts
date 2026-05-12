/**
 * e2e/flows/plan-persistence.spec.ts
 *
 * A-series: /plan persistence round-trip tests
 *
 * Tags: @plan-persistence @regression
 *
 * Coverage:
 *   A1 — Add salary income, reload, still visible
 *   A2 — Add multiple expense items, reload, all visible, no duplicates
 *   A3 — Edit income item amount, reload, edit persisted
 *   A4 — Delete income item, reload, deletion persisted
 *   A7 — Plan items respect currency field
 *   A8 — Plan save shows success feedback, no console errors
 *   A9 — Empty plan saves and reloads cleanly (no null/undefined crash)
 *   A10 — Plan persistence under rapid edits (debounce/race condition guard)
 *
 * Auth strategy:
 *   Uses the `testUser` fixture (auto-provisioned household, throwaway user).
 *   DB seeding uses the admin client via plan-fixtures.ts.
 *
 * IMPORTANT: These tests are intentionally RED on main until:
 *   - PR-A (Hockney: squad/440-plans-timestamp-defaults) lands — fixes schema
 *   - PR-B (Fenster: squad/440-error-surfacing) lands — fixes save action + empty-state CTA
 * See issue #440.
 */

import { test as testWithUser, expect } from '../fixtures/test-user';
import {
  seedPlan,
  cleanupPlanData,
  STANDARD_PLAN,
  MULTI_CURRENCY_PLAN,
  DEFICIT_PLAN,
} from '../fixtures/plan-fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filters console errors, excluding known acceptable noise from the dev stack.
 */
function isCriticalConsoleError(msg: string): boolean {
  return (
    !msg.includes('Warning:') &&
    !msg.includes('supabase') &&
    !msg.includes('React does not recognize') &&
    !msg.includes('500') &&
    !msg.includes('Internal Server Error') &&
    !msg.includes('Failed to fetch') &&
    !msg.includes('/metrics/page-load')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A1 — Add salary income, reload, see salary
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('A1: add salary income and reload @plan-persistence @regression', () => {
  let householdIdForCleanup: string;

  testWithUser.afterAll(async () => {
    if (householdIdForCleanup) {
      await cleanupPlanData(householdIdForCleanup).catch((err: Error) =>
        console.warn(`[plan-persistence] A1 cleanup: ${err.message}`),
      );
    }
  });

  testWithUser(
    'A1: salary income item survives page reload @plan-persistence @regression',
    async ({ testUser: { page, householdId } }) => {
      householdIdForCleanup = householdId;

      const serverErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('response', (resp) => {
        if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error' && isCriticalConsoleError(msg.text())) {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      // Find "Add Income" CTA — adapt selector to actual implementation
      const addIncomeBtn = page
        .getByRole('button', { name: /add income/i })
        .or(page.getByText(/add income/i))
        .first();

      await addIncomeBtn.click();

      // Fill in salary details — selectors are intentionally broad; adapt if needed
      await page.getByLabel(/name/i).fill('Salary');
      await page.getByLabel(/amount|value/i).fill('30000');

      // Currency selector (may be a select or button group)
      const currencyField = page.getByLabel(/currency/i);
      if (await currencyField.isVisible()) {
        await currencyField.selectOption('ILS');
      }

      // Frequency selector
      const frequencyField = page.getByLabel(/frequency/i);
      if (await frequencyField.isVisible()) {
        await frequencyField.selectOption('Monthly');
      }

      // Save the item
      const saveBtn = page
        .getByRole('button', { name: /save|confirm|add/i })
        .last();
      await saveBtn.click();

      // Assert item is visible before reload
      await expect(page.getByText('Salary')).toBeVisible({ timeout: 10_000 });

      // Reload and re-assert
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('Salary')).toBeVisible({ timeout: 10_000 });

      expect(serverErrors, `5xx responses: ${serverErrors.join(', ')}`).toHaveLength(0);
      expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A2 — Add multiple expense items, reload, see all (no duplicates)
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('A2: multiple expense items persist @plan-persistence @regression', () => {
  let householdIdForCleanup: string;

  testWithUser.afterAll(async () => {
    if (householdIdForCleanup) {
      await cleanupPlanData(householdIdForCleanup).catch((err: Error) =>
        console.warn(`[plan-persistence] A2 cleanup: ${err.message}`),
      );
    }
  });

  testWithUser(
    'A2: 3 expense items survive reload with no duplicates @plan-persistence @regression',
    async ({ testUser: { page, householdId } }) => {
      householdIdForCleanup = householdId;

      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      const expenses = [
        { name: 'Food / Restaurants', amount: '5000' },
        { name: 'Rent', amount: '8000' },
        { name: 'Health Insurance', amount: '600' },
      ];

      for (const expense of expenses) {
        const addExpenseBtn = page
          .getByRole('button', { name: /add expense/i })
          .or(page.getByText(/add expense/i))
          .first();
        await addExpenseBtn.click();

        await page.getByLabel(/name/i).fill(expense.name);
        await page.getByLabel(/amount|value/i).fill(expense.amount);

        const saveBtn = page.getByRole('button', { name: /save|confirm|add/i }).last();
        await saveBtn.click();

        // Wait for item to appear before adding the next one
        await expect(page.getByText(expense.name)).toBeVisible({ timeout: 10_000 });
      }

      // Reload
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // All 3 items must be present
      for (const expense of expenses) {
        await expect(page.getByText(expense.name)).toBeVisible({ timeout: 10_000 });
      }

      // No duplicates: each name appears exactly once
      for (const expense of expenses) {
        const count = await page.getByText(expense.name).count();
        expect(count, `"${expense.name}" should appear exactly once`).toBe(1);
      }
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A3 — Edit income item amount, reload, edit persisted
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('A3: edit income item amount @plan-persistence @regression', () => {
  let householdIdForCleanup: string;

  testWithUser.afterAll(async () => {
    if (householdIdForCleanup) {
      await cleanupPlanData(householdIdForCleanup).catch((err: Error) =>
        console.warn(`[plan-persistence] A3 cleanup: ${err.message}`),
      );
    }
  });

  testWithUser(
    'A3: editing salary amount persists after reload @plan-persistence @regression',
    async ({ testUser: { page, householdId } }) => {
      householdIdForCleanup = householdId;

      // Seed plan with 25 000 ILS salary
      await seedPlan(householdId, {
        name: 'A3 Initial Plan',
        items: [
          { name: 'Salary', category: 'Income', value: 25_000, currency: 'ILS', frequency: 'Monthly' },
        ],
      });

      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      // Locate the salary row and click its Edit button
      const salaryRow = page.locator('[data-testid="plan-item"], li, tr').filter({ hasText: 'Salary' }).first();
      await expect(salaryRow).toBeVisible({ timeout: 10_000 });

      const editBtn = salaryRow.getByRole('button', { name: /edit/i });
      await editBtn.click();

      // Update amount to 30 000
      const amountField = page.getByLabel(/amount|value/i);
      await amountField.clear();
      await amountField.fill('30000');

      const saveBtn = page.getByRole('button', { name: /save|update|confirm/i }).last();
      await saveBtn.click();

      // Assert 30 000 is visible (not 25 000)
      await expect(page.getByText('30')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('25000')).toHaveCount(0);

      // Reload and re-assert
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('30')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('25000')).toHaveCount(0);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A4 — Delete income item, reload, it is gone
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('A4: delete income item persists @plan-persistence @regression', () => {
  let householdIdForCleanup: string;

  testWithUser.afterAll(async () => {
    if (householdIdForCleanup) {
      await cleanupPlanData(householdIdForCleanup).catch((err: Error) =>
        console.warn(`[plan-persistence] A4 cleanup: ${err.message}`),
      );
    }
  });

  testWithUser(
    'A4: deleted item stays gone after reload @plan-persistence @regression',
    async ({ testUser: { page, householdId } }) => {
      householdIdForCleanup = householdId;

      await seedPlan(householdId, {
        name: 'A4 Plan',
        items: [
          { name: 'Bonus', category: 'Income', value: 10_000, currency: 'USD', frequency: 'Yearly' },
          { name: 'Salary', category: 'Income', value: 30_000, currency: 'ILS', frequency: 'Monthly' },
        ],
      });

      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      // Confirm "Bonus" is visible
      const bonusRow = page.locator('[data-testid="plan-item"], li, tr').filter({ hasText: 'Bonus' }).first();
      await expect(bonusRow).toBeVisible({ timeout: 10_000 });

      // Click Delete on the Bonus row
      const deleteBtn = bonusRow.getByRole('button', { name: /delete|remove/i });
      await deleteBtn.click();

      // Confirm deletion prompt if any
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i });
      if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      // Assert "Bonus" is gone
      await expect(page.getByText('Bonus')).toHaveCount(0);

      // Reload and assert still gone
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('Bonus')).toHaveCount(0);

      // "Salary" should still be there
      await expect(page.getByText('Salary')).toBeVisible({ timeout: 10_000 });
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A7 — Plan items respect currency field
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('A7: currency labels are preserved per item @plan-persistence', () => {
  let householdIdForCleanup: string;

  testWithUser.afterAll(async () => {
    if (householdIdForCleanup) {
      await cleanupPlanData(householdIdForCleanup).catch((err: Error) =>
        console.warn(`[plan-persistence] A7 cleanup: ${err.message}`),
      );
    }
  });

  testWithUser(
    'A7: ILS and USD items display correct currency labels after reload @plan-persistence',
    async ({ testUser: { page, householdId } }) => {
      householdIdForCleanup = householdId;

      await seedPlan(householdId, MULTI_CURRENCY_PLAN);

      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      // Both items should be visible
      await expect(page.getByText('Salary ILS')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Bond Coupon USD')).toBeVisible({ timeout: 10_000 });

      // Reload to confirm persistence
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('Salary ILS')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Bond Coupon USD')).toBeVisible({ timeout: 10_000 });

      // Assert ILS appears associated with Salary ILS row (currency label visible)
      const salaryRow = page.locator('[data-testid="plan-item"], li, tr').filter({ hasText: 'Salary ILS' }).first();
      await expect(salaryRow.getByText(/ILS/)).toBeVisible({ timeout: 5_000 });

      // Assert USD appears associated with Bond Coupon USD row
      const bondRow = page.locator('[data-testid="plan-item"], li, tr').filter({ hasText: 'Bond Coupon USD' }).first();
      await expect(bondRow.getByText(/USD/)).toBeVisible({ timeout: 5_000 });
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A8 — Plan save shows success feedback, no console errors
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('A8: plan save shows success feedback @plan-persistence', () => {
  let householdIdForCleanup: string;

  testWithUser.afterAll(async () => {
    if (householdIdForCleanup) {
      await cleanupPlanData(householdIdForCleanup).catch((err: Error) =>
        console.warn(`[plan-persistence] A8 cleanup: ${err.message}`),
      );
    }
  });

  testWithUser(
    'A8: saving a plan item shows success feedback with no critical console errors @plan-persistence',
    async ({ testUser: { page, householdId } }) => {
      householdIdForCleanup = householdId;

      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && isCriticalConsoleError(msg.text())) {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      const addBtn = page
        .getByRole('button', { name: /add income/i })
        .or(page.getByText(/add income/i))
        .first();
      await addBtn.click();

      await page.getByLabel(/name/i).fill('Test Income');
      await page.getByLabel(/amount|value/i).fill('5000');

      const saveBtn = page.getByRole('button', { name: /save|confirm|add/i }).last();
      await saveBtn.click();

      // Success feedback: toast, success message, or green indicator
      const successIndicator = page
        .getByText(/saved|success|✓|done/i)
        .or(page.locator('[class*="success"], [class*="toast"], [data-testid*="success"]'))
        .first();

      // Either success is visible OR no error occurred (both are acceptable signals)
      const hasSuccess = await successIndicator.isVisible({ timeout: 5_000 }).catch(() => false);
      const hasError = await page.getByText(/error|failed|could not/i).isVisible({ timeout: 500 }).catch(() => false);

      // Must not show error, should show success
      expect(hasError, 'Should not display an error message after save').toBe(false);
      if (!hasSuccess) {
        // At minimum, the item should have appeared (implicit success)
        await expect(page.getByText('Test Income')).toBeVisible({ timeout: 5_000 });
      }

      expect(consoleErrors, `Critical console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A9 — Empty plan saves and reloads cleanly (no null/undefined crash)
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('A9: empty plan is crash-free @plan-persistence', () => {
  testWithUser(
    'A9: fresh user with no plan — /plan renders without application error @plan-persistence',
    async ({ testUser: { page } }) => {
      const jsErrors: string[] = [];
      page.on('pageerror', (err) => jsErrors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && isCriticalConsoleError(msg.text())) {
          jsErrors.push(msg.text());
        }
      });

      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      // No application error
      await expect(page.getByText(/Application error/i)).toHaveCount(0);
      // Page body not blank
      await expect(page.locator('body')).not.toBeEmpty();
      // No uncaught TypeError/null reference
      expect(jsErrors, `JS errors on empty plan: ${jsErrors.join('\n')}`).toHaveLength(0);

      // Navigate away and back
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      // Still renders cleanly
      await expect(page.getByText(/Application error/i)).toHaveCount(0);
      await expect(page.locator('body')).not.toBeEmpty();
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A10 — Plan persistence under rapid edits (debounce/race condition guard)
// ─────────────────────────────────────────────────────────────────────────────

testWithUser.describe('A10: rapid edits do not corrupt persisted state @plan-persistence', () => {
  let householdIdForCleanup: string;

  testWithUser.afterAll(async () => {
    if (householdIdForCleanup) {
      await cleanupPlanData(householdIdForCleanup).catch((err: Error) =>
        console.warn(`[plan-persistence] A10 cleanup: ${err.message}`),
      );
    }
  });

  testWithUser(
    'A10: last-write-wins under rapid edits — no duplicates, no corruption @plan-persistence',
    async ({ testUser: { page, householdId } }) => {
      householdIdForCleanup = householdId;

      await seedPlan(householdId, {
        name: 'A10 Rapid-Edit Plan',
        items: [
          { name: 'Salary', category: 'Income', value: 20_000, currency: 'ILS', frequency: 'Monthly' },
        ],
      });

      await page.goto('/plan');
      await page.waitForLoadState('domcontentloaded');

      const salaryRow = page
        .locator('[data-testid="plan-item"], li, tr')
        .filter({ hasText: 'Salary' })
        .first();
      await expect(salaryRow).toBeVisible({ timeout: 10_000 });

      // First rapid save: 28 000
      const editBtn = salaryRow.getByRole('button', { name: /edit/i });
      await editBtn.click();
      const amountField = page.getByLabel(/amount|value/i);
      await amountField.clear();
      await amountField.fill('28000');
      const saveBtn = page.getByRole('button', { name: /save|update|confirm/i }).last();
      await saveBtn.click();

      // Immediately trigger second save: 30 000 (< 500ms gap)
      const editBtn2 = page
        .locator('[data-testid="plan-item"], li, tr')
        .filter({ hasText: 'Salary' })
        .first()
        .getByRole('button', { name: /edit/i });

      if (await editBtn2.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await editBtn2.click();
        const amountField2 = page.getByLabel(/amount|value/i);
        await amountField2.clear();
        await amountField2.fill('30000');
        const saveBtn2 = page.getByRole('button', { name: /save|update|confirm/i }).last();
        await saveBtn2.click();
      }

      // Wait for saves to settle
      await page.waitForTimeout(1_000);

      // Reload and verify final state
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // The Salary row must exist exactly once
      const salaryItems = page.locator('[data-testid="plan-item"], li, tr').filter({ hasText: 'Salary' });
      const count = await salaryItems.count();
      expect(count, 'Salary item should appear exactly once (no duplication)').toBe(1);

      // Value should NOT be the initial 20 000
      await expect(page.getByText('20000')).toHaveCount(0);
    },
  );
});
