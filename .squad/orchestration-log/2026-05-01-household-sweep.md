# Orchestration Log: household_id RLS Injection Sweep

**Date:** 2026-05-01  
**Orchestrator:** Scribe  
**Scope:** Resolve IRA save bug + household_id RLS injection pattern alignment

## Trigger

User report: "Failed to save changes" when adding IRA investment accounts (GitHub issue context: IRA account feature had silent RLS rejections from missing `household_id` injection in API layer).

## Agents Launched

1. **fenster-ira-save-bug** → PR #134 merged
   - Root-cause analysis: `finance_snapshots` RLS + missing `household_id` injection
   - Corrected wave2's user_id pattern to canonical `household_id` + `is_household_member()` RLS
   - Migration: `20260501110927_finance_snapshots_household_pk_fix.sql` (idempotent)

2. **fenster-sweep-1** → PR #135 merged
   - Fixed `insurance.py`, `pension.py`, `plans.py`
   - Closed security gap: `plans.py` had zero household_id scoping
   - Migration: `20260501120000_align_insurance_policies_household_id.sql`

3. **hockney-sweep-2** → PR #136 merged
   - Fixed `dividend_accounts.py`, `trading.py`
   - Updated `trading_service.py` to propagate `household_id` to all sync methods
   - Verified `bonds.py` was no-op (mock data only)

## PRs Merged

| PR | Agent | Target | Status |
|----|-------|--------|--------|
| #134 | Fenster | `finance_snapshots` IRA save bug | ✅ Merged |
| #135 | Fenster | `insurance.py`, `pension.py`, `plans.py` sweep | ✅ Merged |
| #136 | Hockney | `dividend_accounts.py`, `trading.py` sweep | ✅ Merged |

## Outcome

### Code Changes

- **8 endpoints aligned** to canonical `household_id` injection pattern:
  - `insurance.py` (3 endpoints)
  - `pension.py` (2 endpoints)
  - `plans.py` (4 endpoints + 1 security gap closed)
  - `dividend_accounts.py` (3 endpoints)
  - `trading.py` + `trading_service.py`

- **Canonical pattern established:**
  - All endpoints use `get_current_user_id()` → `get_user_household_id()` dependency chain
  - All reads filter by `household_id`
  - All writes set `household_id` on INSERT
  - All mutations verify `household_id` before UPDATE/DELETE

- **Security gap closed:** `plans.py` had zero household_id scoping (users could read/modify other households' plans)

### Migrations

| Migration | Purpose | Status |
|-----------|---------|--------|
| `20260501110927_finance_snapshots_household_pk_fix.sql` | Fix IRA save bug + remove wave2's user_id pattern | ✅ Staged |
| `20260501120000_align_insurance_policies_household_id.sql` | Backfill + enforce household_id on insurance | ✅ Staged |

All migrations are idempotent (IF EXISTS / IF NOT EXISTS). No migrations required for #135 + #136 (columns + RLS already existed).

### Testing

- ✅ CI passing on all 3 PRs (lint, migrations dry-run, RLS policy tests)
- ⚠️ E2E multi-household isolation tests added to hockney-sweep-2 but not yet run against dev/prod
- ⚠️ Manual verification pending: IRA save/load with new household_id scoping in staging

## User Action Pending

✋ **Migrations must be applied by user.** Code is merged; migrations are staged.

```bash
cd apps/backend
supabase db push --linked  # Apply to dev; verify logs; then prod
```

**Why:** Migrations contain schema changes (composite PK updates, policy replacements). These don't auto-deploy and must be explicitly pushed to live environment.

**Verification:** After apply, test IRA account save in dev environment; confirm no silent rejections.

## Decision Consolidated

All three inbox files merged into `.squad/decisions.md` section:
> ## 2026-05-01 — household_id RLS injection sweep (#134, #135, #136)

Inbox files deleted:
- `.squad/decisions/inbox/fenster-ira-save-fix.md` ✅ Deleted
- `.squad/decisions/inbox/fenster-sweep-1.md` ✅ Deleted
- `.squad/decisions/inbox/hockney-sweep-2.md` ✅ Deleted

## Follow-Up

1. **User applies migrations** via `supabase db push --linked`
2. **User verifies IRA save** works end-to-end in staging
3. **Audit other endpoints** for similar RLS injection bugs (e.g., any endpoint writing to household-scoped tables)
4. **Reference pattern** in `.squad/decisions.md` for all future household-scoped endpoint implementations

## Related

- **Decision:** `.squad/decisions.md` → 2026-05-01 section
- **Pattern reference:** `dividends.py`, `holdings.py`, `finances.py` (#129 + #134)
- **RLS policy framework:** Migration 20260430160200 (is_household_member, is_household_writer helpers)

---

**Status:** 🎬 **Ready for deployment** — all agents complete, all PRs merged, migrations staged, awaiting user apply.
