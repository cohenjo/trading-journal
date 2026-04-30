# RLS Reconciliation Tests

**Issue:** TJ-013 / GH #66  
**Author:** Redfoot (Tester)  
**Depends on:** PR #85 (`squad/61-ci-cd-scaffolding`) — migrations must be applied before these tests can run.

---

## Overview

This directory contains [pgTAP](https://pgtap.org) SQL tests that prove Row-Level Security (RLS) isolation is working correctly for the `households` / `household_members` infrastructure and the associated data tables introduced in PR #85.

---

## Running Tests Locally

### Prerequisites

```bash
# 1. Install Supabase CLI (if not already)
brew install supabase/tap/supabase

# 2. Start the local Supabase stack (Postgres + Auth + Studio)
supabase start

# 3. Apply all migrations (includes PR #85 migrations)
supabase db reset
```

### Run with `supabase test db` (recommended)

```bash
supabase test db
```

Supabase CLI automatically discovers and runs all `*.sql` files in `supabase/tests/` using pgTAP.

### Run with `psql` directly

```bash
# Set connection string for local Supabase Postgres
export PGURL="postgresql://postgres:postgres@localhost:54322/postgres"

# Load helpers first, then each test file
psql "$PGURL" -f supabase/tests/00_setup.sql
psql "$PGURL" -f supabase/tests/10_household_membership.sql
psql "$PGURL" -f supabase/tests/20_household_data_isolation.sql
psql "$PGURL" -f supabase/tests/30_owner_private_isolation.sql
psql "$PGURL" -f supabase/tests/40_audit_columns.sql
```

### Run with `pg_prove` (TAP output + exit code)

```bash
pg_prove --username postgres --port 54322 --dbname postgres \
  supabase/tests/10_household_membership.sql \
  supabase/tests/20_household_data_isolation.sql \
  supabase/tests/30_owner_private_isolation.sql \
  supabase/tests/40_audit_columns.sql
```

`pg_prove` exits non-zero if any test fails, making it suitable for CI gates.

---

## Test Files

| File | Status | Tests | What it covers |
|------|--------|-------|----------------|
| `00_setup.sql` | N/A — helpers only | 0 | `tests.create_test_user()`, `create_test_household()`, `add_household_member()`, `set_session_user()` |
| `10_household_membership.sql` | **CONCRETE** ✅ | 17 | households + household_members RLS; owner/member/viewer/outsider SELECT; UPDATE owner-only; hard-delete blocked; auto-owner trigger; soft-remove via left_at |
| `20_household_data_isolation.sql` | Mixed | 10 | Tier A (concrete): `cooked.dashboard_summary` RLS isolation. Tier B (aspirational): `trade`, `trading_positions` — columns exist, RLS not yet enabled |
| `30_owner_private_isolation.sql` | **ASPIRATIONAL** ⚠️ | 8 | `note`, `backtestrun` owner-private isolation; `backtesttrade` inherited visibility; policy expression contract |
| `40_audit_columns.sql` | **CONCRETE** ✅ | 12 | `tg_update_timestamp()` trigger; `created_at`/`updated_at`/`deleted_at` on all 14 tables; schema structural checks |

**Total test assertions: ~47**

---

## Test Status by Migration Dependency

### PASSES with PR #85 (concrete)

- All `10_household_membership.sql` tests
- `cooked.dashboard_summary` isolation tests in `20_household_data_isolation.sql`
- All `40_audit_columns.sql` structural checks

### REQUIRES follow-up migration (aspirational)

Tests marked `@aspirational` in `20_household_data_isolation.sql` and `30_owner_private_isolation.sql` will PASS once a follow-up migration adds `ENABLE ROW LEVEL SECURITY` + policies to the public household and owner-private tables. The required SQL is documented inside each test file.

Tables needing follow-up RLS migrations:
- `public.trade`
- `public.manualtrade`
- `public.execution`, `public.matchedtrade`, `public.dailysummary`
- `public.trading_account_summary`, `public.trading_positions`
- `public.finance_snapshots`, `public.plans`
- `public.dividend_positions`, `public.dividend_accounts`
- `public.insurance_policies`
- `public.note` (owner-private)
- `public.backtestrun` (owner-private)

---

## CI Workflow

See `.github/workflows/test-rls.yml`.

CI is configured to run on `squad/**` branch pushes and PRs to main. It spins up a `supabase/postgres:15` container, applies all migrations from `supabase/migrations/`, loads the test helpers, and runs each test file via `psql`. The workflow will fail until PR #85 is merged into main (migrations must exist on the target branch).

---

## Known Gaps and Skipped Areas

### 1. `household_invitations` table — SKIPPED

The `household_invitations` table described in GH #58 does **not exist** in the PR #85 migrations. Tests for invitation flows are intentionally absent. Once a migration creates this table, tests should be added to cover:
- Owner can create invitation
- Invited email can accept invitation
- Non-invited cannot accept

### 2. `trading_account_config` split — SKIPPED

Migration `20260430130300` is a SKETCH only (awaiting user decision on Option A/B/C for secrets handling). No tests written against this table.

### 3. `retire_local_user_table` — SKIPPED

Migration `20260430130400` is marked DESTRUCTIVE and conditional. No tests for `public.user_legacy`.

### 4. Hard-delete is BLOCKED — Rabin deviation #1

All `DELETE` policies on `households` and `household_members` use `USING (false)`. This is intentional (enforces soft-delete discipline via `deleted_at` / `left_at`). Tests verify that hard-delete attempts are silently rejected (0 rows deleted, row still exists). The same pattern should be applied to all future household-scoped tables.

### 5. No `created_by` / `updated_by` columns

The `tg_update_timestamp()` trigger function (migration 20260430130000) only sets `updated_at`. There are no `created_by` or `updated_by` identity columns in these migrations. If user-identity audit tracking is added later, tests should be added to `40_audit_columns.sql`.

### 6. No automatic `deleted_at` RLS filter

No SELECT policy filters `deleted_at IS NULL` automatically. Application code must include `WHERE deleted_at IS NULL` in queries to exclude soft-deleted rows. This is documented as a known gap; if an automatic exclusion policy is added, a test should verify it.

### 7. `raw` and `compute` schemas — not tested

`raw.*` and `compute.*` tables have no RLS (service_role only, schema-level REVOKE). Tests for those schemas would verify the schema-level access controls but are out of scope for TJ-013. Consider adding to a future `50_service_role_isolation.sql`.

---

## Architecture Reference

- Table ownership classification: `docs/design-hosting/data/table-ownership.md`
- Household RLS helpers: `supabase/migrations/20260430120100_rls_helpers.sql`
- RLS policies (households): `supabase/migrations/20260430120200_rls_policies_households.sql`
- Audit columns: `supabase/migrations/20260430130000_add_audit_columns.sql`
- pgTAP docs: https://pgtap.org/documentation.html
