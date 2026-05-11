-- Enforce dividend_yield is always stored as decimal fraction [0, 1].
-- Any future worker bug writing a percentage (e.g. 14.06 for 14.06%) will
-- cause a loud constraint violation rather than silently inflating UI numbers.
--
-- The normalise migration (20260511230000) already converted all existing rows;
-- this constraint locks the door going forward.

ALTER TABLE stock_positions
    ADD CONSTRAINT chk_dividend_yield_decimal
    CHECK (dividend_yield IS NULL OR (dividend_yield >= 0 AND dividend_yield <= 1));
