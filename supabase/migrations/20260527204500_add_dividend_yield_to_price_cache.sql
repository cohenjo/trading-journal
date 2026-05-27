-- Migration: add_dividend_yield_to_price_cache
-- Purpose: Persist trailing 12-month dividend yield alongside spot price so the
-- RSU plan-hydration worker can populate the financial plan with both price and
-- yield in one read.  See PR #480 (RSU automation).
--
-- CONVENTION (project-wide for price_cache):
--   dividend_yield is stored as percentage form (0.87 means 0.87%).
--   yfinance returns decimal fraction (0.0087) — normalised exactly once at
--   the write boundary by `_yfinance_yield_to_percent()` in
--   apps/backend/app/services/price_cache.py.  Consumers
--   (plan_components.py:427) treat the stored value as percent and divide by
--   100 before multiplying account value.
--
-- IMPORTANT: public.stock_positions.dividend_yield uses a DIFFERENT convention
-- (decimal fraction, canonicalised by 20260511230000) — this migration does
-- NOT touch that table.

alter table public.price_cache
  add column if not exists dividend_yield numeric(18, 8);

comment on column public.price_cache.dividend_yield is
  'Trailing 12-month dividend yield as percentage form (0.87 = 0.87%). '
  'NULL when the symbol pays no dividend or yield is unavailable. '
  'Normalised at write by _yfinance_yield_to_percent() in price_cache.py.';

-- Idempotent one-shot backfill: convert any rows that were written in
-- decimal-fraction form (pre-normalisation, value < 1) to percentage form.
-- Values already in percentage form (>= 1) are left unchanged.
-- NULLs are skipped by the WHERE clause.  Empty tables are a no-op.
update public.price_cache
   set dividend_yield = dividend_yield * 100
 where dividend_yield is not null
   and dividend_yield > 0
   and dividend_yield < 1;
