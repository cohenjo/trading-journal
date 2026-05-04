-- Migration: add_options_phase2_roll_metrics
-- Purpose: Phase 2 roll-efficiency metrics for #247.

alter table public.options_dashboard_monthly
  add column if not exists roll_count integer not null default 0,
  add column if not exists roll_positive_count integer not null default 0,
  add column if not exists roll_negative_count integer not null default 0,
  add column if not exists roll_neutral_count integer not null default 0,
  add column if not exists roll_efficiency_pct numeric(5,2);

create index if not exists options_roll_events_account_closed_trade_idx
  on public.options_roll_events (household_id, account_id, closed_trade_id)
  where detection_status != 'rejected';
