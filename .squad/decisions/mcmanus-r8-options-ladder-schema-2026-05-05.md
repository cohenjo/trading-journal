# McManus R8 — Options & Ladder Schema Close (#191, #192)

**Date:** 2026-05-05
**Author:** McManus (Data/Finance Dev)
**Issues closed:** #191 (options schema), #192 (ladder schema)

---

## Context

Issues #191 and #192 were filed on 2026-05-03 when schema audit #189 found that
the Supabase options and ladder tables were missing. Between 2026-05-03 and
2026-05-04, the schema landed across four merged PRs:

| PR/commit | Migration file | Tables |
|---|---|---|
| PR #196 (cbd2881) | 20260503142446 | `options_income` |
| PR #196 (cbd2881) | 20260503142507 | `ladder_rungs`, `ladder_bonds` |
| feat #246 (6e41890) | 20260504134438 | `options_flex_sync_state`, `options_legs`, `options_strategy_groups`, `options_trades`, `options_cash_events`, `options_positions`, `options_roll_events`, `options_dashboard_monthly` + enums |
| feat #249 (dfa995f) | 20260504150112 | `options_strategy_capital_history`, `options_margin_snapshots` |

None of those PRs formally closed #191 or #192.

---

## Schema Decisions

### Options (#191)

- **`options_income`**: Simple yearly rollup `(household_id, year, amount)`. Lightweight aggregate for dashboard bar chart. PK is `(household_id, year)`.
- **Full event-sourced model** (phase 1): legs → trades → positions → roll events → monthly dashboard aggregate. Chosen for auditability and FIFO lot matching correctness.
- **Strategy groups**: Optional grouping layer above trades (CSP, vertical spread, roll chain). Nullable parent_group_id supports nested chains. Soft-delete via `closed_at`.
- **Enums**: `option_right`, `options_strategy_kind`, `options_strategy_status`, `options_trade_event_type`, `options_trade_side`, `options_cash_event_category`, `options_roll_classification`, `options_roll_detection_status`, `options_sync_source`, `options_sync_status`. All created with `do $$ begin ... exception when duplicate_object then null; end $$` guard.
- **Monetary precision**: `NUMERIC(18,6)` throughout — matches the project baseline migration convention (Decision #2 in .squad/decisions.md).
- **`options_strategy_capital_history` RLS**: No direct `household_id`; scoped via `EXISTS (SELECT 1 FROM options_strategy_groups WHERE id = group_id AND is_household_writer(household_id))`. This join-based RLS is necessary and documented.
- **`options_margin_snapshots`**: Has direct `household_id`; standard member/writer policies.

### Ladder (#192)

- **Two-table design**: `ladder_rungs` (year-based parent) + `ladder_bonds` (child allocation). Composite PKs `(household_id, id)` with a separate `UNIQUE (household_id, year)` constraint on rungs.
- **FK cascade**: `ladder_bonds.rung_id` → `ladder_rungs` with `ON DELETE CASCADE` — bond rows are meaningless without their rung.
- **Monetary precision**: `NUMERIC(18,6)` matching project convention.

---

## Gap Found and Fixed (R8 close migration)

**Supabase performance advisor (2026-05-05)** flagged:
> `options_margin_snapshots.account_config_id` FK has no covering index.

Resolution: Added partial index `options_margin_snapshots_account_config_id_idx WHERE account_config_id IS NOT NULL` in `20260505120000_options_ladder_schema_close.sql`. Partial because the column is nullable and sparse.

---

## RLS Approach

All tables use the standard project pattern from `20260430120100_rls_helpers.sql`:

- **SELECT**: `public.is_household_member(household_id)`
- **INSERT/UPDATE/DELETE**: `public.is_household_writer(household_id)`

The `is_household_member` / `is_household_writer` helpers are `SECURITY DEFINER` functions that read `household_members` without row-security bypass risk because they accept an explicit `household_id` parameter.

---

## Follow-ups Deferred

- **FLOAT vs NUMERIC in `options_income.amount`**: Uses `NUMERIC(18,6)` ✅ (no issue).
- **Realtime subscriptions**: `options_margin_snapshots` and `options_strategy_capital_history` added to `supabase_realtime` publication in phase4. Other options tables not subscribed (polling is sufficient for dashboard).
- **Index on `options_dashboard_monthly.account_id`**: Not yet added. Will add when query patterns emerge from the Server Action layer (#183).
- **`ladder_rungs` unused index warning**: `ladder_rungs_household_id_idx` flagged as unused by advisor. Expected — table is new and data volume is zero. Will re-evaluate after first production sync.
