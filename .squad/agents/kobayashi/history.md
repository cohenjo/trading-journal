# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Kobayashi (AI Agent Engineer)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- Built Growth Story Agent + Copilot SDK service (2026-07-24). The existing `copilot_analyzer.py` pattern — streaming deltas via `session.on()` + `send_and_wait` + JSON stripping — is the proven SDK integration pattern for this project. Replicated it in `growth_story.py`. The agent uses `claude-opus-4.6` for deep analytical reasoning and web search. POST endpoint at `/api/analyze/growth-story/{ticker}` with 3-min timeout and proper 502/504 error mapping.
