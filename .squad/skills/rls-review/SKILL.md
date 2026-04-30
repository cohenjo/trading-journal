---
skill: rls-review
description: Row Level Security (RLS) migration review checklist for PostgreSQL/Supabase
category: security
applies-to: database migrations, RLS policies, Supabase advisor findings
created: 2026-04-30
author: Keaton (Lead)
---

# RLS Review Skill

## Purpose

Comprehensive checklist for reviewing Row Level Security (RLS) policy migrations in PostgreSQL/Supabase environments. Extracted from PR #98 review patterns.

## When to Use

- Reviewing PRs that add/modify RLS policies
- Closing Supabase advisor `rls_disabled_in_public` findings
- Validating household/tenant isolation migrations
- Security audits of public table access control

## Review Dimensions

### 1. Policy Logic Correctness

**Policy Design Patterns:**
- **Household-scoped**: SELECT via `is_household_member(household_id)`, mutations via `is_household_writer(household_id)`
- **Owner-private**: Direct `owner_user_id = auth.uid()` check
- **Inherited-owner**: Access through parent table join (e.g., `backtesttrade` via `backtestrun.run_id`)
- **Reference/Market Data**: `SELECT TO authenticated USING (true)` only, no write policies

**Check:**
- [ ] All policies use SECURITY DEFINER helper functions (prevents auth bypass)
- [ ] Policy predicates match the ownership pattern (household vs owner vs inherited)
- [ ] SELECT/INSERT/UPDATE/DELETE policies are all present where needed
- [ ] WITH CHECK clauses mirror USING clauses for UPDATE policies
- [ ] No policies expose data across tenant boundaries

### 2. NULL-Safety for Legacy Data

**Critical Pattern:** Legacy rows with NULL ownership columns should be intentionally hidden, not guessed.

**Check:**
- [ ] All household policies require `household_id IS NOT NULL`
- [ ] All owner-private policies require `owner_user_id IS NOT NULL` (or columns are NOT NULL)
- [ ] Migration comments document that NULL rows are hidden until backfill
- [ ] No "default household" or "default owner" guessing in policies
- [ ] Backfill plan exists (separate migration or issue) for NULL rows

**Why:** Safer to hide data than assign wrong ownership in security migration.

### 3. Performance Impact

**Check:**
- [ ] Policy predicates use indexed columns (household_id, owner_user_id)
- [ ] No table scans in policy subqueries
- [ ] Inherited-owner joins use foreign key indexed columns
- [ ] Helper functions are STABLE (not VOLATILE) for optimization
- [ ] Complex policies document expected query plan impact

### 4. Backwards Compatibility

**Check:**
- [ ] Service role operations still work (service_role bypasses RLS unless FORCE RLS)
- [ ] Existing API routes using anon/authenticated keys are tested
- [ ] No breaking changes to PostgREST endpoints
- [ ] Background jobs using service role key are unaffected
- [ ] Migration is idempotent (DROP IF EXISTS before CREATE)

### 5. App Code Coupling

**Check:**
- [ ] Search codebase for references to dropped/renamed tables
- [ ] Verify no app code reads from tables being secured
- [ ] Check API routes, background jobs, test fixtures
- [ ] Validate no hardcoded service role queries that bypass RLS
- [ ] Search for SQL string literals containing table names

**Command:**
```bash
grep -r "table_name" --include="*.py" --include="*.ts" --include="*.tsx" .
git log --all --oneline -- "*table_name*"
```

### 6. Test Coverage

**Check:**
- [ ] pgTAP isolation tests exist (user A vs user B)
- [ ] Tests verify policy denies cross-household access
- [ ] Tests verify policy allows same-household access
- [ ] Tests check NULL ownership rows are hidden
- [ ] Tests cover all CRUD operations (SELECT/INSERT/UPDATE/DELETE)
- [ ] CI runs tests on shadow database or local Supabase

### 7. Migration Quality

**Check:**
- [ ] Idempotent operations (IF EXISTS, IF NOT EXISTS)
- [ ] Migration comments explain policy design and threat model
- [ ] Parameter names consistent with existing helpers (e.g., p_household_id)
- [ ] No DDL/DML mixing (keep data changes separate)
- [ ] Migration dependencies documented (which migrations must run first)

### 8. Documentation

**Check:**
- [ ] PR body explains policy tiers (household/owner/inherited/reference)
- [ ] Migration README updated with new migration numbers
- [ ] Decision file documents NULL-safety choice
- [ ] Issue comments explain dev vs prod rollout plan
- [ ] Known deviations from spec are documented

## Common Anti-Patterns to Flag

❌ **Guessing tenancy**: `COALESCE(household_id, 'default-household-uuid')`  
✅ **Correct**: `household_id IS NOT NULL AND is_household_member(household_id)`

❌ **Volatile helper functions**: `CREATE FUNCTION ... LANGUAGE sql VOLATILE`  
✅ **Correct**: `CREATE FUNCTION ... LANGUAGE sql STABLE SECURITY DEFINER`

❌ **Missing WITH CHECK on UPDATE**: Only USING clause provided  
✅ **Correct**: Both USING and WITH CHECK clauses present

❌ **Exposing reference data to anon**: `CREATE POLICY ... TO PUBLIC`  
✅ **Correct**: `CREATE POLICY ... TO authenticated USING (true)`

❌ **Non-idempotent drops**: `DROP POLICY policy_name`  
✅ **Correct**: `DROP POLICY IF EXISTS policy_name`

## Success Criteria

Approve when:
- All 8 dimensions above are ✅
- CI checks pass (pgTAP, schema lint, dry-run migrations)
- Supabase advisor reports 0 RLS errors post-migration
- No app code coupling identified
- Prod rollout plan documented

Request changes when:
- NULL-safety missing (tenancy guessing present)
- Performance red flags (table scans, missing indexes)
- Test coverage gaps (no isolation tests)
- App code still references dropped/secured tables

## References

- PR #98: First application of this checklist
- Supabase RLS docs: https://supabase.com/docs/guides/auth/row-level-security
- PostgreSQL RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html

## Changelog

- 2026-04-30: Initial skill created from PR #98 review patterns (Keaton)
