# Supabase Migration Drift Audit — 2026-05-11
**Issue:** #335 — Audit + reconcile Supabase migration drift
**Author:** Hockney (Backend Dev)
**Branch:** squad/335-migration-drift-audit
**Status:** Audit complete — NO schema changes applied in this dispatch

---

## A. Migration Inventory

### Local repository
- **Total migration files:** 62
- **Location:** `supabase/migrations/`
- **Most recent file:** `20260511052500_backfill_placeholder_account_households.sql`
- **Date range:** 2026-04-30 → 2026-05-11

### Production Supabase (`list_migrations`)
- **Total tracked migrations:** 55
- **Most recent tracked:** `20260510000600_bond_holdings_add_listing_exchange`

---

## B. Drift Diff

### B.1 LOCAL ONLY — 7 files not tracked in prod `schema_migrations`

| # | Version | Name | Schema in prod? | Category |
|---|---------|------|----------------|----------|
| 1 | 20260501120000 | `align_insurance_policies_household_id` | **No** — user_id col still present, household_id still nullable | Forward drift |
| 2 | 20260510000100 | `extend_stock_positions_flex_fields` | **Yes** — all 8 columns + index exist in prod (ad-hoc applied) | Tracking gap |
| 3 | 20260510000200 | `flex_bond_holdings_snapshot` | **Yes** — all 19 columns, index, relaxed constraint exist in prod (ad-hoc applied) | Tracking gap |
| 4 | 20260510000300 | `dividend_payments` | **Yes** — table, all columns, and indexes exist in prod (ad-hoc applied) | Tracking gap |
| 5 | 20260510000400 | `dividend_accruals` | **Yes** — table, all columns, and indexes exist in prod (ad-hoc applied) | Tracking gap |
| 6 | 20260510000500 | `security_reference` | **Yes** — table, all columns, and indexes exist in prod (ad-hoc applied) | Tracking gap |
| 7 | 20260511052500 | `backfill_placeholder_account_households` | **N/A** — data already correct (zero NULL household_id rows) | Tracking gap |

### B.2 PROD ONLY — 0 files
No migrations are applied in prod that are absent from the local repo.

### B.3 Hash mismatch
Not checked (Supabase MCP `list_migrations` does not expose file hashes). Hash verification deferred to Kujan with `supabase migration list --linked`.

---

## C. Schema Drift (Column-level)

### `insurance_policies` — migration 20260501120000 NOT applied
| Column | Expected state | Actual prod state |
|--------|---------------|------------------|
| `user_id` | Dropped | Still present (nullable) |
| `household_id` | NOT NULL | Still nullable |
| wave2 user_id RLS policies | Dropped | Possibly still present (not verified) |

**Impact:** Orphaned rows with user_id but no household_id may be invisible to household-scoped RLS. The `household_id IS NOT NULL` enforcement is missing.

### `bond_holdings.bond_holdings_maturity_after_issue` constraint
Expected (migration 000200): `CHECK (issue_date IS NULL OR maturity_date > issue_date)` (allows NULL)
Actual prod: `CHECK (issue_date IS NULL OR maturity_date > issue_date)` ✅ — already relaxed.

### Migrations 000100–000500 (ad-hoc applied)
All DDL is verified in prod. Every expected column, index, and table matches the local migration files. **The only gap is tracking.**

**Risk of re-run:** Migration 000200 uses `ADD CONSTRAINT bond_holdings_maturity_after_issue` without `IF NOT EXISTS` — this statement would fail if re-applied naively. The other migrations are fully idempotent (`IF NOT EXISTS` used throughout).

---

## D. RLS Policy Inventory — Missing Policies (Silent Deny-All)

The following tables have `rowsecurity = true` **and zero `pg_policies` rows**. Any `authenticated` client reading these tables receives **empty results with no error**:

| Table | Missing policies | Notes |
|-------|----------------|-------|
| `dividend_payments` | SELECT, INSERT, UPDATE, DELETE | No `household_id` column; workaround in place (#367) uses `createAdminClient()` |
| `dividend_accruals` | SELECT, INSERT, UPDATE, DELETE | No `household_id` column; workaround in place (#367) uses `createAdminClient()` |
| `security_reference` | SELECT | No `household_id` column; `con_id` primary key only; service-role writes only by design |

**Note:** `dividend_payments` and `dividend_accruals` were surfaced in #367 hotfix. `security_reference` is a **new finding** from this audit — no code path yet reads it via `authenticated` client, but it will silently fail when the parser wires it up.

All 52 other public tables with RLS enabled have at least one policy. No additional missing-policy tables found.

---

## E. Findings Categorized by Severity

### CRITICAL
| Finding | Table(s) | Detail |
|---------|---------|--------|
| RLS enabled, zero policies — active workaround masks bug | `dividend_payments`, `dividend_accruals` | #367 patched callers to use admin client, but root cause (no policies) remains. Any new caller using `createClient()` silently gets empty data. |
| RLS enabled, zero policies — no workaround | `security_reference` | Parser not yet wired; when connected it will silently return nothing. |

### HIGH
| Finding | Table(s) | Detail |
|---------|---------|--------|
| 5 migrations not tracked → `supabase db push` broken | `stock_positions`, `bond_holdings`, `dividend_payments`, `dividend_accruals`, `security_reference` | A fresh `db push` or local `db reset` will attempt to re-run 000100–000500. Most statements are idempotent but `ADD CONSTRAINT` in 000200 is not. CI/staging deployment is unreliable until tracking is repaired. |

### MEDIUM
| Finding | Table(s) | Detail |
|---------|---------|--------|
| `insurance_policies` wave2 cleanup incomplete | `insurance_policies` | `user_id` column still present; `household_id` nullable. Migration 20260501120000 not applied. Rows with `user_id` but no `household_id` are RLS-invisible. |
| 2 non-DDL migrations not tracked | `trading_account_config` | `20260511052500` (backfill) data is correct but migration untracked. Minor inconsistency, safe to codify. |

### LOW
| Finding | Detail |
|---------|--------|
| `bond_holdings` 000200 non-idempotent constraint | `ADD CONSTRAINT bond_holdings_maturity_after_issue` in local migration file lacks `IF NOT EXISTS`. Safe in prod (constraint already correct) but will fail on re-run until tracked. |

---

## F. Reconciliation Plan

### Step 1 — Register ad-hoc migrations in tracking (HIGH)
**Goal:** Repair `schema_migrations` so the 5 ad-hoc-applied migrations (000100–000500) are tracked.
**Method:** Codify with `supabase migration repair`:
```
supabase migration repair --status applied 20260510000100
supabase migration repair --status applied 20260510000200
supabase migration repair --status applied 20260510000300
supabase migration repair --status applied 20260510000400
supabase migration repair --status applied 20260510000500
```
**Rollback:** `supabase migration repair --status reverted <version>` (no schema change, tracking only)
**Maintenance window:** None — tracking-only, zero downtime
**Effort:** S
**Owner:** Kujan (Supabase CLI workflow)

---

### Step 2 — Register backfill migration as applied (MEDIUM/LOW)
**Goal:** Track `20260511052500_backfill_placeholder_account_households` as applied.
**Method:**
```
supabase migration repair --status applied 20260511052500
```
**Rollback:** `supabase migration repair --status reverted 20260511052500`
**Maintenance window:** None
**Effort:** S
**Owner:** Kujan

---

### Step 3 — Add RLS policies to dividend_payments + dividend_accruals (CRITICAL)
**Goal:** Replace admin-client workaround with proper household-scoped RLS policies.
**Method:** New migration file. These tables lack `household_id`; the correct scoping pattern is to join via `account_id → trading_account_config → household_id`. See the pattern used by `stock_positions`.

**Proposed approach:**
- Add `household_id` column to `dividend_payments` and `dividend_accruals` (nullable, backfill from `trading_account_config` via `account_id`)
- Add household-member SELECT policy; household-writer INSERT/UPDATE/DELETE policy
- Revert `createAdminClient()` calls in `getDividendPositions` and related server actions back to `createClient()`

**Rollback:** Drop added policies; re-enable admin-client workaround (already in place as fallback)
**Maintenance window:** Short write window for backfill (~seconds)
**Effort:** M
**Owner:** Hockney

---

### Step 4 — Add RLS policy to security_reference (CRITICAL)
**Goal:** Allow authenticated users to read `security_reference`.
**Method:** New migration. `security_reference` is a reference table with no household scoping; it should be readable by all authenticated users (no write access).

**Proposed approach:**
```sql
create policy "security_reference_select_authenticated"
  on public.security_reference for select to authenticated using (true);
```
Writes remain service_role-only (enforced by `revoke all ... from authenticated` already in the original migration DDL; grant select only).

**Rollback:** Drop the policy
**Maintenance window:** None
**Effort:** S
**Owner:** Hockney

---

### Step 5 — Apply 20260501120000 (align insurance_policies) (MEDIUM)
**Goal:** Drop `user_id`, make `household_id NOT NULL`, clean wave2 residue.
**Pre-conditions:**
- Verify no application code reads `insurance_policies.user_id` directly
- Verify no rows have `household_id IS NULL` (current prod: unknown — query needed)
- Verify wave2 user_id policies are present/absent before running DROP POLICY

**Method:** Apply migration directly (it has its own safe guards via DO $$ block).
**Rollback:** Re-add `user_id` column (`ALTER TABLE insurance_policies ADD COLUMN user_id uuid`); data is lost (acceptable: user_id was deprecated)
**Maintenance window:** None for column drop; potential brief lock for NOT NULL enforcement
**Effort:** M
**Owner:** Hockney

---

### Execution Order

```
Step 1 (tracking) → Step 2 (tracking) → Step 4 (security_reference RLS, no deps)
                                       → Step 3 (dividend RLS, after Step 1 confirms no re-run conflict)
                                       → Step 5 (insurance cleanup, standalone)
```

Steps 1+2 can run together (tracking only).
Steps 3+4 can run in the same migration PR.
Step 5 can run in a separate PR.

---

## G. RLS Missing-Policy Table List (Complete)

| Table | Action |
|-------|--------|
| `dividend_payments` | Add household-scoped policies (Step 3) |
| `dividend_accruals` | Add household-scoped policies (Step 3) |
| `security_reference` | Add `SELECT TO authenticated USING (true)` (Step 4) |

**Total tables with RLS enabled + zero policies:** 3

---

## References
- #367 (RLS hotfix for dividends — admin-client workaround)
- #354 (household_id backfill for Schwab/IRA accounts)
- `supabase/migrations/` — all 62 local files
- `supabase-list_migrations` MCP output — 55 tracked
- `.squad/decisions.md` — Positions as Source of Truth directive
