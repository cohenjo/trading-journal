/**
 * E2E spec: Bonds page 3-account tabs (Issue #364).
 *
 * Validates that the Bond Ladder page renders 3 account tabs
 * and shows the correct empty state for Schwab / LeumiIRA.
 */

import { test, expect } from "@playwright/test";

test.describe("Bond Ladder page — 3 account tabs (#364)", () => {
  test("all 3 broker tabs are visible", async ({ page }) => {
    await page.goto("/ladder");

    await expect(page.getByTestId("bonds-tab-ibkr")).toBeVisible();
    await expect(page.getByTestId("bonds-tab-schwab")).toBeVisible();
    await expect(page.getByTestId("bonds-tab-ira")).toBeVisible();
  });

  test("IBKR tab is active by default", async ({ page }) => {
    await page.goto("/ladder");

    const ibkrTab = page.getByTestId("bonds-tab-ibkr");
    await expect(ibkrTab).toHaveAttribute("aria-selected", "true");
  });

  test("Schwab tab: shows empty state (no bond holdings)", async ({ page }) => {
    await page.goto("/ladder");

    await page.getByTestId("bonds-tab-schwab").click();

    await page.waitForTimeout(2000);

    await expect(page.getByTestId("bonds-account-empty")).toBeVisible({ timeout: 5000 });
  });

  test("IRA tab: shows empty state (no bond holdings)", async ({ page }) => {
    await page.goto("/ladder");

    await page.getByTestId("bonds-tab-ira").click();

    await page.waitForTimeout(2000);

    await expect(page.getByTestId("bonds-account-empty")).toBeVisible({ timeout: 5000 });
  });

  test("IBKR tab: shows bond-holdings-section or empty state — never undefined", async ({
    page,
  }) => {
    await page.goto("/ladder");

    await page.waitForTimeout(2000);

    const holdingsSection = page.getByTestId("bond-holdings-section");
    const emptyState = page.getByTestId("bonds-account-empty");

    const holdingsVisible = await holdingsSection.isVisible().catch(() => false);
    const emptyVisible = await emptyState.isVisible().catch(() => false);

    expect(holdingsVisible || emptyVisible).toBe(true);
  });
});
