/**
 * e2e/fixtures/plan-fixtures.ts
 *
 * Seed helpers for /plan and /cash-flow E2E tests.
 *
 * All helpers use the service-role admin client (bypasses RLS) to seed
 * plan data directly into the `plans` table for a given household.
 *
 * Data model:
 *   - Plans are rows in `public.plans` with a `data` JSONB column containing
 *     `PlanData { items: PlanItem[], milestones: [], settings: {} }`.
 *   - Items have category: 'Income' | 'Expense' | 'Account' | 'Asset' | 'Liability'.
 *
 * Teardown:
 *   Call `cleanupPlanData(householdId)` in afterAll to remove seeded plans.
 *   The shared `cleanupHouseholdData` from seed-data.ts also covers plans
 *   (it deletes all rows scoped to the household).
 *
 * Usage:
 *   import { seedPlan, seedSalaryAndExpenses, cleanupPlanData } from '../fixtures/plan-fixtures';
 *
 *   test.beforeEach(async ({ testUser: { householdId } }) => {
 *     await seedPlan(householdId, STANDARD_INCOME_EXPENSE_PLAN);
 *   });
 */

import { getAdminClient } from './admin';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanItemSeed {
  name: string;
  category: 'Income' | 'Expense' | 'Asset' | 'Liability' | 'Account';
  value: number;
  currency?: string;
  frequency?: 'Monthly' | 'Yearly' | 'One-time';
  growth_rate?: number;
  owner?: string;
}

export interface PlanSeed {
  name?: string;
  description?: string;
  items: PlanItemSeed[];
}

// ─── Canonical seed data constants ───────────────────────────────────────────

/** Standard salary + 3-expense plan (used in A1–A4, B1–B5, B9, B12). */
export const STANDARD_PLAN: PlanSeed = {
  name: 'E2E Standard Plan',
  items: [
    { name: 'Salary', category: 'Income', value: 30_000, currency: 'ILS', frequency: 'Monthly' },
    { name: 'Food / Restaurants', category: 'Expense', value: 5_000, currency: 'ILS', frequency: 'Monthly' },
    { name: 'Rent', category: 'Expense', value: 8_000, currency: 'ILS', frequency: 'Monthly' },
    { name: 'Health Insurance', category: 'Expense', value: 600, currency: 'ILS', frequency: 'Monthly' },
  ],
};

/** Income-only plan: salary, no expenses (used in B2). */
export const INCOME_ONLY_PLAN: PlanSeed = {
  name: 'E2E Income-Only Plan',
  items: [
    { name: 'Salary', category: 'Income', value: 30_000, currency: 'ILS', frequency: 'Monthly' },
  ],
};

/** Deficit plan: income < expenses (used in B5). */
export const DEFICIT_PLAN: PlanSeed = {
  name: 'E2E Deficit Plan',
  items: [
    { name: 'Salary', category: 'Income', value: 5_000, currency: 'ILS', frequency: 'Monthly' },
    { name: 'Living Costs', category: 'Expense', value: 20_000, currency: 'ILS', frequency: 'Monthly' },
  ],
};

/**
 * Multi-currency plan: ILS salary + USD bond coupon (used in A7).
 * Tests that currency labels are stored and displayed correctly per item.
 */
export const MULTI_CURRENCY_PLAN: PlanSeed = {
  name: 'E2E Multi-Currency Plan',
  items: [
    { name: 'Salary ILS', category: 'Income', value: 30_000, currency: 'ILS', frequency: 'Monthly' },
    { name: 'Bond Coupon USD', category: 'Income', value: 500, currency: 'USD', frequency: 'Monthly' },
  ],
};

/**
 * 3-income-stream snapshot plan (used in B6 — marked fixme until income-stream contract decided).
 * These values match the seed plan in the test plan document:
 *   Options:   ~15 000 USD/year
 *   Dividends: ~26 000 USD/year
 *   Bonds:     ~80 000 ILS/year
 */
export const THREE_STREAM_PLAN: PlanSeed = {
  name: 'E2E 3-Stream Plan',
  items: [
    { name: 'Options Cash Flow', category: 'Income', value: 15_000, currency: 'USD', frequency: 'Yearly' },
    { name: 'Dividend Income', category: 'Income', value: 26_000, currency: 'USD', frequency: 'Yearly' },
    { name: 'Bond Coupons', category: 'Income', value: 80_000, currency: 'ILS', frequency: 'Yearly' },
    { name: 'Living Costs', category: 'Expense', value: 10_000, currency: 'ILS', frequency: 'Monthly' },
  ],
};

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/**
 * Seeds a plan row into `public.plans` for the given household.
 * Returns the created plan id.
 */
export async function seedPlan(householdId: string, seed: PlanSeed): Promise<number> {
  const admin = getAdminClient();

  const items = seed.items.map((item, idx) => ({
    id: `e2e-item-${Date.now()}-${idx}`,
    name: item.name,
    category: item.category,
    value: item.value,
    currency: item.currency ?? 'ILS',
    frequency: item.frequency ?? 'Monthly',
    growth_rate: item.growth_rate ?? 0,
    owner: item.owner ?? 'You',
  }));

  const { data, error } = await admin
    .from('plans')
    .insert({
      household_id: householdId,
      name: seed.name ?? 'E2E Test Plan',
      description: seed.description ?? null,
      data: { items, milestones: [], settings: {} },
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`[plan-fixtures] Failed to seed plan: ${error?.message ?? 'no data'}`);
  }

  return data.id as number;
}

/**
 * Removes all plan rows for the given household.
 * Safe to call in afterAll/afterEach even if no plans were seeded.
 */
export async function cleanupPlanData(householdId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from('plans').delete().eq('household_id', householdId);
}
