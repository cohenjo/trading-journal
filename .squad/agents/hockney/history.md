# Hockney — Backend Lead

**Active Domain:** Backend architecture, API design, database operations, credit-card expense pipeline, RSU pricing pipeline.

**Full history archive:** `.squad/agents/hockney/history-archive-2026-05-30.md` (summarized; indexed by topic)

---

## 2026-05-30 — Expense Classification Save Failure (P1 Prod Regression)

**Task:** Fix prod classification save failure after Transportation taxonomy PR #489 merged. User sees "שגיאה בשמירת הסיווג" (Hebrew: "Error saving classification") when attempting to classify expenses in the credit-card expense resolution UI.

**Root cause:** CategoryPicker was using hardcoded fake UUIDs from `EXPENSE_CATEGORIES` array in `expenses.ts` (e.g., `"cat-transportation"`, `"cat-transportation-fuel"`) instead of real database UUIDs. When user selects a category, the frontend sends this fake ID to `/api/expenses/resolve`, which validates `category_id` against the `expense_categories` table. Validation fails with 404 "Category not found", and frontend displays the Hebrew error.

**Why this broke after PR #489:** The Transportation taxonomy migration preserved real UUIDs for existing categories (`fuel`, `travel-transit`) but the frontend's static `EXPENSE_CATEGORIES` array was never synchronized with the database. New Transportation subcategories (`transportation-insurance`, `transportation-maintenance`, `transportation-registration`) had real UUIDs in Postgres but fake placeholders in the TypeScript file. The mismatch was latent until a user tried to save a classification with one of the new categories.

**The contract surprise:** There was a TODO comment in `expenses.ts` line 120: `"TODO(CC-9): Hockney to add GET /api/expenses/categories endpoint so this list is fetched dynamically."` The `/api/expenses/categories` endpoint EXISTS (implemented in `categories/route.ts`) but was never wired into CategoryPicker. The hardcoded array was intended as a temporary fallback until the dynamic fetch was implemented — but that integration never happened, and the static list became stale the moment the Transportation migration changed category UUIDs.

**Fix:** Updated `CategoryPicker.tsx` to fetch categories dynamically from `/api/expenses/categories` on mount using the existing `getCategories()` API wrapper. The component now:
1. Fetches real categories with real UUIDs on mount
2. Falls back to the hardcoded `EXPENSE_CATEGORIES` array if the fetch fails (graceful degradation for offline/test scenarios)
3. All 15 existing CategoryPicker tests pass (they exercise the fallback path since tests have no Supabase credentials)

**Files changed:**
- `apps/frontend/src/app/finances/expenses/_components/CategoryPicker.tsx` (add `useEffect`, `useState`, call `getCategories()`)

**Commit:** `f270700` on `main` (direct push, single-file low-risk fix)

**Verification:** All CategoryPicker unit tests pass (15/15). TypeScript compilation clean. No backend changes needed — the categories endpoint was already production-ready.

## Learnings

- **Static frontend data goes stale the moment schema changes.** The hardcoded `EXPENSE_CATEGORIES` array was a ticking time bomb. Any migration that touches `expense_categories` breaks classification saves unless the TypeScript file is manually updated in lockstep. This pattern is fragile.

- **TODOs with integration work are not optional.** The TODO comment flagged the need to wire up the categories endpoint, but it was treated as "future work" rather than a prerequisite for the Transportation taxonomy PR. The dynamic fetch should have been implemented BEFORE shipping the migration.

- **Contract validation happens at API boundaries, not UI layer.** The frontend type system can't catch UUID mismatches — TypeScript sees `category.id: string` and is satisfied. The error surfaces only when the backend validates the FK constraint against Postgres. This meant the regression was silent until a user hit "save" in prod.

- **Hardcoded fallbacks must be synced with migrations.** If the hardcoded array is kept for offline/test scenarios, it must be updated in the same PR that changes the schema. Otherwise, local dev and tests pass (they use the stale array) while prod fails (it uses real DB UUIDs).

---

📌 **Team update (2026-05-30T07:57:13Z):** McManus's Transportation taxonomy split (PR #489, commit `1355ef6`) surfaced UUID staleness in CategoryPicker hardcoded constants. Pattern established: dynamic category fetching at runtime prevents future taxonomy-change regressions. Frontend lead note: Future taxonomy PRs should wire pickers to `/api/expenses/categories` as standard practice. — decided by McManus
📌 Team update (2026-05-30T14:01:30Z): CategoryPicker dynamic category fetching (2026-05-30 fix, commits f270700+fedef20) proved critical when McManus shipped Housing/Utilities taxonomy (commit 4d0e931, workflow 26685706819). New 7 housing subcategories were added to prod without any frontend code changes — CategoryPicker auto-discovered them at runtime via `/api/expenses/categories`. Pattern validated: dynamic category fetching at component mount is the right design. No more static type stubs needed when taxonomy changes. — McManus
