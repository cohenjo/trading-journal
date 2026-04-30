# Hockney — Prod RLS Migration Applied

## Decision

Successfully applied all 18 Supabase migrations to prod project (`jaesiklybkbmzpgipvea`), completing the RLS rollout from PR #98. Issue #97 resolved.

## Execution Summary

**Start:** 2026-05-01 01:10 UTC  
**Duration:** ~15 minutes (including idempotency fixes)  
**Method:** Supabase CLI `db push --linked`

**Migrations applied:** All 18 (baseline through 160200)  
**Key migrations from PR #98:**
- `120100_rls_helpers.sql` (MODIFIED): parameter rename `hid` → `p_household_id`
- `160100_drop_account_secrets_table.sql` (NEW): DROP TABLE IF EXISTS trading_account_secrets
- `160200_enable_rls_on_public_tables.sql` (NEW): RLS on 21 tables

## Idempotency Fixes Required

Prod had partial schema (tables existed but no RLS). Three migrations lacked `DROP POLICY IF EXISTS`:
1. `120200_rls_policies_households.sql` — added DROP POLICY for 8 policies
2. `130300_drop_trading_account_secrets.sql` — added DROP POLICY for 4 policies
3. `130400_user_to_user_profile.sql` — added DROP POLICY for 4 policies

**Root cause:** Migrations were written assuming blank database. Prod had legacy schema from earlier manual testing.

**Fix applied:** Added `DROP POLICY IF EXISTS <policy_name> ON <table>` before each `CREATE POLICY` statement in affected migrations.

## Verification Results

✅ **Migration list:** All 18 show Remote timestamp  
✅ **Advisor check:** 0 `rls_disabled_in_public` errors (grep confirmed)  
✅ **Spot-check:** 5 tables (trade, execution, plans, manualtrade, dailysummary) all have `relrowsecurity=true`  
✅ **Issue #97:** Commented and verified closed

## Lessons Learned

1. **Assume prod has partial schema:** Always use `IF [NOT] EXISTS` clauses for idempotency, even for "CREATE POLICY".
2. **Supabase CLI workflow:** `supabase link --project-ref` + `supabase migration list --linked` + `supabase db push --linked` is clean and idempotent when migrations are properly written.
3. **Prod verification before push:** Could have caught policy conflict by running `supabase migration list --linked` first to see partial apply state.
4. **SUPABASE_ACCESS_TOKEN:** Must be exported to env for CLI commands to work (source .env + export).

## Follow-up

- [x] Close #97 (already closed)
- [ ] Consider writing a pre-flight check script that validates migration idempotency before prod apply
- [ ] Document dual-project migration pattern in `.squad/skills/` (optional)

---

**Agent:** Hockney (Backend Dev)  
**Coordinator approval:** Jony (autopilot delegation)
