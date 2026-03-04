# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Mcmanus (Data/Finance Dev)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- Created `app/services/analysis/` package for Company Analysis page financial models (DCF, Scorecard, Valuation Multiples, Technical Indicators, Options Analytics). All functions are pure, testable, and use `decimal.Decimal` for monetary precision per team decision. 48 tests passing in `tests/test_analysis.py`.
- Existing codebase uses Pydantic `BaseModel` for input/output schemas and plain functions or static methods on service classes — followed this pattern for the analysis modules.
- numpy is available and used for Bollinger Bands std-dev; scipy available but not needed for current indicators.
- Technical indicators (EMA, RSI, MACD, Bollinger) operate on plain `List[float]` to keep them decoupled from pandas/yfinance — the API layer can convert as needed.
