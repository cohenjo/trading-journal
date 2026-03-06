# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Kujan (DevOps/Platform)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- `.gitignore` already covered `.env`, `node_modules/`, `.venv/`, `trading-journal-data/`, `reports/`, `.DS_Store`, IDE dirs. Added missing entries for `.aspire/`, `.next/`, `.copilot/`.
- `.copilot/mcp-config.json` contains MCP server configs with API key env var refs — must stay gitignored.
- `.aspire/settings.json` is local Aspire dev settings — gitignored.
- `.next/` build output exists under `apps/frontend/` — gitignored.
- Aspire SDK packages bumped to 13.1.2 (from 13.1.0).
- Working tree cleanup: 3 commits (gitignore, feature code, Aspire bump), all pushed to origin/main.
