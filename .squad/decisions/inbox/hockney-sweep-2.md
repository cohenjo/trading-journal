# Household ID RLS Bugfix Sweep 2: dividend_accounts + trading

**Date:** 2026-05-01  
**Author:** Hockney (Backend Dev)  
**PR:** #136  
**Branch:** squad/sweep-household-2

## Context

PR #134 fixed the IRA investment account save bug where `finance_snapshots` had RLS requiring `household_id NOT NULL`, but the API wasn't injecting it. This caused silent RLS rejections.

The same bug class existed on other endpoints. This sweep targeted:
- `dividend_accounts.py` (3 writes)
- `trading.py` (writes to trading_account_summary + trading_positions)
- `bonds.py` (investigation only — no fix needed)

A parallel agent (Fenster) handled `insurance.py`, `pension.py`, `plans.py` on a separate branch.

## Root Cause Pattern

**Classic RLS silent rejection:** Tables with `household_id NOT NULL` RLS policies reject writes that don't set `household_id`, but the database returns success without the row being visible to the user. On the API side, this looks like a successful write that mysteriously disappears.

**Read leak:** Endpoints that don't filter SELECTs by `household_id` return data from all households, violating isolation.

## Files Fixed

### Schema Models
1. `apps/backend/app/schema/dividend_models.py`
   - Added `household_id: Optional[UUID]` to `DividendAccount`

2. `apps/backend/app/schema/trading_models.py`
   - Added `household_id: Optional[UUID]` to `TradingAccountSummary`
   - Added `household_id: Optional[UUID]` to `TradingPosition`

### API Endpoints
3. `apps/backend/app/api/dividend_accounts.py`
   - Injected `get_current_user_id` and `get_user_household_id` in all endpoints
   - Filtered all SELECTs by `household_id`
   - Set `household_id` on all INSERTs
   - Validated `household_id` on UPDATE/DELETE

4. `apps/backend/app/api/trading.py`
   - Injected `get_current_user_id` and `get_user_household_id` in write endpoints
   - Filtered all SELECTs by `household_id`
   - Passed `household_id` to `trading_service` methods

### Service Layer
5. `apps/backend/app/services/trading_service.py`
   - Updated `sync_account`, `sync_ibkr`, `sync_schwab` to accept `household_id: UUID` parameter
   - Injected `household_id` when creating records
   - Filtered deletes by `household_id` to avoid cross-household data corruption
   - Updated `sync_to_dividends` and `_update_finance_snapshot` to scope by household_id

### Tests
6. `apps/backend/tests/test_household_isolation.py`
   - New test file with cross-household isolation tests

## Migrations

**None required.** The `household_id` columns already exist (added in migration 20260430130100), and RLS policies already exist (enabled in 20260430160200). This PR only fixes the application layer.

## Stay-Out Cases

**bonds.py** — Only has `/bonds/scanner` endpoint with mock in-memory data. No database operations, no household_id needed.

## Pattern for Future Fixes

When fixing similar RLS bugs:

1. **Identify the table(s)** — Read the SQLModel imports + endpoint bodies
2. **Check migrations** — Grep for table names, verify RLS policies
3. **Fix API code** — Inject `household_id` via `get_user_household_id`
   - Filter SELECTs by `household_id`
   - Set `household_id` on INSERTs
   - Validate `household_id` on UPDATE/DELETE
4. **Propagate to service layer** — If using service classes, pass `household_id` as parameter
5. **Test** — Add cross-household isolation tests
6. **Migration (if needed)** — Only if RLS uses `user_id` or no `household_id` column exists

## Reference Examples

Canonical implementations to copy from:
- `apps/backend/app/api/dividends.py` (fixed in #129)
- `apps/backend/app/api/holdings.py` (fixed in #129)
- `apps/backend/app/api/finances.py` (fixed in #134, most recent)

Migration pattern:
- `supabase/migrations/20260501110927_finance_snapshots_household_pk_fix.sql` (idempotent, household_id-scoped RLS)

## Impact

- **dividend_accounts** endpoints now properly scope to household
- **trading** endpoints now properly scope to household
- Cross-household data leaks eliminated
- RLS silent rejections eliminated
- Multi-household users can safely use these features

## Follow-up

None required. This sweep completes the household_id RLS bugfix series for dividend_accounts and trading endpoints. Fenster's parallel sweep (insurance/pension/plans) will merge independently.
