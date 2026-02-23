import { test, expect } from "@playwright/test";

const DOM_CONTENT_LOADED_BUDGET_MS = Number(process.env.PERF_DCL_BUDGET_MS || "6000");
const LOAD_EVENT_BUDGET_MS = Number(process.env.PERF_LOAD_BUDGET_MS || "8000");
const TTFB_BUDGET_MS = Number(process.env.PERF_TTFB_BUDGET_MS || "2000");

test.describe("Page load performance", () => {
  test("plan page should stay within load budgets", async ({ page }) => {
    const response = await page.goto("/plan", { waitUntil: "domcontentloaded" });
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
    await expect(page).toHaveURL(/\/plan$/);

    const navTiming = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!navigation) {
        return null;
      }
      return {
        ttfb: navigation.responseStart - navigation.requestStart,
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
        load: navigation.loadEventEnd > 0 ? navigation.loadEventEnd - navigation.startTime : null,
      };
    });

    expect(navTiming).not.toBeNull();
    expect(navTiming!.ttfb).toBeLessThan(TTFB_BUDGET_MS);
    expect(navTiming!.domContentLoaded).toBeLessThan(DOM_CONTENT_LOADED_BUDGET_MS);
    if (navTiming!.load !== null) {
      expect(navTiming!.load).toBeLessThan(LOAD_EVENT_BUDGET_MS);
    }
  });
});
