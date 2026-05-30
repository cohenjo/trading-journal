# Decision: Dynamic Migration Discovery for CI Fallback Path

**Date:** 2026-05-30
**Author:** Kujan (DevOps/Platform)
**Context:** P1 bug — hardcoded migration allowlist in Supabase CI workflow silently skipped new migrations

## Problem

The `.github/workflows/supabase-migrations.yml` db-url fallback path had a hardcoded array of 2 specific migration filenames:

```bash
expense_migrations=(
  20260529122500_add_credit_card_expense_pipeline.sql
  20260529122501_seed_expense_categories.sql
)
```

The `apply_expense_pipeline_directly()` function only applied migrations in this array. Any new migration added to `supabase/migrations/` was silently skipped, even when the workflow ran with `[apply-migrations]` in the commit message.

**Impact:** McManus's PR #489 added `20260530055800_add_transportation_category.sql`. The workflow ran "successfully" but the Transportation migration was never applied. User was staring at stale taxonomy in prod (35 categories instead of 39).

## Root Cause

Hardcoded allowlists in CI scripts rot immediately and fail silently. The original implementation was written to apply only the expense pipeline migrations, but the function was never updated to be general-purpose as new migrations were added.

## Decision

**Replace hardcoded allowlist with dynamic discovery.**

New behavior (`apply_pending_migrations_directly`):
1. List all `*.sql` files in `supabase/migrations/` (sorted by version)
2. Query prod `supabase_migrations.schema_migrations` for applied versions
3. For each local migration whose version is NOT in prod's applied list, apply it via `psql -v ON_ERROR_STOP=1 -f migrations/{file}` and record it via the existing `record_migration` helper
4. After applying, run `verify_expense_tables` to validate baseline schema

**Safety invariants:**
- Idempotent — running twice is safe (the `on conflict (version) do nothing` in `record_migration` already handles this)
- Only applies LOCAL migrations to prod (never removes or alters prod-only history entries)
- Fails LOUD if any psql apply fails (set -euo pipefail already in place)

## Implementation

- **Commit f63185e:** Replaced `apply_expense_pipeline_directly()` with `apply_pending_migrations_directly()` in `.github/workflows/supabase-migrations.yml`
- **Commit 2f52292:** Fixed `20260512010000_enforce_dividend_yield_decimal.sql` to be idempotent (wrapped constraint creation in IF NOT EXISTS guard to handle prod drift)
- **Workflow run 26679731909:** Successfully applied 5 pending migrations including Transportation. Final verification: `expense_categories rows: 39` ✅

## Tradeoffs

**Pros:**
- Zero-maintenance — no need to update the workflow when adding new migrations
- Catches ALL pending migrations, not just a subset
- Fails loud if a migration fails (workflow exits with error)

**Cons:**
- Requires migrations to be idempotent (IF NOT EXISTS guards) to handle prod drift gracefully
- Slightly more complex logic than a hardcoded list (but the complexity is one-time, not ongoing)

## Pattern

**CI migration fallbacks must be dynamic, not hardcoded.**

Hardcoded allowlists rot immediately and fail silently. Dynamic discovery (sorted local files vs. prod history) is the only safe pattern for fallback migration paths that need to tolerate prod drift.

This pattern is now documented in `.squad/agents/kujan/history.md` and should be applied to any future CI scripts that need to apply migrations outside of the Supabase CLI's normal `db push` flow.
