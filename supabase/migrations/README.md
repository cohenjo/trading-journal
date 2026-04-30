# Supabase Migrations

> ⚠️ **This schema has NOT yet been tested.** Run `supabase db reset` locally before pushing to any remote project.

## Prerequisites

`supabase init` must be run in the repo root before these migrations will be picked up. The CLI creates `supabase/config.toml`; migrations in this directory are applied in filename-lexicographic (timestamp) order.

## Timestamp ordering scheme

Filenames follow the pattern `YYYYMMDDHHMMSS_<slug>.sql`. Migrations are applied in ascending order. Gaps in the sequence are intentional — leave room for hotfixes between major migrations. All times are UTC.

## Apply locally

```bash
supabase start          # starts local Postgres + Studio
supabase db reset       # drops and recreates the local DB, then runs all migrations in order
```

## Apply to a remote project

```bash
supabase link --project-ref <ref>   # links to trading-journal-dev or trading-journal-prod
supabase db push                     # applies pending migrations to the linked remote project
```

Use `--project-ref` from the Supabase dashboard → Project Settings → General.

## Migration Order (dependency graph)

```
20260430120000_households_and_members        ← must run FIRST; creates public.households
20260430120100_rls_helpers                   ← depends on households table
20260430120200_rls_policies_households       ← depends on rls_helpers
20260430130000_add_audit_columns             ← depends on all app tables existing (Alembic baseline)
20260430130100_add_household_id              ← depends on 120000 (households(id) FK target)
20260430130200_add_owner_user_id             ← depends on auth.users existing (Supabase-managed)
20260430130300_split_trading_account_config  ← ⚠️ SKETCH ONLY — awaiting user decision
20260430130400_retire_local_user_table       ← ⚠️ DESTRUCTIVE — run only after auth migration
```

## Migrations in this batch (TJ-005 / 2026-04-30, batch 1 — Rabin)

| File | Description |
|---|---|
| `20260430120000_households_and_members.sql` | `household_role` enum, `households` table, `household_members` table, composite PK, FK cascade, active-member index |
| `20260430120100_rls_helpers.sql` | `is_household_member()` + `is_household_owner()` security-definer helpers; grant to `authenticated` only |
| `20260430120200_rls_policies_households.sql` | RLS enable + all SELECT/INSERT/UPDATE/DELETE policies on both tables; `add_creator_as_owner` trigger |

## Migrations in this batch (TJ-005 / 2026-04-30, batch 2 — Hockney)

| File | Description | Tables Affected | Status |
|---|---|---|---|
| `20260430130000_add_audit_columns.sql` | `tg_update_timestamp()` trigger fn + `created_at`, `updated_at`, `deleted_at` columns on all household + owner-private tables | 14 tables | ✅ Ready to run |
| `20260430130100_add_household_id.sql` | `household_id uuid references public.households(id)` + index on 12 household tables | 12 tables | ✅ Ready to run (nullable; backfill before NOT NULL) |
| `20260430130200_add_owner_user_id.sql` | `owner_user_id uuid references auth.users(id)` + index on `note`, `backtestrun` | 2 tables | ✅ Ready to run (nullable; backfill before NOT NULL) |
| `20260430130300_drop_trading_account_secrets.sql` | DROP secret columns + `trading_account_secrets` (sketch); add `household_id`; RLS on `trading_account_config` | 1 table | ✅ Decision #3 resolved |
| `20260430130400_user_to_user_profile.sql` | DROP `public.user` CASCADE; CREATE `public.user_profile`; auth trigger; backfill | 1 table dropped, 1 created | ⚠️ DESTRUCTIVE — Decision #4 |
| `20260430130500_relax_delete_policies.sql` | Replace `USING (false)` DELETE policies on `households` + `household_members` with owner-only hard-delete | 2 tables | ✅ Decision #1 resolved |
| `20260430130600_repoint_user_fks.sql` | FK audit result: no `public.user` FK constraints found — no repoints needed (sequence placeholder) | — | ✅ Decision #4 supplementary |

### Tables NOT receiving household_id / owner_user_id (by design)

| Table | Reason |
|---|---|
| `ndx1m`, `dailybar`, `dividend_ticker_data`, `optioncontract`, `historicaloptionbar` | Global-reference market data; no per-tenant scoping needed |
| `backtesttrade` | Inherits ownership from `backtestrun` via FK JOIN; no direct column needed |
| `households`, `household_members` | System/infra; RLS already live (batch 1) |
| `trading_account_config` | Dual-ownership — deferred to batch 3 after user decision |
| `user` | Being retired; do not add FK columns |

## Migrations in this batch (TJ-006 / 2026-04-30, batch 3 — McManus)

| File | Description |
|---|---|
| `20260430140000_create_schemas.sql` | Create `raw`, `compute`, `cooked` schema namespaces; schema-level REVOKE/GRANT (service_role owns raw+compute; authenticated gets USAGE on cooked only) |
| `20260430140100_raw_tables.sql` | Raw landing-zone tables: `raw.broker_trade_events`, `raw.market_data_quotes`, `raw.dividend_announcements`, `raw.broker_statements`; append-only, service_role read/write, no authenticated access |
| `20260430140200_compute_tables.sql` | Compute workspace tables: `compute.pnl_runs`, `compute.daily_pnl_intermediates`, `compute.position_snapshots`; service_role only |
| `20260430140300_cooked_tables.sql` | Cooked UI tables + `_live` views: `cooked.dashboard_summary`, `cooked.position_history`, `cooked.daily_performance`; RLS via `is_household_member()`; `_freshness_seconds` exposed via companion views (PG 15 rejects `now()` in generated columns — see migration header) |

Dependency: `20260430140000` must run before `140100`–`140300`. Batch 3 depends on `public.households` existing (batch 1, `20260430120000`).

**Cooked tables are SKELETONS** — actual domain columns arrive in TJ-011 (compute worker) and TJ-020 (dashboard reads). This batch establishes schema namespaces, access controls, and RLS structure only.

### Updated migration order (dependency graph)

```
20260430120000  households_and_members           ← FIRST; creates public.households
20260430120100  rls_helpers                       ← depends on households
20260430120200  rls_policies_households           ← depends on rls_helpers
20260430130000  add_audit_columns                 ← depends on app tables
20260430130100  add_household_id                  ← depends on 120000
20260430130200  add_owner_user_id                 ← depends on auth.users
20260430130300  drop_trading_account_secrets      ← drops secrets; adds household_id to config; RLS
20260430130400  user_to_user_profile              ← ⚠️ DESTRUCTIVE; depends on 120000 (households FK)
20260430130500  relax_delete_policies             ← depends on rls_helpers (is_household_owner)
20260430130600  repoint_user_fks                  ← no-op; audit trail only
20260430140000  create_schemas                    ← depends on 120000 (households)
20260430140100  raw_tables                        ← depends on 140000
20260430140200  compute_tables                    ← depends on 140000
20260430140300  cooked_tables                     ← depends on 140000, 140200 (pnl_runs FK)
```

## ⚠️ Known deviations from task spec

- ~~DELETE policies use `using (false)` (hard-delete blocked)~~ — **Resolved by Decision #1** (2026-04-30). Hard-delete is now allowed for household owners. See `20260430130500_relax_delete_policies.sql`.
- Enum is named `household_role` (runbook) not `household_member_role` (data-architecture doc §06). **Decision #2 confirmed** `household_role` as canonical. `docs/design-hosting/sections/06-data-architecture.md` updated.
- `household_id` and `owner_user_id` columns added as nullable (not `NOT NULL`). Existing rows must be backfilled before the NOT NULL constraint can be enforced. A follow-up migration (TJ-006 or later) will add the constraint post-backfill.
