-- Follow-up to 20260512000000: fix market_value_local still in agorot.
--
-- The previous migration re-tagged currency ILS→ILA and divided market_value by 100,
-- but market_value_local was already set (by the Yahoo worker pre-PR-#410) to the
-- agorot value (qty × price, no division).  COALESCE preserved it as-is.
--
-- Fix: divide market_value_local by 100 for rows where the ratio market_value_local/
-- market_value ≈ 100, which unambiguously identifies them as agorot.
--
-- Idempotent: after division the ratio becomes ≈ 1; subsequent runs will not match.

UPDATE stock_positions
SET market_value_local = market_value_local / 100
WHERE currency = 'ILA'
  AND ticker ~ '^\d+$'
  AND quantity > 0
  AND market_value IS NOT NULL
  AND market_value_local IS NOT NULL
  AND ROUND(market_value_local::numeric / market_value::numeric) = 100;
