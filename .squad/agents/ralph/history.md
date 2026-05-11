# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Ralph (Work Monitor)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.

## 2026-05-11 — Live-URL Validation Gate (LURVG) Rule Established

Process gap identified: McManus-v5 reported GREEN on Sprint B, but production URL showed only 1 tab (NULL household_id issue). Root cause: no agent validated actual deployed UI state — only code/tests. Established sacred rule: "If you didn't load the URL the user will load, you didn't validate." Codified as LURVG with 4 closure criteria: tests pass, build succeeds, live-URL validation by separate agent, evidence (screenshot/DOM) in issue comment. Banked in `.squad/skills/validation-gates/SKILL.md`.
