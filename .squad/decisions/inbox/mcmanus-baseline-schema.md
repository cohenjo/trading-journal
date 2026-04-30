# Decision: Baseline Legacy Schema Migration Strategy

**Date:** 2026-04-30  
**Author:** McManus (Data/Finance Dev)  
**Context:** TJ-005 followup — unblocking 130xxx migrations

## Problem

Supabase migrations 130000, 130100, 130200, 130300 (which add audit columns, household_id, owner_user_id, and RLS policies) were failing because they reference legacy tables that don't exist on fresh Supabase instances:

- `manualtrade`, `trade`, `execution`, `matchedtrade`, `dailysummary`
- `backtestrun`, `backtesttrade`, `optioncontract`, `historicaloptionbar`
- `finance_snapshots`, `plans`, `insurance_policies`
- `dividend_positions`, `dividend_accounts`, `dividend_ticker_data`
- `trading_account_config`, `trading_account_summary`, `trading_positions`
- `note`, `ndx1m`, `dailybar`

The Alembic migration chain (22 migrations from 8250ff809a39 through 4d9a58ecd93b) was designed for local development databases and cannot be directly applied to Supabase.

## Decision

Create a **single baseline migration** (`20260430115000_baseline_legacy_schema.sql`) that:

1. **Consolidates 22 Alembic migrations** into one idempotent SQL file
2. **Creates all 21 legacy tables** in their final schema form (after all evolutions)
3. **Uses CREATE TABLE IF NOT EXISTS** for safety and idempotency
4. **Applies NUMERIC(18,6)** for all monetary fields (per Decision #2 from PR #85)
5. **Creates stub `trading_account_secrets`** so migration 130300 can drop it cleanly
6. **Does NOT add household_id, owner_user_id, audit columns, or RLS** — those are added by subsequent 130xxx migrations

## Rationale

**Why not run Alembic migrations directly?**
- Alembic migrations have incremental schema transformations (ALTER TABLE operations)
- Many are designed for local databases with existing data
- Some migrations reference tables that don't exist yet (e.g., d869bcf363dc adds columns to `trade` but the table was never created)
- Would require 22 sequential migrations vs. 1 baseline

**Why timestamp 115000?**
- Runs before 120000 (household bootstrap) in the migration chain
- Ensures legacy tables exist before household/RLS migrations run
- Maintains clear dependency order

**Why create stub trading_account_secrets?**
- Migration 130300 drops this table per Decision #3
- Creating it ensures 130300 can run cleanly without errors
- Documents the design evolution explicitly

## Implementation Details

**Key challenge:** Migration 335418ec68e3 was incomplete — only created `manualtrade`, not `trade`. Yet migration d869bcf363dc assumes `trade` exists and does `ALTER TABLE trade ADD COLUMN ...`. 

**Resolution:** Reconstructed the missing `trade` table creation from:
- The downgrade() function of d869bcf363dc (which recreates the simple schema)
- The upgrade() function of d869bcf363dc (which shows the full transformation)

**SQL keyword fix:** The `optioncontract.right` column needed quoting because `right` is a SQL reserved word.

## Applied

✅ **DEV** (zvbwgxdgxwgduhhzdwjj): 24 tables total (21 legacy + 3 household)  
✅ **PROD** (jaesiklybkbmzpgipvea): 24 tables total (21 legacy + 3 household)

All 5 migrations (115000, 130000, 130100, 130200, 130300) now successfully applied to both environments.

## Future Work

- **Incremental Alembic migrations:** Future schema changes can be added as new Supabase migrations
- **Periodic baseline updates:** Consider regenerating the baseline migration periodically as schema evolves
- **Local development sync:** Ensure local Alembic migrations stay in sync with Supabase baseline

## References

- PR #90: https://github.com/cohenjo/trading-journal/pull/90
- Alembic migration chain: apps/backend/alembic/versions/
- Supabase migrations: supabase/migrations/
- Decision #2 (NUMERIC precision): .squad/decisions/inbox/mcmanus-phase1-resolution.md
- Decision #3 (drop secrets table): supabase/migrations/20260430130300_drop_trading_account_secrets.sql
