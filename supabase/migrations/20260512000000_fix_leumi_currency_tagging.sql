-- Migration: fix Leumi IRA positions that were imported with currency='ILS'
-- while mark_price and market_value were stored in agorot (ILA = 1/100 ILS).
--
-- Root cause: the Leumi XLS parser emitted currency='ILS' for TASE paper-number
-- tickers before the ILA tagging was in place.  After Yahoo worker PR #410 landed
-- (worker now divides by 100 when is_tase=True), positions that the worker cannot
-- resolve via tase_yahoo_map remain with inflated agorot values.
--
-- Fix:
--   1. Re-tag currency 'ILS' → 'ILA' for numeric-ticker rows.
--   2. Divide market_value by 100  (agorot → ILS).
--   3. Set market_value_local = market_value / 100 (ILS snapshot) when not already
--      present, preserving any broker-stamped value.
--
-- Idempotent: the WHERE clause matches only rows that are still currency='ILS'
-- with a numeric ticker.  Rows already fixed (currency='ILA') are untouched.
-- After the parser fix (same PR) re-imports will produce currency='ILA' directly,
-- so this migration will be a no-op on subsequent runs.

UPDATE stock_positions
SET
    currency           = 'ILA',
    market_value       = market_value / 100,
    market_value_local = COALESCE(market_value_local, market_value / 100)
WHERE currency = 'ILS'
  AND ticker ~ '^\d+$'       -- numeric paper-number tickers only (TASE)
  AND quantity > 0
  AND market_value IS NOT NULL;
