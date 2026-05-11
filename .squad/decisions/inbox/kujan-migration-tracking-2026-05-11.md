# Decision: Migration Tracking Repair (Steps 1–2)
**Author:** Kujan (DevOps/Platform)
**Date:** 2026-05-11
**Issue:** #335 — Audit + reconcile Supabase migration drift
**Ref:** Hockney's audit `.squad/decisions/hockney-migration-drift-audit-2026-05-11.md`

## Decision

Executed Steps 1 and 2 of Hockney's reconciliation plan: inserted 6 tracking rows into
`supabase_migrations.schema_migrations` for migrations that were applied ad-hoc to prod
on 2026-05-10/11 but were missing from the tracking table.

**Versions tracked (no DDL re-run):**
| Version | Name |
|---------|------|
| 20260510000100 | extend_stock_positions_flex_fields |
| 20260510000200 | flex_bond_holdings_snapshot |
| 20260510000300 | dividend_payments |
| 20260510000400 | dividend_accruals |
| 20260510000500 | security_reference |
| 20260511052500 | backfill_placeholder_account_households |

## Rationale

- All 5 DDL migrations were verified present in prod before inserting tracking rows
- `ON CONFLICT (version) DO NOTHING` makes the script idempotent
- Runbook saved to `supabase/scripts/track-adhoc-migrations.sql`
- No DDL was re-executed; this is tracking-only

## Status After

`supabase db push` will no longer attempt to re-apply these 6 migrations.
Hockney can now safely proceed to Step 5 (apply `20260501120000` insurance_policies cleanup).

## Handoff

- Steps 3+4 (RLS policies for dividend_payments, dividend_accruals, security_reference) → **Hockney**
- Step 5 (insurance_policies wave2 cleanup) → **Hockney** (pre-conditions check required first)
