# Orchestration Log: Fenster — Short-Term Chart EMAs

**Timestamp:** 2026-03-04T22:30:42Z
**Agent:** Fenster (Frontend Dev)
**Task Status:** COMPLETED

## Summary

Fixed short-term chart EMA rendering per-bar. Computed EMA 50/200 client-side from OHLCV data. Changed fetch period to 1 year for proper EMA convergence, zoomed chart display to last 25 bars for focused short-term view.

## Changes Made

- Modified chart data fetch to request full 1-year historical OHLCV
- Implemented client-side EMA 50/200 calculation from fetched data
- Updated chart rendering logic to display only last 25 bars
- Verified Bollinger Bands recalculate correctly with subset view

## Files Modified

- `apps/frontend/src/components/ShortTermView.tsx`
- `apps/frontend/src/hooks/usePriceHistory.ts`

## Impact

Short-term chart now displays accurate technical indicators. No breaking changes.
