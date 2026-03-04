# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Redfoot (Tester)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- Frontend test infra established: vitest + jsdom + React Testing Library. Config at `apps/frontend/vitest.config.ts`, setup at `src/test/setup.ts`. Run with `npm test` in `apps/frontend/`.
- `lightweight-charts` mock covers createChart, all series types (line, candlestick, histogram, area), timeScale, priceScale. Located in `src/test/setup.ts` — extend when new chart patterns are added.
- `next/navigation` mock covers useRouter, usePathname, useSearchParams. Sufficient for all current components.
- OptionChainSnapshot requires null-safety testing: API can return null Greeks. Tests confirm the component handles this gracefully with dash fallbacks.
- SplitBrainToggle uses `aria-pressed` for accessibility — tests verify this. Keep accessibility testing as a pattern for all toggle/tab components.
- AnalyzePage child views (LongTermView, ShortTermView) should be mocked in page-level tests to isolate routing/toggle logic from data-fetching concerns.
- PR #15 opened as draft for issue #4 (branch: `squad/4-frontend-test-infra`).
