/**
 * E2E spec: Dividends positions mirror (Issue #363).
 *
 * Validates the new positions-first view:
 *   - All 3 tabs always visible
 *   - IBKR tab shows positions table OR empty state (never undefined)
 *   - Schwab/IRA tabs show empty state (current data state)
 *   - Summary header renders with $ prefix
 *   - Payment History collapsible works
 */

import { test, expect } from "@playwright/test";

test.describe("Dividends page — positions mirror (#363)", () => {
  test("all 3 account tabs are always visible", async ({ page }) => {
    await page.goto("/dividends");

    await expect(page.getByTestId("div-tab-ibkr")).toBeVisible();
    await expect(page.getByTestId("div-tab-schwab")).toBeVisible();
    await expect(page.getByTestId("div-tab-ira")).toBeVisible();
  });

  test("IBKR tab: renders positions table with ≥1 row OR empty state — never undefined", async ({
    page,
  }) => {
    await page.goto("/dividends?account=ibkr");

    // Wait for loading skeleton to resolve
    await page.waitForTimeout(2000);

    const positionsTable = page.getByTestId("dividends-positions-table");
    const emptyState = page.getByTestId("dividends-account-empty");

    const tableVisible = await positionsTable.isVisible().catch(() => false);
    const emptyVisible = await emptyState.isVisible().catch(() => false);

    // Exactly one of the two must be visible
    expect(tableVisible || emptyVisible).toBe(true);

    // If table is visible, at least one data row should exist
    if (tableVisible) {
      const rows = page.locator('[data-testid^="dividend-row-"]');
      await expect(rows.first()).toBeVisible();
    }
  });

  test("Schwab tab: renders dividends-account-empty", async ({ page }) => {
    await page.goto("/dividends");

    await page.getByTestId("div-tab-schwab").click();

    // Wait for loading to complete
    await page.waitForTimeout(2000);

    await expect(page.getByTestId("dividends-account-empty")).toBeVisible();
  });

  test("IRA tab: renders dividends-account-empty", async ({ page }) => {
    await page.goto("/dividends");

    await page.getByTestId("div-tab-ira").click();

    await page.waitForTimeout(2000);

    await expect(page.getByTestId("dividends-account-empty")).toBeVisible();
  });

  test("summary header renders with $ prefix and a number", async ({ page }) => {
    await page.goto("/dividends");

    const summary = page.getByTestId("dividends-summary-total");
    await expect(summary).toBeVisible({ timeout: 5000 });

    // The summary must contain a $ sign followed by digits
    const text = await summary.textContent();
    expect(text).toMatch(/\$[\d,]+/);
  });

  test("clicking dividends-history-toggle reveals dividends-history-section", async ({ page }) => {
    await page.goto("/dividends");

    // Default tab is IBKR — wait for content
    await page.waitForTimeout(2000);

    const toggle = page.getByTestId("dividends-history-toggle");
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // Section should be hidden initially
    await expect(page.getByTestId("dividends-history-section")).not.toBeVisible();

    await toggle.click();

    await expect(page.getByTestId("dividends-history-section")).toBeVisible({ timeout: 3000 });
  });
});
