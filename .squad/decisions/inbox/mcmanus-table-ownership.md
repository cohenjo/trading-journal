# Decision: Table Ownership Classification for Supabase RLS

**Author:** McManus (Data/Finance Dev)  
**Date:** 2026-04-30  
**Status:** Draft — pending Jony answers on 3 open questions  
**Issue:** TJ-003 / GH #56  
**Related doc:** `docs/design-hosting/data/table-ownership.md`

## Context

Issue TJ-003 asked McManus to walk every existing database table and classify it as
household, owner-private, global-reference, or system/infra ahead of the TJ-005 (#58)
migration that will add `household_id` / `owner_user_id` FKs and apply RLS policies.

## Decision

24 existing tables were surveyed and classified:

| Bucket | Count |
|--------|-------|
| household | 13 |
| owner-private (direct) | 2 (`note`, `backtestrun`) |
| owner-private (inherited) | 1 (`backtesttrade` via JOIN) |
| global-reference | 5 |
| system/infra | 3 |
| NEEDS REVIEW | 1 (`trading_account_config`) |

## Key Choices

1. **`trading_account_config` must be split.** It mixes household-visible metadata
   (account name, type, balance link) with owner-private broker secrets
   (`app_secret`, `account_hash`, `tokens_path`). Two RLS policies on one table
   is fragile; recommend either table split or Supabase Vault for credentials.

2. **`owner` strings are NOT auth boundaries.** The `owner: str` fields in
   `FinanceItem`, `PlanItem`, `InsurancePolicy`, and `DividendPosition` are
   display/attribution fields ("You", "Partner"). RLS must NOT be built on them.

3. **`backtesttrade` inherits via JOIN**, not a direct FK. No additional column needed.

4. **`matchedtrade` and `dailysummary`** need interim `household_id` columns but are
   candidates for replacement by the planned `cooked.*` tables in TJ-004.

5. **`user` table (local password auth)** is marked for formal retirement during the
   Supabase migration. It will conflict with `auth.users` if left.

## Open Questions Blocking TJ-005

- Q1: Should `note` support optional household sharing (shared flag) or stay strictly private?
- Q2: How should `trading_account_config` credentials be stored — table split, column split, or Vault?
- Q3: Should `backtestrun` be promotable to household visibility (shared flag)?

**Jony must answer these before TJ-005 migration SQL is drafted.**
