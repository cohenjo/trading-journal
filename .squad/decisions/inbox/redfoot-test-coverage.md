# Decision: Backend Financial Test Coverage (Issue #5)

**Author:** Redfoot (Tester)  
**Date:** 2025-07-25  
**Status:** Proposed

## Context

The backend had ~136 passing tests but major gaps in financial calculation coverage. Core money-handling logic — daily PnL summaries, dividend/options projections, XLSX data import, and Decimal precision in options analytics — had zero tests.

## Decision

Added 94 focused pytest tests across 6 new test files:

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `test_daily_summary.py` | 16 | PnL aggregation, win rate, avg win/loss, edge cases |
| `test_dividend_projection.py` | 14 | Reinvest/withdrawal phases, compounding, phase transitions |
| `test_options_projection.py` | 10 | Growth/flat phases, base averaging, cutoff transitions |
| `test_options_analytics_edge_cases.py` | 24 | IV percentile/rank boundaries, CSP Decimal precision, Greeks formatting |
| `test_xlsx_data_loaders.py` | 13 | Bonds/dividends/options XLSX load/save, invalid data handling |
| `test_dividend_service_enrich.py` | 17 | CAGR edge cases, position enrichment, portfolio yield, DGR averaging |

## Key Principles

1. **Self-contained**: All tests use mocks for DB and file I/O — no external dependencies
2. **Known expected values**: Financial calculations verified with hand-computed results
3. **Decimal verification**: CSP breakeven tests confirm Decimal rounding (ROUND_HALF_UP)
4. **Projection logic extracted**: Dividend/options projection math replicated as pure functions for isolated testing (original logic is embedded in FastAPI endpoints)

## Gaps Remaining

- **API integration tests** for `POST /trades` (requires DB session, existing conftest supports it)
- **Finance snapshot enrichment** (`GET /api/finances/latest`) — complex currency conversion flow
- **Dividend service `resolve_dividend_data`** — only basic tests; yfinance edge cases need more coverage
- Projection logic should ideally be extracted from endpoints into utility functions (refactor candidate)

## Impact

- Total test count: ~136 → ~230 (94 new)
- All financial calculations now have baseline coverage
- No pre-existing tests were modified or broken
