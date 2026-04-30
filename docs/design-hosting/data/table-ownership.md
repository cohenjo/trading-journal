# Table Ownership Classification

**Owner:** McManus (Data/Finance Dev)  
**Requested by:** Jony Vesterman Cohen  
**Issue:** TJ-003 / GH #56  
**Status:** Draft — pending Jony review on open questions  
**Related:** `docs/design-hosting/sections/06-data-architecture.md`, TJ-005 (#58)

---

## Overview

This document classifies every **existing** database table in the trading-journal codebase into one of four ownership buckets, and identifies the migration column each non-conforming table needs before RLS policies can be applied.

Tables that appear only in design documentation but have no corresponding `SQLModel` class or Supabase migration are marked **[PLANNED]** and excluded from the classification count.

### Ownership buckets

| Bucket | Description | Required FK | RLS Pattern |
|--------|-------------|-------------|-------------|
| **household** | Financial data shared across household members (trades, positions, plans, insurance…). | `household_id uuid not null references public.households(id)` | `using (public.is_household_member(household_id))` |
| **owner-private** | Data the user owns but does not share with household (notes, draft experiments, API keys). | `owner_user_id uuid not null references auth.users(id)` | `using (owner_user_id = auth.uid())` |
| **global-reference** | Read-only reference/market data identical across all users. | None | `for select using (auth.role() = 'authenticated')` — write restricted to `service_role` |
| **system/infra** | Identity/tenancy infrastructure tables managed by Supabase auth or the app itself. | n/a | Managed by Supabase or trigger-only writes |

---

## Table Classification

Sources surveyed:
- `apps/backend/app/schema/models.py`
- `apps/backend/app/schema/trading_models.py`
- `apps/backend/app/schema/user_models.py`
- `apps/backend/app/schema/finance_models.py`
- `apps/backend/app/schema/plan_models.py`
- `apps/backend/app/schema/dividend_models.py`
- `apps/backend/app/schema/backtest_models.py`
- `apps/backend/app/schema/insurance_models.py`
- `apps/backend/app/schema/ladder_models.py` (dataclasses only — no DB tables)
- `apps/backend/app/schema/options_models.py` (Pydantic only — no DB tables)
- `supabase/migrations/20260430120000_households_and_members.sql`
- `supabase/migrations/20260430120100_rls_helpers.sql`
- `supabase/migrations/20260430120200_rls_policies_households.sql`

| # | Table (physical name) | Source file | Schema layer | Ownership | Required FK to add | RLS Policy Pattern | Notes |
|---|----------------------|-------------|-------------|-----------|-------------------|--------------------|-------|
| 1 | `user_profile` | `user_models.py` → retired; `supabase/migrations/20260430130400` | app | **system/infra** | — | Owner-only (`id = auth.uid()`) | Auto-provisioned via auth.users AFTER INSERT trigger. Replaces `public.user` (dropped in 20260430130400). Stores display_name, default_household_id, ui_preferences, filter_prefs. |
| 2 | `manualtrade` | `models.py` | raw/app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | User-entered trade journal rows. Directly contributes to household P&L/tax dashboard. |
| 3 | `trade` | `models.py` | raw/app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | IBKR-imported trades keyed by broker `tradeID`. Has broker `accountId` (source ID) — keep as-is; household FK is the tenancy boundary. |
| 4 | `execution` | `models.py` | raw/app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Broker execution rows. Has `acctNumber` string — preserve as source identifier alongside household FK. |
| 5 | `matchedtrade` | `models.py` | compute/app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Derived open/close P&L pairs. Should migrate to `compute.compute_*` layer per TJ-004, but while it lives in the app schema it needs household scoping. |
| 6 | `dailysummary` | `models.py` | cooked/app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Daily trade P&L rollup. Candidate for replacement by `cooked.cooked_pnl_summary` (TJ-004). Needs household FK in the interim. |
| 7 | `note` | `models.py` | app | **owner-private** | `owner_user_id uuid not null` | `owner_user_id = auth.uid()` | Date-keyed journal notes. Personal by default. ⚠️ See Open Question 1 — Jony may want a `shared` flag to allow household visibility. |
| 8 | `ndx1m` | `models.py` | raw | **global-reference** | None | `for select using (auth.role() = 'authenticated')` | NDX 1-minute OHLCV. Market data is identical across all households; no tenant scoping needed. Write restricted to `service_role`. |
| 9 | `dailybar` | `models.py` | raw | **global-reference** | None | `for select using (auth.role() = 'authenticated')` | Symbol/date OHLCV bars. Same rationale as `ndx1m`. |
| 10 | `trading_account_config` | `trading_models.py` | app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Account labels, type, host/port, linked_account_id, account_id, last_synced. Broker credential columns (app_key, app_secret, account_hash, tokens_path) **dropped** in migration 20260430130300 — no broker-API scope. RLS enabled (member read/insert/update, owner delete). |
| 11 | `trading_account_summary` | `trading_models.py` | cooked/app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Account balance snapshots. Contributes to household net worth view. FK currently points to `trading_account_config.id` — once config is split, update FK. |
| 12 | `trading_positions` | `trading_models.py` | cooked/app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Broker position snapshots. Shared holdings view for both spouses. FK currently points to `trading_account_config.id` — update after config split. |
| 13 | `finance_snapshots` | `finance_models.py` | cooked/app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Net-worth snapshot JSON + scalar totals. Nested `FinanceItem.owner` strings ("You", "Partner") are display/attribution fields, not auth boundaries — keep them. |
| 14 | `plans` | `plan_models.py` | app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Financial planning scenarios stored as JSON. Nested `PlanItem.owner` string is attribution-only, not auth. Plans are couple-level by design. |
| 15 | `dividend_positions` | `dividend_models.py` | app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Dividend portfolio positions. Has `account` string (e.g., "ABKR", "RSU") as a label — not an auth boundary. Holdings are shared planning data. |
| 16 | `dividend_accounts` | `dividend_models.py` | app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Dividend account registry. Links to `FinanceItem.id`. Shared account-level view. |
| 17 | `dividend_ticker_data` | `dividend_models.py` | raw | **global-reference** | None | `for select using (auth.role() = 'authenticated')` | Market/reference metrics (yield, DGR, price) from yfinance. Same data for all households. Service-role writes only. |
| 18 | `insurance_policies` | `insurance_models.py` | app | **household** | `household_id uuid not null` | `is_household_member(household_id)` | Insurance inventory. Has `owner` string ("You", "Partner") for attribution — not auth boundary. Family continuity data; beneficiary info should be visible to spouse. |
| 19 | `optioncontract` | `backtest_models.py` | raw | **global-reference** | None | `for select using (auth.role() = 'authenticated')` | IBKR contract registry. Option contract specs are market reference data. Service-role writes only. |
| 20 | `historicaloptionbar` | `backtest_models.py` | raw | **global-reference** | None | `for select using (auth.role() = 'authenticated')` | Historical OHLCV + Greeks per option contract. Market data, not user-scoped. |
| 21 | `backtestrun` | `backtest_models.py` | compute/app | **owner-private** | `owner_user_id uuid not null` | `owner_user_id = auth.uid()` | Backtest configuration and results. Research sandbox; personal unless explicitly shared. ⚠️ See Open Question 3 — may need a `shared_with_household` flag. |
| 22 | `backtesttrade` | `backtest_models.py` | compute/app | **owner-private** | *(inherited from backtestrun)* | Inherit via JOIN to `backtestrun.owner_user_id` | Trades emitted by a backtest run. Visibility inherits from the parent `backtestrun`. No direct FK needed if RLS uses a subquery join. |
| 23 | `households` | `supabase/migrations/20260430120000` | system/infra | **system/infra** | — | Already RLS-enabled (see migration 20260430120200) | Tenancy boundary table. RLS live: members read, authenticated insert, owner update, no hard-delete. |
| 24 | `household_members` | `supabase/migrations/20260430120000` | system/infra | **system/infra** | — | Already RLS-enabled (see migration 20260430120200) | Membership join table. RLS live: owner inserts/updates, no hard-delete. |

---

## Planned Tables (NOT yet in code)

These appear in `docs/design-hosting/sections/06-data-architecture.md` but have no SQLModel class or Supabase migration yet. Listed for completeness; not classified as "existing".

| Table | Layer | Planned Ownership | Notes |
|-------|-------|------------------|-------|
| `public.users` | system/infra | system/infra | Supabase `auth.users` mirror. Not yet in code. |
| `raw.raw_trades_import` | raw | household | DDL in design doc §4. Needs `household_id + uploaded_by`. |
| `raw.raw_market_data` | raw | global-reference | DDL in design doc §4. |
| `raw.raw_broker_statement` | raw | household | DDL in design doc §4. |
| `compute.compute_pnl_runs` | compute | household | DDL in design doc §4. |
| `compute.compute_pnl_daily` | compute | household | DDL in design doc §4. |
| `compute.compute_position_lots` | compute | household | Mentioned in design doc §4. |
| `cooked.cooked_pnl_summary` | cooked | household | DDL in design doc §4. |
| `cooked.cooked_position_snapshot` | cooked | household | Mentioned in design doc §4. |
| `cooked.cooked_planning_dashboard` | cooked | household | Mentioned in design doc §4. |

---

## Summary Counts

| Ownership | Count | Tables |
|-----------|-------|--------|
| **household** | 13 | `manualtrade`, `trade`, `execution`, `matchedtrade`, `dailysummary`, `trading_account_summary`, `trading_positions`, `finance_snapshots`, `plans`, `dividend_positions`, `dividend_accounts`, `insurance_policies`, `trading_account_config` |
| **owner-private** | 2 | `note`, `backtestrun` |
| **owner-private (inherited)** | 1 | `backtesttrade` |
| **global-reference** | 5 | `ndx1m`, `dailybar`, `dividend_ticker_data`, `optioncontract`, `historicaloptionbar` |
| **system/infra** | 3 | `user_profile`, `households`, `household_members` |
| **Total existing tables** | 24 | |

---

## Removed Tables

| Table | Removed by | Reason |
|-------|-----------|--------|
| `public.user` | `20260430130400_user_to_user_profile.sql` | Pre-Supabase password table retired; replaced by `public.user_profile` (Decision #4, 2026-04-30) |
| `public.trading_account_secrets` | `20260430130300_drop_trading_account_secrets.sql` | Never created (was sketch-only); no broker-API integration in scope (Decision #3, 2026-04-30) |

---

## Migration Impact

For every table that currently lacks `household_id` or `owner_user_id`, the following columns must be added before RLS policies can be applied. This section is input to **TJ-005 (#58)**.

> ⚠️ **Do not touch `supabase/migrations/`** (Rabin's territory). These are recommendations for a new migration file to be created by Rabin or a designated owner.

### Household-scoped tables — add `household_id`

```sql
-- Prerequisite: public.households table exists (✅ already in migration 20260430120000)

ALTER TABLE public.manualtrade          ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.trade                ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.execution            ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.matchedtrade         ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.dailysummary         ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.trading_account_summary  ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.trading_positions    ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.finance_snapshots    ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.plans                ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.dividend_positions   ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.dividend_accounts    ADD COLUMN household_id uuid REFERENCES public.households(id);
ALTER TABLE public.insurance_policies   ADD COLUMN household_id uuid REFERENCES public.households(id);

-- After backfill, make NOT NULL:
-- ALTER TABLE public.<table> ALTER COLUMN household_id SET NOT NULL;
```

### Owner-private tables — add `owner_user_id`

```sql
ALTER TABLE public.note          ADD COLUMN owner_user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.backtestrun   ADD COLUMN owner_user_id uuid REFERENCES auth.users(id);
-- backtesttrade: no direct FK needed — RLS via JOIN to backtestrun.owner_user_id
```

### `trading_account_config` — resolved (Decision #3, 2026-04-30)

Broker credential columns dropped; `household_id` added. See migration `20260430130300_drop_trading_account_secrets.sql`.

### No migration needed (global-reference tables)

`ndx1m`, `dailybar`, `dividend_ticker_data`, `optioncontract`, `historicaloptionbar` — these get a blanket `FOR SELECT TO authenticated` RLS policy; no new FK column required.

### No migration needed (system/infra)

`households`, `household_members` — RLS is already live per migration `20260430120200`.  
`user_profile` — created by migration `20260430130400`; no additional FK column needed.

---

## Open Questions

### Q1 — Should `note` support optional household sharing?

`note` is classified **owner-private** by default (personal journal). However, some couples may want to share journal entries (e.g., "why did we sell X today"). Two options:

- **Option A (recommended):** Add `owner_user_id` and a nullable `household_id`. If `household_id` is set, the note is household-visible; if null, it is owner-private. RLS: `owner_user_id = auth.uid() OR (household_id IS NOT NULL AND is_household_member(household_id))`.
- **Option B:** Keep notes strictly owner-private; create a separate `household_notes` table for shared notes.

**Action needed:** Jony to confirm which model fits the product vision.

### ~~Q2 — How to handle `trading_account_config` secrets?~~ ✅ RESOLVED (Decision #3, 2026-04-30)

**Decision:** DROP all broker credential columns (`app_key`, `app_secret`, `account_hash`, `tokens_path`) from `trading_account_config`. No broker-API integration is in scope; only manual trade entries. `trading_account_config` is now purely household-scoped. See migration `20260430130300_drop_trading_account_secrets.sql`.

### Q3 — Should `backtestrun` be promotable to household visibility?

`backtestrun` is classified **owner-private** (research sandbox). However, a user might want to share a completed backtest with their spouse ("here's the strategy I'm considering"). Options:
- **Option A:** Add a `shared_with_household` boolean + nullable `household_id`. When set, household members can read the run and its trades.
- **Option B:** Keep strictly owner-private; if sharing is needed later, allow explicit copy to a household-scoped `shared_backtests` table.

**Action needed:** Jony to confirm whether backtest sharing is in scope for the MVP.

---

## What This Doc Found That `design.md` Didn't Specify

The design doc (`docs/design-hosting/design.md`) describes the household/RLS system at a high level but does not enumerate per-table ownership or migration column requirements. This document adds:

1. **`trading_account_config` dual-ownership problem** — the design doc recommended splitting credentials, but did not specify the exact columns or the three-option trade-off.
2. **`backtesttrade` inherits visibility** from `backtestrun` via JOIN, meaning it does not need a direct `owner_user_id` FK — this was not explicitly stated.
3. **`matchedtrade` and `dailysummary`** are compute/cooked artifacts that need `household_id` now (interim) but are candidates for replacement by the planned `cooked.*` layer (TJ-004).
4. **`user` (local password table)** needs to be formally marked for retirement — it will conflict with `auth.users` in the Supabase migration if left in place.
5. **`backtestrun`/`note` optional household promotion** was not addressed in the design; both have product-level questions that need Jony input before TJ-005 can proceed.
6. **The `owner` string fields** in `FinanceItem`, `PlanItem`, `InsurancePolicy`, and `DividendPosition` are display/attribution fields, NOT auth boundaries — confirmed explicitly here to prevent future confusion where a developer might try to use them for RLS.

---

*Generated by McManus (Data/Finance Dev) for issue TJ-003 / GH #56.*  
*Input to TJ-005 (#58) migration planning.*
