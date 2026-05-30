# Skill: Dynamic Migration Discovery for CI Fallback Paths

**Category:** DevOps / CI/CD
**Applies to:** GitHub Actions workflows, GitLab CI, Azure Pipelines, any CI script that needs to apply database migrations outside of the standard migration tool

## Problem

Hardcoded migration allowlists in CI scripts rot immediately and fail silently. When a CI workflow has a fallback path for applying migrations (e.g., when the standard migration tool can't be used due to drift or environment constraints), it's tempting to hardcode a list of specific migration files to apply.

**Example anti-pattern:**

```bash
migrations=(
  20260529122500_add_credit_card_expense_pipeline.sql
  20260529122501_seed_expense_categories.sql
)
for migration in "${migrations[@]}"; do
  psql "$DB_URL" -f "migrations/$migration"
done
```

This works initially, but as soon as a new migration is added, it's silently skipped unless the CI script is updated. The workflow reports success, but the new migration never reaches production.

## Solution: Dynamic Discovery

Replace hardcoded lists with dynamic discovery that compares local migration files against the production migration history.

**Pattern:**

```bash
apply_pending_migrations() {
  # 1. List all local migration files (sorted by version)
  local pending_migrations=()
  while IFS= read -r file; do
    pending_migrations+=("$(basename "$file")")
  done < <(find migrations -maxdepth 1 -type f -name '[0-9]*_*.sql' | sort)

  # 2. Query prod for applied migrations
  local applied_versions
  applied_versions="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc \
    "select version from schema_migrations order by version")"

  # 3. Filter to pending only
  local pending=()
  for migration in "${pending_migrations[@]}"; do
    version="${migration%%_*}"
    if ! grep -qx "$version" <<< "$applied_versions"; then
      pending+=("$migration")
    fi
  done

  # 4. Apply each pending migration
  if [ "${#pending[@]}" -eq 0 ]; then
    echo "No pending migrations."
    return
  fi

  echo "Applying ${#pending[@]} pending migration(s):"
  for migration in "${pending[@]}"; do
    echo "  - $migration"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f "migrations/$migration"
    # Record in schema_migrations table
    record_migration "$migration"
  done
}
```

## Key Principles

1. **Zero maintenance** — No need to update the CI script when adding new migrations
2. **Fail loud** — Use `set -euo pipefail` and `psql -v ON_ERROR_STOP=1` so failures are visible
3. **Idempotent migrations** — Migrations must handle prod drift gracefully (use `IF NOT EXISTS` guards)
4. **Sorted discovery** — Always process migrations in version order (`sort` the find output)
5. **Single source of truth** — The filesystem (`supabase/migrations/`) is the source of truth, not the CI script

## When to Use This Pattern

- You have a CI migration fallback path due to known prod drift
- You're applying migrations in an environment where the standard migration tool (e.g., `supabase db push`) can't be used
- You need to apply migrations via direct database connection instead of through a CLI

## When NOT to Use This Pattern

- If the standard migration tool works reliably, use it (e.g., `supabase db push --linked`)
- If you have a small number of one-time migrations, a hardcoded list is acceptable (but document why)

## Tradeoffs

**Pros:**
- Zero maintenance as migrations are added
- Catches ALL pending migrations automatically
- Fails loud if a migration fails

**Cons:**
- Requires migrations to be idempotent to handle prod drift
- Slightly more complex than a hardcoded list (one-time cost)

## Real-World Example

See `.github/workflows/supabase-migrations.yml` in the trading-journal repo. The `apply_pending_migrations_directly()` function implements this pattern for the Supabase db-url fallback path.

**Commits:**
- f63185e: Initial implementation of dynamic discovery
- 2f52292: Idempotency fix for constraint creation

**Workflow run:** 26679731909 (2026-05-30T08:54) — Successfully applied 5 pending migrations including the Transportation taxonomy migration that was previously skipped.

## References

- Original bug report: McManus PR #489 (Transportation migration silently skipped)
- Decision document: `.squad/decisions/inbox/kujan-dynamic-migration-fallback-2026-05-30.md`
- Kujan history: `.squad/agents/kujan/history.md` (2026-05-30 entry)
