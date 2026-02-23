# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Fenster (Frontend Dev)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- **2026-02-23: Codebase review completed** - Frontend is a Next.js 15.3 app with React 19, TypeScript strict mode, and Tailwind CSS. Uses lightweight-charts for financial visualizations. Found 53 component files with extensive hooks usage (183 occurrences). Architecture follows Next.js App Router with route-based pages. No test files exist yet. Discovered significant TypeScript `any` usage (~20+ instances) that compromises type safety. No Decimal/BigNumber types found for financial calculations - using native numbers which risks precision errors. Currency conversion exists but uses hardcoded rates. Missing error boundaries, loading states inconsistent, and console.log statements scattered (39 instances). Chart integration is solid but lacks performance optimization (React.memo, virtualization). Overall: functional but needs type safety improvements, proper financial precision handling, test coverage, and production hardening.

## Team Updates

📌 **Team update (2026-02-23T22:59:59Z):** Financial Precision and Type Safety consolidated across frontend/backend - Critical action required to migrate from native numbers to Decimal/BigNumber types to prevent rounding errors in portfolio calculations. Quality gate established: all PRs must use Decimal for monetary operations. — Fenster, Hockney

📌 **Team update (2026-02-23T22:59:59Z):** Security Hardening consolidated - CRITICAL findings require immediate action: credentials exposed in git, no authentication layer, unrestricted CORS. Week 1: rotate credentials, implement JWT, restrict CORS, add security headers. Application not production-ready in current state. — Keaton, Hockney, Rabin

📌 **Team update (2026-02-23T22:59:59Z):** Testing and Quality Assurance - Frontend has zero test coverage; backend lacks financial calculation tests. GitHub Actions CI/CD needed. Recommendation: vitest + React Testing Library for frontend, pytest for backend with >85% coverage on financial logic. — Fenster, Hockney, Keaton
