# Decision: Migrate monetary float fields to Decimal

**Author:** McManus (Data/Finance)  
**Date:** 2025-07-25  
**Status:** Accepted  
**Issue:** #9

## Context

All monetary fields across the trading-journal backend were stored as Python `float`
(IEEE 754 double-precision). This introduces rounding errors in financial calculations
(e.g., `0.1 + 0.2 != 0.3`), which is unacceptable for a trading journal tracking
real P&L, commissions, and portfolio values.

## Decision

Migrate every monetary `float` field to `decimal.Decimal` in Python and
`Numeric(18, 6)` in PostgreSQL. This covers ~80+ fields across 9 schema files.

### Key design choices

| Choice | Rationale |
|--------|-----------|
| `Numeric(18,6)` precision | 18 digits total, 6 fractional — sufficient for equity/options prices and large portfolio values |
| `sa_column=Column(Numeric(18,6))` for table fields | SQLModel requires explicit SQLAlchemy column for Numeric mapping |
| Plain `Decimal` for Pydantic-only models | No database column needed; Pydantic validates the type |
| `ENCODERS_BY_TYPE[Decimal] = float` in FastAPI | Ensures JSON responses emit numbers, not strings — backward compatible with frontend |
| `DecimalSafeJSONResponse` as default | Belt-and-suspenders for any Decimal that bypasses `jsonable_encoder` |
| Manual Alembic migration | Autogenerate requires live DB; hand-written migration is safer and reviewable |

## Scope

- **Migrated:** All SQLModel table fields, Pydantic API models, and dataclass models
  with monetary semantics across models.py, trading_models.py, finance_models.py,
  dividend_models.py, plan_models.py, insurance_models.py, options_models.py,
  backtest_models.py, ladder_models.py
- **Not migrated:** `plan_service.py` and `plan_components.py` simulation engine
  (uses dict-based float arithmetic — separate refactor)
- **Intentionally kept as float:** `Ndx1mChartData.time` (Unix timestamp)

## Consequences

- Financial calculations gain exact decimal precision
- Frontend receives numbers (not strings) — no breaking change
- Alembic migration safely casts existing float data via `::numeric(18,6)`
- Test assertions updated to use `float()` wrapper for `pytest.approx` compatibility
