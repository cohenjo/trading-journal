# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Kujan (DevOps/Platform)
- **Created:** 2026-02-23T22:46:19Z

## Core Context Summary (Feb-Apr 2026)

**Initial Environment Audit:**
- `.gitignore` already covered `.env`, `node_modules/`, `.venv/`, `trading-journal-data/`, `reports/`, `.DS_Store`, IDE dirs
- Added missing entries for `.aspire/`, `.next/`, `.copilot/`
- `.copilot/mcp-config.json` contains MCP server configs with API key env var refs — must stay gitignored
- `.aspire/settings.json` is local Aspire dev settings — gitignored
- Aspire SDK packages bumped to 13.1.2

**Q1 Decisions:**
- Financial Precision & Type Safety (Feb 23)
- Security Hardening (Feb 23)
- Testing & QA planning (Feb 23)
- API Documentation & DevOps planning (Feb 23)

**Testing Infrastructure Sprint (Apr 10):**
- **CI Pipeline (squad-ci.yml):** Frontend job (npm ci → lint → tsc → vitest), Backend job (uv sync → ruff → mypy → pytest + PostgreSQL service), Docker build validation, Playwright E2E tests
- **Pre-commit Hooks:** Trailing whitespace, end-of-file-fixer, check-yaml, ruff (Python), reject-env-files, detect-private-key, no-commit-to-branch (main)
- **Docker Health Checks:** PostgreSQL pg_isready, Backend curl /health, Frontend curl http://localhost:3000, proper depends_on with service_healthy conditions
- **Dependabot Configuration:** npm updates (weekly Monday 9 AM, max 5 PRs), Python updates (weekly), docker images (weekly)
- **4 commits, production-grade pipeline deployed**

**Key Infrastructure Decisions:**
- PostgreSQL service container for backend integration tests
- npm and pip caching for faster CI runs
- Playwright chromium tests for E2E validation

---

## Recent Learnings

📌 **Team update (2026-04-30T15:00:37Z):** Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.
