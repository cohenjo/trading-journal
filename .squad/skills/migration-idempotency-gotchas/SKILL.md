# SKILL: Migration Idempotency Gotchas

**Domain:** Backend / Supabase migrations
**Author:** Hockney
**Last updated:** 2026-05-13

---

## The critical gotcha: `ADD COLUMN IF NOT EXISTS` silently skips DEFAULT

### What Postgres does

```sql
-- You write this (thinking it's safe and idempotent):
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
```

**If `created_at` already exists**, Postgres silently skips the entire `ADD COLUMN` statement — **including the `DEFAULT` clause**. The column keeps whatever default it had before (possibly `NULL`). No error, no warning. Migration "passes" while doing nothing.

### How to detect the silent skip

After applying a migration, query `pg_attrdef`:

```sql
SELECT a.attname, d.adbin::text AS column_default
FROM   pg_attribute a
LEFT   JOIN pg_attrdef d
         ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE  a.attrelid = 'public.your_table'::regclass
AND    a.attnum > 0
AND    NOT a.attisdropped
ORDER  BY a.attnum;
```

If `column_default` is NULL for a column you expected to have `DEFAULT now()`, the default was never applied.

### The correct approach

Always use `ALTER COLUMN ... SET DEFAULT` as a separate statement when the column may already exist:

```sql
-- Always applies, idempotent
ALTER TABLE public.plans ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.plans ALTER COLUMN updated_at SET DEFAULT now();

-- Silently no-ops if column exists
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
```

---

## Other idempotency patterns

### Triggers

Always drop before recreating:

```sql
DROP TRIGGER IF EXISTS trg_plans_updated_at ON public.plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE INSERT OR UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();
```

### Publications (supabase_realtime)

Use a DO block to handle missing publication on shadow/CI databases:

```sql
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.plans;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
```

---

## Real incident: GH #440

Migration `20260430130000_add_audit_columns.sql` used `ADD COLUMN IF NOT EXISTS ... DEFAULT now()` on `plans.created_at`/`updated_at` which already existed without defaults. Silent skip left both columns defaultless. Every `createPlan()` INSERT failed. Table: 0 rows. `/cash-flow` blank.

Fix: `20260513000811_fix_plans_audit_column_defaults.sql` — `ALTER COLUMN ... SET DEFAULT now()`.

---

## Critical: migration file in source ≠ migration applied in prod

**Lesson (from GH #440 regression, 2026-05-13):**
Merging a PR that includes a new `.sql` file under `supabase/migrations/` moves the file into the source tree but does **NOT** run it against the production Supabase project. Supabase migrations are deployed via a separate step: the Supabase CLI (`supabase db push`), a GitHub Action, the MCP `apply_migration` tool, or the dashboard — not by Vercel or the Netlify/Vercel build step.

### How to verify

Always check `supabase_migrations.schema_migrations` (or via the MCP `list_migrations` tool) against the deployed environment **after every migration PR merges**:

```sql
-- In prod Supabase: is my migration there?
SELECT * FROM supabase_migrations.schema_migrations
WHERE version = '20260513000811';
-- Zero rows → migration file merged into main but NEVER executed in prod.
```

Via MCP:
```
supabase-list_migrations  →  confirm your version appears in the list
```

### Prevention

Add a post-merge checklist item or CI step that compares `supabase/migrations/*.sql` filenames against `supabase_migrations.schema_migrations` and alerts on drift.

---

## Real incident: GH #440 regression, 2026-05-13

PR #442 merged `20260513000811_fix_plans_audit_column_defaults.sql` into `main`. Vercel deployed `bdf568f`. But the Supabase migration was never applied — `list_migrations` showed latest as `20260512115546`. Prod DB still had `created_at`/`updated_at` with no DEFAULT. Every `createPlan()` INSERT continued to throw NOT NULL violation. `/plan` showed "Plan not saved. Failed to create plan. Please try again." unchanged.

Fix: applied migration directly via MCP `supabase-apply_migration`. Smoke-test INSERT succeeded. Symptom resolved.

**Time between merge and resolution: ~0 if we'd run `list_migrations` post-merge.**

---

## Checklist before merging a migration

- [ ] Any `ADD COLUMN IF NOT EXISTS` with `DEFAULT`? If the column might pre-exist, use `ALTER COLUMN ... SET DEFAULT` separately.
- [ ] Run `pg_attrdef` check after applying locally to confirm defaults landed.
- [ ] Use `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`.
- [ ] Wrap `supabase_realtime` publication changes in a DO block.

## Checklist after merging a migration PR

- [ ] Run `supabase-list_migrations` (or `supabase db push` output) and confirm the new version appears.
- [ ] If deploying via GitHub Action: verify the Action succeeded — check the workflow run, not just the PR merge.
- [ ] If manual deploy needed: `supabase db push --linked` or apply via MCP immediately after merge.
- [ ] Do a smoke-test INSERT/SELECT on the affected table before closing the issue.
