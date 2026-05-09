# Migration Drift Resolution — Issue #335 Results

**Author:** Hockney (Backend Dev)
**Date:** 2026-05-09T22:56:49+03:00
**Decision:** Option B — Pragmatic Prune (Jony)
**Supersedes:** `hockney-migration-reconcile-plan.md`

---

## Summary

Resolved migration drift between 47 local files and 42 remote-applied migrations. The
remote had grown to **46 applied** by the time this work executed (4 new ones applied
since the reconcile audit). After this work: **54 remote-applied**, **55 local files**,
**1 deferred** pending Jony go/no-go.

---

## 1. Phase 1 — Files Pulled In (Commit `85eebb3`)

### Timestamp renames (14 files — local had wrong timestamps, remote is canonical)

| Old Local Timestamp | Remote Timestamp | Migration Name |
|---------------------|-----------------|----------------|
| 20260502120000 | 20260502092239 | auto_provision_household_on_signup |
| 20260502140000 | 20260502094040 | e2e_reset_test_user |
| 20260503090000 | 20260503064728 | household_bootstrap_rpc |
| 20260503163659 | 20260503162925 | add_pension_upload_bucket |
| 20260503170000 | 20260503163042 | add_price_cache |
| 20260504134437 | 20260504134614 | add_trading_account_options_toggle |
| 20260504134438 | 20260504134620 | add_options_income_phase1_schema |
| 20260504141814 | 20260504141825 | add_options_phase2_roll_metrics |
| 20260504150112 | 20260504150611 | options_phase4_capital_margin |
| 20260504170000 | 20260504194902 | add_assignment_synthetic_cash_event_category |
| 20260506000001 | 20260506204812 | compute_jobs_backoff |
| 20260509151900 | 20260509152454 | dividend_estimations_table (#339) |
| 20260510000001 | 20260509180919 | add_stock_positions (#340) |
| 20260510000002 | 20260509183142 | seed_canonical_accounts (#340) |

> Note: The last 3 were from #340 work (Hockney). They were applied to prod with auto-
> generated timestamps (05-09) but local files used manually-set timestamps (05-10).

### Remote-only commit-backs (5 files — applied in prod, missing locally)

| Timestamp | Migration Name | Method |
|-----------|---------------|--------|
| 20260502094810 | e2e_reset_test_user_v2 | Pulled SQL from `supabase_migrations.schema_migrations.statements` |
| 20260504134746 | add_options_income_phase1_tables | Same |
| 20260504134817 | add_options_income_phase1_policies | Same |
| 20260504134951 | fix_options_legs_null_conid_key | Same |
| 20260504140054 | add_options_income_fk_indexes | Same |

---

## 2. Phase 2 — Files Deleted

**None.** All 9 local-only migrations had either active open issues or confirmed code
references in `apps/backend` or `apps/frontend`. No abandoned features found.

| Migration | Issue State | Code Refs | Decision |
|-----------|-------------|-----------|----------|
| 20260501040000 wave2b_holdings_dividends_db | #119/#120 CLOSED | bond_models.py, dividend_models.py, holdings/actions.ts, dividends/actions.ts | KEEP — feature shipped, tables needed |
| 20260501120000 align_insurance_policies_household_id | — | insurance_models.py, insurance/actions.ts | DEFERRED (destructive) |
| 20260502130000 revoke_handle_new_user_household_exec | — | N/A (security hardening) | KEEP |
| 20260503162944 analyze_batch_results | TJ-020 (active) | analyze_batch.py, analyze_schedules.py | KEEP |
| 20260503163035 add_trading_last_synced_at | — | trading_models.py, trading_service.py, options/*.py | KEEP |
| 20260505120000 options_ladder_schema_close | — | options_margin_sync.py, options_metrics.py | KEEP |
| 20260505140000 household_audit_trail | #77 CLOSED | household/audit.ts | KEEP |
| 20260506001200 household_refresh_state | TJ-011 (active) | pnl_daily.py, dashboard/actions.ts | KEEP |
| 20260506200000 household_invites_schema | #74 OPEN | — (no code yet, issue open) | KEEP |

---

## 3. Phase 3 — Files Kept and Applied

Applied via `supabase db push --db-url $SUPABASE_DIRECT_SESSION_URL --include-all`:

| Timestamp | Migration Name | Result |
|-----------|---------------|--------|
| 20260501040000 | wave2b_holdings_dividends_db | ✅ Applied (bond_holdings, dividend_accounts tables created) |
| 20260502130000 | revoke_handle_new_user_household_exec | ✅ Applied |
| 20260503162944 | analyze_batch_results | ✅ Applied (analysis_tickers, analysis_growth_stories tables) |
| 20260503163035 | add_trading_last_synced_at | ✅ Applied (last_synced_at column on trading_account_config) |
| 20260505120000 | options_ladder_schema_close | ✅ Applied (index on options_margin_snapshots) |
| 20260505140000 | household_audit_trail | ✅ Applied (household_audit_log table + RLS) |
| 20260506001200 | household_refresh_state | ✅ Applied (household_refresh_state table) |
| 20260506200000 | household_invites_schema | ✅ Applied (household_invites table + RLS, FK to household_audit_log) |

Remote migration count: 46 → **54** after Phase 3.

---

## 4. Deferred — Needs Jony Decision

### `20260501120000_align_insurance_policies_household_id.sql`

**Why deferred:** Contains destructive operations:
1. `DELETE FROM public.insurance_policies WHERE household_id IS NULL` — permanently removes rows that can't be backfilled
2. `ALTER TABLE public.insurance_policies DROP COLUMN IF EXISTS user_id` — removes column
3. `ALTER TABLE public.insurance_policies ALTER COLUMN household_id SET NOT NULL` — sets NOT NULL (may fail if any rows are NULL post-backfill)

**Current prod state:** `insurance_policies` still has `user_id` column (confirmed via prod query).

**What it does:** Aligns `insurance_policies` with the household_id canonical pattern used
by all other tables. Drops the old user_id-based wave2 RLS policies (since household-based
RLS from `20260430160200` is already the authoritative one). Backfills household_id from
user_profile where possible.

**Risk:** Any insurance_policies rows where user_id cannot be mapped to a household will
be permanently deleted. In prod this may or may not affect real data.

**Jony decision needed:**
- [ ] Is it safe to delete orphaned insurance_policies rows in prod?
- [ ] Should we inspect how many rows have `household_id IS NULL` before applying?
- [ ] Run: `SELECT COUNT(*) FROM public.insurance_policies WHERE household_id IS NULL;` to assess impact

---

## 5. Final Verification

### `supabase migration list` state

- **54** local/remote matched migrations ✅
- **1** local-only (deferred): `20260501120000_align_insurance_policies_household_id`
- **0** remote-only ✅

### Tables confirmed created in prod
- `bond_holdings` ✅
- `dividend_accounts` ✅
- `analysis_tickers` ✅
- `analysis_growth_stories` ✅
- `household_audit_log` ✅
- `household_refresh_state` ✅
- `household_invites` ✅
- `trading_account_config.last_synced_at` column ✅

### Schema diff
`supabase migration list` shows only `20260501120000` unapplied — all other local files
match remote. The outstanding schema delta is exactly the deferred migration's DDL
(user_id drop on insurance_policies).

---

## 6. Commit SHAs

| Phase | SHA | Description |
|-------|-----|-------------|
| Phase 1 | `85eebb3` | Renames + remote-only commit-backs |
| Phase 3 | Remote DB only | `supabase db push` applied 8 migrations to prod (no new local file changes) |

---

## Open Questions for Jony

1. **Deferred migration** (`20260501120000`): Approve or drop it?
   - Recommend: Run `SELECT COUNT(*) FROM insurance_policies WHERE household_id IS NULL;`
     in prod first, then approve if count is 0 or acceptable.
2. **Issue closure**: Should #335 be closed now, or kept open tracking the deferred item?

---

## Learnings from this work

- `supabase_migrations.schema_migrations.statements` (text[]) is the authoritative source
  for remote-only migration SQL. Use `array_to_string(statements, E';\n')` to extract.
- `SUPABASE_DIRECT_SESSION_URL` is required for `supabase migration list --db-url` and
  `supabase db push --db-url` — the transaction-mode pooler rejects prepared statements
  that the Supabase CLI uses.
- `supabase db push` (without `--include-all`) rejects out-of-order migrations. Always
  use `--include-all` when local pending migrations have timestamps earlier than the last
  remote migration.
- Temporary file rename trick (`.sql` → `.sql.deferred`) lets you skip one migration
  in a `db push` run without deleting it.
