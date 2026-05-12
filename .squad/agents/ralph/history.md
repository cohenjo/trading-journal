# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Ralph (Work Monitor)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.

## 2026-05-12 — Options Income Estimation Sprint (Issues #428–#432)

**Dispatched by:** Jony Vesterman Cohen
**Sprint:** options-income-extrapolation (5-issue tree authored by Keaton)

### Dispatch Log

| Issue | Agent | PR | Status |
|-------|-------|----|--------|
| #428 feat(options): compute options-income estimation series | McManus | #433 | ✅ PR open, ready for review |
| #429 feat(options): create /options/estimations page | Fenster | #436 | ✅ PR open |
| #430 feat(summary): wire options-income into /summary | Fenster | #435 | ✅ PR open |
| #431 feat(plan): add options-income to financial plan | Fenster | #434 | ✅ PR open |
| #432 test(options): regression coverage | Redfoot | #437 | ✅ PR open |

### Sequencing
- Phase 1: #428 (McManus) completed first — foundational server action
- Phase 2: #429, #430, #431 (Fenster × 3) fanned out in parallel after #428 branch stable
- Phase 3: #432 (Redfoot) dispatched after all Fenster PRs open

### Key Decision Applied
Default `optionsGrowthRate` changed from **5% → 2%** per user spec (Jony). Communicated to McManus; implemented in `SettingsContext.tsx`. Pre-existing setting remains user-configurable.

### Pending (Keaton/user action required)
- All 5 PRs await Keaton review and merge
- PRs #433 and #437 show `unstable` CI state — check Actions for flaky tests
- Note: EMU restriction required using REST API (`gh api --method POST`) instead of `gh pr create` for all PR creation

---

## 2026-05-11 — Live-URL Validation Gate (LURVG) Rule Established

Process gap identified: McManus-v5 reported GREEN on Sprint B, but production URL showed only 1 tab (NULL household_id issue). Root cause: no agent validated actual deployed UI state — only code/tests. Established sacred rule: "If you didn't load the URL the user will load, you didn't validate." Codified as LURVG with 4 closure criteria: tests pass, build succeeds, live-URL validation by separate agent, evidence (screenshot/DOM) in issue comment. Banked in `.squad/skills/validation-gates/SKILL.md`.

---

2026-05-12: Orchestrated options-estimation sprint. Dispatched McManus first (root), then 3 Fensters in parallel, then Redfoot after. All 5 PRs landed in 28 minutes wall-clock.
