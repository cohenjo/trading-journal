-- Canonicalise stock_positions.dividend_yield to decimal fraction [0, 1].
-- Before this migration some rows were written as percentage (e.g. 10.43 for 10.43%)
-- by Yahoo Finance's `dividendYield` info field, while others were already decimal
-- (e.g. 0.1043) from Schwab CSV or `trailingAnnualDividendYield`.
--
-- This migration is idempotent: after the UPDATE, all values are ≤ 1, so
-- re-running it will match zero rows.
UPDATE stock_positions
SET dividend_yield = dividend_yield / 100
WHERE dividend_yield > 1;
