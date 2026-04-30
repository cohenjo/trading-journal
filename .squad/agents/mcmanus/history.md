# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Mcmanus (Data/Finance Dev)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

## 2026-04-30 — TJ-006: Schema layering and initial tables

**Requested by:** Jony Vesterman Cohen (Ralph YOLO mode)
**Work:** Created four migration files establishing the raw/compute/cooked schema namespaces and skeleton tables. Raw (4 tables): broker_trade_events, market_data_quotes, dividend_announcements, broker_statements. Compute (3 tables): pnl_runs, daily_pnl_intermediates, position_snapshots. Cooked (3 tables + 3 views): dashboard_summary, position_history, daily_performance, each with RLS and _live views for freshness.
**Finding:** PostgreSQL 15 rejects `now()` in `GENERATED ALWAYS AS STORED` columns (STABLE ≠ IMMUTABLE). Used companion `_live` views instead; documented trade-off in migration header.
**Finding:** `public.users` not yet in any migration — `raw.broker_statements.uploaded_by` references `auth.users(id)` directly until a future public.users migration lands.


**Requested by:** Jony Vesterman Cohen (YOLO mode)  
**Work:** Classified all 24 existing DB tables into household / owner-private / global-reference / system-infra buckets. Produced `docs/design-hosting/data/table-ownership.md` and decision draft.  
**Finding:** `trading_account_config` is the only split-ownership table — it mixes household metadata with owner-private broker secrets; must be resolved before TJ-005 RLS migration can proceed.  
**Finding:** `owner` string fields in `FinanceItem`, `PlanItem`, `InsurancePolicy`, `DividendPosition` are display-only — NOT auth boundaries; confirmed explicitly to prevent future RLS confusion.  
**Finding:** `backtesttrade` inherits visibility from `backtestrun` via JOIN, so it needs no direct `owner_user_id` FK.  

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- Created `app/services/analysis/` package for Company Analysis page financial models (DCF, Scorecard, Valuation Multiples, Technical Indicators, Options Analytics). All functions are pure, testable, and use `decimal.Decimal` for monetary precision per team decision. 48 tests passing in `tests/test_analysis.py`.
- Existing codebase uses Pydantic `BaseModel` for input/output schemas and plain functions or static methods on service classes — followed this pattern for the analysis modules.
- numpy is available and used for Bollinger Bands std-dev; scipy available but not needed for current indicators.
- Technical indicators (EMA, RSI, MACD, Bollinger) operate on plain `List[float]` to keep them decoupled from pandas/yfinance — the API layer can convert as needed.

## 2026-04-30 — Data architecture section for Supabase households

**Requested by:** Jony Vesterman Cohen  
**Work:** Drafted `docs/design-hosting/sections/06-data-architecture.md` and `docs/design-hosting/diagrams/06-data-model.excalidraw`.

**Summary:** Surveyed the existing SQLModel schema and documented that major finance/trading tables lack a real `user_id`/tenant FK today. Proposed Supabase `auth.users` mapping, `households`, `household_members`, per-table household/private/global scoping, a single-user backfill path, and raw/compute/cooked schemas for local-heavy jobs with UI-readable cooked tables.

**Decision draft:** `.squad/decisions/inbox/mcmanus-data-architecture.md`.

📌 Team update (2026-04-30T15:00:37Z): Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.
- 2026-04-30: Phase 1 foundation batch shipped — see .squad/log/2026-04-30T17-00-00Z-phase1-foundation-batch.md
