# Security Review: RLS on Reference Tables

**Date:** 2026-05-13T18:34:00+03:00
**Reviewer:** Rabin (Security Engineer)
**Migration:** `supabase/migrations/20260513153400_enable_rls_on_reference_tables.sql`
**Author:** Hockney (Backend Dev)
**Context:** Response to Supabase advisor ERROR-level findings on `security_reference` and `tase_yahoo_map`

---

```
═══════════════════════════════════════
🔒 SECURITY REVIEW VERDICT: APPROVED
Reviewer: Rabin
Migration: 20260513153400_enable_rls_on_reference_tables.sql
═══════════════════════════════════════
```

## Summary

Migration is **safe to apply**. Hockney correctly reverses his prior decision to DISABLE RLS on `security_reference` and enables RLS on `tase_yahoo_map` (created via Alembic without RLS). Both implementations follow the canonical Supabase pattern for reference data: RLS enabled + permissive SELECT policy for authenticated users.

## Review Findings (8-Dimension Analysis)

### ✅ 1. RLS Coverage
- **security_reference:** Line 44 — `ENABLE ROW LEVEL SECURITY`
- **tase_yahoo_map:** Line 66 — `ENABLE ROW LEVEL SECURITY`
- Both tables addressed per Supabase advisor findings

### ✅ 2. Policy Correctness
- Both policies use `USING (true)` for authenticated SELECT (lines 53-58, 74-79)
- Schema verification confirms no household_id, owner_user_id, or PII columns
- Tables are pure reference data (ticker → metadata mappings):
  - `security_reference`: con_id, symbol, description, asset_category, currency, etc.
  - `tase_yahoo_map`: tase_paper, yahoo_ticker, notes
- Permissive `USING (true)` is appropriate for global reference data

### ✅ 3. Write Path Safety
- Backend writes via `direct_engine` (service_role/postgres role) — verified in `yahoo_refresh.py` lines 349, 358
- Service role bypasses RLS automatically — no INSERT/UPDATE/DELETE policies needed
- Migration correctly omits write policies
- IBKR Flex pipeline and yahoo_refresh worker continue to work unchanged

### ✅ 4. Anon Role Security
- Explicit `REVOKE ALL ... FROM anon` on both tables (lines 47, 69)
- Explicit `GRANT SELECT ... TO authenticated` (lines 48, 70)
- Explicit `GRANT ALL ... TO service_role` (lines 49, 71)
- Pattern prevents anonymous PostgREST access while allowing authenticated reads

### ✅ 5. Idempotency
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is idempotent (no-ops if already enabled)
- `DROP POLICY IF EXISTS` before CREATE (lines 53, 74)
- REVOKE/GRANT operations are idempotent
- Safe to apply multiple times without side effects

### ✅ 6. Naming Conventions
- Policy names follow repo standard: `{table_name}_select`
- Matches existing pattern in migration `20260511102251`: `dividend_payments_select`, `dividend_accruals_select`
- Consistent with 21-table RLS coverage from PR #98

### ✅ 7. Advisor Compliance
- Migration header (lines 5-6) references specific findings:
  - `rls_disabled_in_public_public_security_reference`
  - `rls_disabled_in_public_public_tase_yahoo_map`
- After apply, both tables will have RLS enabled + policies → clears both ERROR-level findings
- Verification queries provided in migration (lines 84-100)

### ✅ 8. Reversal Rationale
- Decision file `.squad/decisions/inbox/hockney-rls-on-reference-tables.md` documents sound reasoning
- Previous DISABLE RLS approach violated Supabase advisor best practice
- Correct pattern: "RLS enabled + permissive policy" NOT "RLS disabled"
- References official Supabase docs: https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
- Reversal is justified and well-documented

## Security Pattern Validation

**Canonical Reference Data Pattern (Confirmed):**
```sql
-- ✅ CORRECT
ALTER TABLE public.reference_table ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reference_table FROM anon;
GRANT SELECT ON public.reference_table TO authenticated;
GRANT ALL ON public.reference_table TO service_role;
CREATE POLICY "reference_table_select" ON public.reference_table
  FOR SELECT TO authenticated USING (true);
```

**Anti-pattern (Avoided):**
```sql
-- ❌ WRONG — Supabase advisor ERROR
ALTER TABLE public.reference_table DISABLE ROW LEVEL SECURITY;
```

## No Security Concerns Identified

- ✅ No data leakage risk (no tenant-scoped data, no PII)
- ✅ No privilege escalation paths (authenticated users read-only, service role writes)
- ✅ No anonymous access (explicit REVOKE from anon)
- ✅ No breaking changes to backend write paths (service_role bypass unchanged)
- ✅ No breaking changes to frontend read paths (authenticated SELECT continues)

## Recommendation

**APPROVE** — Migration is secure, idempotent, and follows Supabase advisor best practices. Ready for production apply.

## Next Steps

1. Apply migration to dev environment
2. Run Supabase advisor to verify both ERROR findings cleared
3. Test backend worker writes (yahoo_refresh, Flex sync) continue to function
4. Test frontend reads (ticker autocomplete, dividend lookup) continue to function
5. Apply to production
6. Close advisor findings

---

**Reviewed:** 2026-05-13T18:34:00+03:00
**Reviewer:** Rabin (Security Engineer)
**Status:** ✅ APPROVED
