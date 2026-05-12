-- Round 8 Phase 2: Sync market_value from market_value_local for
-- no-Yahoo positions (TASE mutual funds / ETFs without a yahoo_ticker).
-- These positions have market_value_local correctly set from Leumi import
-- but market_value was never written because the Yahoo worker skips them.
-- This brings them into the canonical column so display surfaces use market_value.
UPDATE stock_positions
SET market_value = market_value_local
WHERE market_value IS NULL
  AND market_value_local IS NOT NULL;
