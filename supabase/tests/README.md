# RLS Reconciliation Tests

**Issue:** TJ-013 / GH #66  
**Author:** Redfoot (Tester)  
**Depends on:** PR #85 (`squad/61-ci-cd-scaffolding`) — migrations must be applied before these tests can run.  
**Extended by:** PR #88 (`squad/66-rls-reconciliation-tests`) — adds concrete tests for McManus's new policies (migrations 20260430130300–130500).

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
psql "$PGURL" -f supabase/tests/50_user_profile.sql
psql "$PGURL" -f supabase/tests/60_hard_delete_policies.sql
psql "$PGURL" -f supabase/tests/70_trading_account_config.sql
```

### Run with `pg_prove` (TAP output + exit code)

```bash
pg_prove --username postgres --port 54322 --dbname postgres \
  supabase/tests/10_household_membership.sql \
  supabase/tests/20_household_data_isolation.sql \
  supabase/tests/30_owner_private_isolation.sql \
  supabase/tests/40_audit_columns.sql \
  supabase/tests/50_user_profile.sql \
  supabase/tests/60_hard_delete_policies.sql \
  supabase/tests/70_trading_account_config.sql
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
| `50_user_profile.sql` | **CONCRETE** ✅ | 10 | `user_profile` RLS (owner-only SELECT/UPDATE/DELETE); `handle_new_auth_user()` trigger fires on auth.users INSERT; idempotency via ON CONFLICT; SECURITY DEFINER + search_path annotation |
| `60_hard_delete_policies.sql` | **CONCRETE** ✅ | 8 | `households_owner_delete` + `household_members_owner_delete` policies; owner CAN delete; member/outsider CANNOT; CASCADE on household delete removes member rows |
| `70_trading_account_config.sql` | **CONCRETE** ✅ | 6 | `trading_account_config` household-scoped RLS (member read/update, owner delete); cross-household isolation; `trading_account_secrets` confirmed absent |

**Total test assertions: ~71** (+28 concrete from PR #88, covering all PR #85 policy gaps)

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

### 2. `trading_account_config` — ✅ COVERED by PR #88

~~Migration `20260430130300` is a SKETCH only~~ — Decision #3 was made: `trading_account_secrets` is dropped and `trading_account_config` is now purely household-scoped. Tests in `70_trading_account_config.sql` cover all four RLS policies and confirm `trading_account_secrets` is absent.

### 3. `user_profile` + auth trigger — ✅ COVERED by PR #88

~~Migration `20260430130400` is marked DESTRUCTIVE and conditional~~ — Decision #4 was made: `public.user` is replaced by `public.user_profile`. Tests in `50_user_profile.sql` cover all owner-only RLS policies and the `handle_new_auth_user()` trigger.

### 4. Hard-delete policy relaxed — ✅ COVERED by PR #88

~~All `DELETE` policies on `households` and `household_members` use `USING (false)`~~ — Migration `20260430130500` replaced these with owner-only `households_owner_delete` / `household_members_owner_delete`. Tests in `60_hard_delete_policies.sql` verify the new behavior. Note: `household_role` enum is `('owner','member','viewer')` — there is no `'admin'` role value; `is_household_owner()` checks `role='owner'` only.

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
