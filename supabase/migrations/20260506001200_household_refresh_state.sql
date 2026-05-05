-- Migration: 20260506001200_household_refresh_state.sql
-- TJ-011: Household refresh state — tracks last successful compute run per household/job_type
-- McManus (Data/Finance Dev)
--
-- Design contract:
--   • One row per (household_id, job_type) — upserted by the compute worker on success.
--   • Failure does NOT update this table; last_succeeded_at reflects the last clean run.
--   • service_role only for writes; authenticated can SELECT their household's rows.
--   • Worker uses this for idempotency: skip re-running a job_type if last input hash matches.
--
-- Table:
--   public.household_refresh_state   — last successful run metadata per household/job_type
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; REVOKE/GRANT; policies in DO blocks.

create table if not exists public.household_refresh_state (
    household_id        uuid        not null references public.households(id) on delete cascade,
    job_type            text        not null,
    last_run_id         uuid,
    last_succeeded_at   timestamptz,
    last_failed_at      timestamptz,
    last_error          text,
    last_input_hash     text,
    primary key (household_id, job_type)
);

create index if not exists household_refresh_state_household_idx
    on public.household_refresh_state (household_id);

alter table public.household_refresh_state enable row level security;

revoke all on table public.household_refresh_state from anon;
revoke all on table public.household_refresh_state from authenticated;
grant select, insert, update on table public.household_refresh_state to service_role;
grant select on table public.household_refresh_state to authenticated;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'household_refresh_state'
          and policyname = 'household_refresh_state_member_select'
    ) then
        create policy household_refresh_state_member_select
            on public.household_refresh_state
            for select to authenticated
            using (public.is_household_member(household_id));
    end if;
end $$;

-- end of migration
