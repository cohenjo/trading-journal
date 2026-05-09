-- Migration: 20260504140054_add_options_income_fk_indexes
-- Source: pulled from production (remote-only, issue #335)

create index if not exists options_trades_strategy_group_id_idx on public.options_trades (strategy_group_id) where strategy_group_id is not null;
create index if not exists options_trades_matched_open_trade_id_idx on public.options_trades (matched_open_trade_id) where matched_open_trade_id is not null;
create index if not exists options_cash_events_related_trade_id_idx on public.options_cash_events (related_trade_id) where related_trade_id is not null;
create index if not exists options_cash_events_related_strategy_group_id_idx on public.options_cash_events (related_strategy_group_id) where related_strategy_group_id is not null;
create index if not exists options_positions_strategy_group_id_idx on public.options_positions (strategy_group_id) where strategy_group_id is not null;
create index if not exists options_positions_leg_id_idx on public.options_positions (leg_id);
create index if not exists options_roll_events_strategy_group_id_idx on public.options_roll_events (strategy_group_id);
create index if not exists options_roll_events_closed_trade_id_idx on public.options_roll_events (closed_trade_id);
create index if not exists options_roll_events_opened_trade_id_idx on public.options_roll_events (opened_trade_id);
create index if not exists options_strategy_groups_parent_group_id_idx on public.options_strategy_groups (parent_group_id) where parent_group_id is not null;
