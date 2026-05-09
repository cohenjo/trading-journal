-- Migration: 20260504134951_fix_options_legs_null_conid_key
-- Source: pulled from production (remote-only, issue #335)

alter table if exists public.options_legs drop constraint if exists options_legs_household_account_conid_key;
create unique index if not exists options_legs_household_account_conid_key on public.options_legs (household_id, account_id, source_conid) where source_conid is not null;
