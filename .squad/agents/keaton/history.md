# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Keaton (Lead)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.

### 2026-02-23T23:45:00Z: Codebase Review Completed
**Context:** Comprehensive review of trading journal application structure, architecture, and implementation quality.

**Architecture Findings:**
- **Stack:** Next.js 15.3 (React 19, TypeScript 5) frontend + FastAPI (Python 3.10+, SQLAlchemy, SQLModel) backend
- **Database:** PostgreSQL 13 with Alembic migrations (10+ migration files detected)
- **Deployment:** Dual orchestration support (Docker Compose + Aspire 13.1)
- **Observability:** Full OpenTelemetry instrumentation with Prometheus, Jaeger, Grafana
- **Trading Integration:** Interactive Brokers Gateway integration (optional, opt-in via `RUN_IB_GATEWAY=true`)

**Code Quality Assessment:**
- **Frontend:** 78 TypeScript/TSX files, clean component structure, TypeScript strict mode enabled
- **Backend:** 82 Python files, well-organized API routes (18 routers), strong schema separation (11 model files)
- **Testing:** Good coverage - 13 Playwright E2E tests (frontend), 10+ pytest tests (backend), includes performance benchmarks
- **Technical Debt:** Minimal - only 3 TODOs found (loan balance, debt tracking, backtest parameters)
- **Dependencies:** Modern stack - uv for Python, lightweight-charts for visualization, GitHub Copilot SDK integrated

**Architecture Strengths:**
- Clean separation of concerns (schema, API, services, utils)
- Proper CORS, OpenTelemetry instrumentation from the start
- Dual deployment strategy (Docker + Aspire) provides flexibility
- IB Gateway isolation pattern (disabled by default, opt-in when needed)
- Test coverage includes both functional and performance validation

**Risk Areas:**
- **Security:** `.env` files present in both apps (VERIFY they're in .gitignore - confirmed ✓)
- **CORS:** Currently `allow_origins=["*"]` - should restrict in production
- **Database:** Hardcoded credentials in docker-compose.yml (acceptable for dev, needs env vars for prod)
- **Financial Calculations:** No explicit Decimal type usage verified in sample code review - needs deeper audit

**Domain Coverage:**
The application supports comprehensive trading workflows:
- Options trading tracking and P&L analysis
- Bond cashflow calculations
- Dividend tracking and estimations
- Tax optimization (tax-condor strategy)
- Portfolio holdings and ladder strategies
- Financial planning and pension calculations
- Backtesting engine
- Real-time market data integration (via IB Gateway)

**Gaps Identified:**
1. No explicit security hardening documentation (CSP, rate limiting, auth implementation status unclear)
2. No CI/CD workflows for testing/deployment (only Squad-related workflows found)
3. Financial calculation precision not verified (Decimal vs float usage needs audit)
4. Production deployment guide missing (docker-compose has hardcoded secrets)
5. API documentation not found (consider adding OpenAPI/Swagger auto-generation)

**Recommendations:**
1. **Immediate:** Audit all monetary calculations for Decimal/BigNumber usage (financial accuracy critical)
2. **Security:** Implement rate limiting, restrict CORS origins, add CSP headers, document auth strategy
3. **DevOps:** Add CI/CD workflows (lint, test, build validation on PR)
4. **Documentation:** Generate OpenAPI docs from FastAPI, create production deployment guide
5. **Monitoring:** Validate OpenTelemetry dashboards exist and alert thresholds configured

## Team Updates

📌 **Team update (2026-02-23T22:59:59Z):** Financial Precision and Type Safety - Frontend and backend both use unsafe numeric types. Critical quality gate: all PRs must use Decimal/BigNumber for monetary calculations. Breaking change requiring 1-2 weeks implementation and database migration. — Fenster, Hockney

📌 **Team update (2026-02-23T22:59:59Z):** Security Hardening CRITICAL - Credentials exposed in version control, zero authentication across all 17 API endpoints, unrestricted CORS. Week 1 actions: rotate credentials, implement JWT, restrict CORS, add security headers. Blocks production deployment. — Keaton, Hockney, Rabin

📌 **Team update (2026-02-23T22:59:59Z):** API Documentation and DevOps - No OpenAPI documentation, missing CI/CD workflows, no security architecture documentation. Add FastAPI OpenAPI generation, create GitHub Actions workflows for lint/test/build, document production hardening checklist. — Keaton

### 2025-07-18: Company Analysis Page Architecture Decision
**Context:** Jony requested a "Split-Brain" Company Analysis page with Long-Term (business owner) and Short-Term (income mechanic) views, covering fundamentals, charting, DCF, options Greeks, and AI synthesis.

**Decision:** Architected full page at `/analyze` route with 5 backend API endpoints (`/api/analyze/fundamentals`, `/price-history`, `/technicals`, `/options`, `/synthesis`), 17 frontend components across longterm/shortterm view folders, and a 4-phase delivery plan (Foundation → Long-Term → Short-Term → Polish). All financial calculations server-side in a new `analyze_service.py`. yfinance covers all data needs — no new deps required. AI synthesis starts as template-based (Phase 1) with Copilot SDK integration planned for Phase 2.

**Key routing insight:** Existing TRADING-section pages (`/options`, `/ladder`, `/holdings`) use top-level paths despite being in the TRADING nav group — so `/analyze` follows established convention rather than nesting under `/trading/`.

**Decomposition:** 17 tasks across 4 phases, parallelizable at each phase. Hockney (API), McManus (financial math), Fenster (UI) can all start Phase 1 simultaneously. Plan written to `.squad/decisions/inbox/keaton-analyze-page-architecture.md`.

### 2026-03-04: v0.0.1 Project Board Created
**Context:** Set up release tracking using GitHub milestone + labeled issues (gh project command requires unauthorized scope).

**What was created:**
- **14 labels:** 5 stage labels (backlog→done workflow), 3 priority levels (critical/high/medium), 5 domain labels (frontend/backend/security/testing/infra), plus `squad` label
- **Milestone:** v0.0.1 — "First release — core trading journal with analysis page, pension tracking, and financial planning"
- **13 issues** across 3 priority tiers:
  - **Critical (3):** #1 API authentication, #2 credential cleanup from git history, #3 CORS restriction — all security, all block release
  - **High (5):** #4 frontend tests, #5 backend financial calc tests, #6 analysis page polish, #7 yfinance caching, #8 CI/CD pipeline
  - **Medium (5):** #9 Decimal migration, #10 security headers, #11 Growth Story AI Phase 2, #12 OpenAPI docs, #13 pension history browser

**Routing:** Each issue tagged with owner (Rabin=auth/security, Kujan=infra/cleanup, Hockney=backend/CORS, Redfoot=testing, Fenster=frontend, McManus=data, Kobayashi=AI).

**Board URL:** https://github.com/cohenjo/trading-journal/milestone/1

**Learning:** `gh project` requires project scope not available in our token. Milestone + labels gives us equivalent workflow columns (stage:backlog → stage:done) with native GitHub filtering. Filter by `milestone:v0.0.1 label:priority:critical` to see release blockers.
