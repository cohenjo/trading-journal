-- Fix 1: LSE market_value was stored in GBp (pence) but labelled GBP.
-- Yahoo Finance returns LSE close prices in GBp; the worker multiplied
-- mark_price × qty without dividing by 100, so every LSE position had a
-- market_value 100× too large (e.g. BARC: £926k pence, should be £9.3k GBP).
-- Divide by 100 to give canonical GBP values.
UPDATE stock_positions
SET market_value       = market_value       / 100,
    market_value_local = market_value_local / 100
WHERE currency = 'GBP'
  AND market_value IS NOT NULL;

-- Fix 2: LSE and TASE dividend_yield was computed from
-- trailingAnnualDividendYield which is 100× too small for sub-unit currencies
-- (Yahoo computes it as rate-in-major-unit / price-in-sub-unit).
-- Null out implausibly small yields (< 0.1%) for GBP and ILA positions so
-- the worker repopulates them with correct dividendYield-based values.
UPDATE stock_positions
SET dividend_yield = NULL
WHERE currency IN ('GBP', 'ILA')
  AND dividend_yield IS NOT NULL
  AND dividend_yield < 0.001;

-- Fix 3: ticker 1150283 has a 49% yield stored from a prior bad write.
-- Yahoo Finance returns null for this ticker (no dividend data available).
-- Null the yield and let the user backfill manually if data becomes available.
UPDATE stock_positions
SET dividend_yield = NULL
WHERE ticker = '1150283'
  AND dividend_yield IS NOT NULL;
