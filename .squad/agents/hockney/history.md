# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Hockney (Backend Dev)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.

### 2026-02-23: Initial Backend Codebase Review

**Findings:**

1. **Critical: Float usage for financial calculations** - All monetary fields (pnl, price, proceeds, taxes, commission) use Python `float` instead of `Decimal`. This violates financial precision requirements and can cause rounding errors in P&L calculations.

2. **Missing input validation** - API endpoints lack Pydantic request/response models. Direct SQLModel use without validation layer increases risk of bad data entering the system.

3. **Insufficient error handling** - Only 5 HTTPException/raise statements found across main API files. Need comprehensive error boundaries for database failures, calculation errors, and invalid state transitions.

4. **Security exposure** - `.env` file contains plaintext credentials (TWS_USERID, TWS_PASSWORD) and is tracked. Should be in `.gitignore` and use secret management.

5. **CORS wide open** - `allow_origins=["*"]` in production is a security risk for financial data APIs.

6. **Limited test coverage** - Only 10 test files found. Critical financial calculation logic (trade PnL, daily summaries, portfolio metrics) needs comprehensive unit tests with known expected values.

7. **Database table creation disabled** - `create_db_and_tables()` is a no-op. Relying solely on Alembic migrations is correct but startup code is misleading.

8. **Logging inconsistency** - Only 12 files use proper logging. Need structured logging across all API routes and service layers for audit trail.

**Positive aspects:**
- Good migration history with 19 Alembic versions showing iterative schema evolution
- Proper OpenTelemetry instrumentation setup for observability
- SQLModel/SQLAlchemy patterns are generally sound
- Service layer separation exists (data_ingestion, dividend_service, etc.)

**Immediate recommendations:**
1. Replace all `float` with `Decimal` for monetary fields
2. Add Pydantic validation schemas for all endpoints
3. Implement comprehensive error handling strategy
4. Remove `.env` from tracking, add to `.gitignore`
5. Restrict CORS to known frontend origins
6. Add test coverage for all financial calculations

## Team Updates

📌 **Team update (2026-02-23T22:59:59Z):** Financial Precision and Type Safety consolidated - Critical: both frontend and backend use unsafe numeric types. Quality gate established: all PRs must use Decimal/BigNumber for monetary operations. Estimated 1-2 weeks for migration. — Fenster, Hockney

📌 **Team update (2026-02-23T22:59:59Z):** Security Hardening consolidated - CRITICAL findings: credentials in git, no auth, unrestricted CORS. Week 1: rotate credentials, JWT auth, restrict CORS, security headers. Application blocked from production in current state. — Keaton, Hockney, Rabin

📌 **Team update (2026-02-23T22:59:59Z):** Testing and Quality - Backend lacks comprehensive financial calculation tests. Need pytest suite with known test cases for trade PnL, daily summaries, portfolio metrics. GitHub Actions CI/CD pipeline required. — Fenster, Hockney, Keaton
