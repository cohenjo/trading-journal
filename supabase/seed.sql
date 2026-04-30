-- ============================================================
-- supabase/seed.sql
-- Trading Journal — LOCAL DEV SEED DATA
--
-- WARNING: NOT FOR PRODUCTION
-- This file contains fictitious users, households, and financial
-- data for local development only. No real names, no real PII,
-- no real financial records.
--
-- Runs automatically on every: supabase db reset
-- All inserts use ON CONFLICT DO NOTHING — safe to re-run.
-- UUIDs are fixed so dependent rows stay consistent across resets.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- SEED USERS
-- Standard Supabase local-dev pattern: insert directly into
-- auth.users with a bcrypt-hashed password.
-- Login: alice@example.local / password123
--        bob@example.local   / password123
-- ────────────────────────────────────────────────────────────
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values
  (
    '00000000-0000-0000-0000-000000000000',  -- instance_id (default)
    '00000000-0000-0000-0000-000000000001',  -- user id (Alice)
    'authenticated',
    'authenticated',
    'alice@example.local',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Alice Demo"}',
    now(),
    now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000002',  -- user id (Bob)
    'authenticated',
    'authenticated',
    'bob@example.local',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Bob Demo"}',
    now(),
    now(),
    '', '', '', ''
  )
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────
-- HOUSEHOLD
-- Alice is the owner; Bob is a member.
-- created_by = Alice's user id.
-- ────────────────────────────────────────────────────────────
insert into public.households (id, name, created_by)
values (
  '00000000-0000-0000-0000-000000000010',
  'Demo Household',
  '00000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.household_members (household_id, user_id, role, invited_by)
values
  (
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000001',  -- Alice
    'owner',
    null
  ),
  (
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000002',  -- Bob
    'member',
    '00000000-0000-0000-0000-000000000001'   -- invited by Alice
  )
on conflict (household_id, user_id) do nothing;

-- ────────────────────────────────────────────────────────────
-- USER PROFILES
-- handle_new_auth_user() trigger auto-creates user_profile rows
-- when auth.users is inserted above. The inserts below are a
-- safety net in case trigger ordering varies on db reset.
-- ────────────────────────────────────────────────────────────
insert into public.user_profile (id, display_name, default_household_id)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'Alice Demo',
    '00000000-0000-0000-0000-000000000010'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Bob Demo',
    '00000000-0000-0000-0000-000000000010'
  )
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────
-- COOKED: dashboard_summary
-- Skeleton rows — summary_payload columns will be expanded in
-- TJ-020. Values are obviously fictional (round numbers, fake
-- tickers). Covers four periods × several dates for UI testing.
--
-- Note: cooked tables are service_role-write-only in production.
-- The seed inserts directly as the DB superuser (seed runs as
-- postgres, which bypasses RLS).
-- ────────────────────────────────────────────────────────────
insert into cooked.dashboard_summary
  (household_id, period, as_of_date, currency, summary_payload, _computed_at)
values

  -- day rows
  (
    '00000000-0000-0000-0000-000000000010',
    'day',
    '2026-05-01',
    'USD',
    '{
      "net_worth_usd": 125000.00,
      "daily_pnl_usd": 325.50,
      "daily_pnl_pct": 0.26,
      "top_positions": [
        {"ticker": "AAPL", "value_usd": 25000, "pnl_usd": 520},
        {"ticker": "MSFT", "value_usd": 18500, "pnl_usd": -195},
        {"ticker": "NVDA", "value_usd": 12000, "pnl_usd": 0}
      ]
    }'::jsonb,
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000010',
    'day',
    '2026-04-30',
    'USD',
    '{
      "net_worth_usd": 124674.50,
      "daily_pnl_usd": -410.00,
      "daily_pnl_pct": -0.33,
      "top_positions": [
        {"ticker": "AAPL", "value_usd": 24480, "pnl_usd": -280},
        {"ticker": "MSFT", "value_usd": 18695, "pnl_usd": -130},
        {"ticker": "NVDA", "value_usd": 12000, "pnl_usd": 0}
      ]
    }'::jsonb,
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000010',
    'day',
    '2026-04-29',
    'USD',
    '{
      "net_worth_usd": 125084.50,
      "daily_pnl_usd": 1100.00,
      "daily_pnl_pct": 0.89,
      "top_positions": [
        {"ticker": "AAPL", "value_usd": 24760, "pnl_usd": 600},
        {"ticker": "MSFT", "value_usd": 18825, "pnl_usd": 500},
        {"ticker": "AMZN", "value_usd": 9200,  "pnl_usd": 0}
      ]
    }'::jsonb,
    now()
  ),

  -- month rows
  (
    '00000000-0000-0000-0000-000000000010',
    'month',
    '2026-04-30',
    'USD',
    '{
      "net_worth_usd": 124674.50,
      "period_pnl_usd": 4674.50,
      "period_pnl_pct": 3.89,
      "best_performer": {"ticker": "NVDA", "pnl_usd": 3000},
      "worst_performer": {"ticker": "TSLA", "pnl_usd": -820}
    }'::jsonb,
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000010',
    'month',
    '2026-03-31',
    'USD',
    '{
      "net_worth_usd": 120000.00,
      "period_pnl_usd": -2300.00,
      "period_pnl_pct": -1.88,
      "best_performer": {"ticker": "MSFT", "pnl_usd": 900},
      "worst_performer": {"ticker": "META", "pnl_usd": -3200}
    }'::jsonb,
    now()
  ),

  -- year row
  (
    '00000000-0000-0000-0000-000000000010',
    'year',
    '2026-04-30',
    'USD',
    '{
      "net_worth_usd": 124674.50,
      "ytd_pnl_usd": 8750.25,
      "ytd_pnl_pct": 7.55,
      "best_performer": {"ticker": "NVDA", "pnl_usd": 5500},
      "worst_performer": {"ticker": "META", "pnl_usd": -3200},
      "realized_pnl_usd": 2100.00,
      "unrealized_pnl_usd": 6650.25
    }'::jsonb,
    now()
  ),

  -- all-time row
  (
    '00000000-0000-0000-0000-000000000010',
    'all',
    '2026-04-30',
    'USD',
    '{
      "net_worth_usd": 124674.50,
      "total_pnl_usd": 24674.50,
      "total_pnl_pct": 24.67,
      "inception_date": "2024-01-01",
      "total_deposits_usd": 100000.00,
      "total_withdrawals_usd": 0.00
    }'::jsonb,
    now()
  )

on conflict (household_id, period, as_of_date, currency) do nothing;
