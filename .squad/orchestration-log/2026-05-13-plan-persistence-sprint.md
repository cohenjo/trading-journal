# Sprint: Plan Persistence + Cashflow

**Date:** 2026-05-13
**Issues:** #440 (P0), #441 (P1)
**Final commit:** 215fb8b
**Vercel:** green
**Worker redeploy:** not needed

## Trigger
User report: `/plan` page does not persist salary/expense changes; `/cash-flow` renders empty. Hypothesis: #441 downstream of #440.

## Rounds

### Round 1 — Reconnaissance (4 parallel agents)
- Keaton (opus-4.6): triaged → issues #440 + #441 created
- Fenster (sonnet-4.6): frontend recon — found optimistic UI swallowing `{ok: false}`
- Hockney (sonnet-4.6): backend recon — **found root cause** (audit columns NOT NULL without defaults, migration silent-skip footgun)
- McManus (sonnet-4.6): authored 22 anticipatory test scenarios

### Round 2 — Implementation + synthesis (4 parallel agents)
- Keaton (opus-4.6): 6 architectural decisions; PR sequence A→B→C→D approved; Decision 1 = virtual items
- Hockney (sonnet-4.6): PR #442 — `ALTER COLUMN SET DEFAULT now()` ×2 + trigger to `BEFORE INSERT OR UPDATE`
- Fenster P0 (sonnet-4.6): PR #443 — rollback + sonner toast + cash-flow empty state CTA
- McManus (sonnet-4.6): PR #444 (draft) — 32 test cases (18 Playwright + 14 vitest), 2 fixmes

### Round 3 — Income wiring (Fenster P1)
- Fenster (sonnet-4.6): PR #445 — bonds + dividends + options merged into `simulation.ts`, 3 locked virtual rows in `PlanEditor`

### Round 4 — Merge (Kujan)
- #442 (clean) → #443 (clean) → #445 (rebase ×1) → #444 (rebase ×1 + un-fixme A6/B6)
- Final HEAD `215fb8b`

## Skills produced
- `.squad/skills/migration-idempotency-gotchas/SKILL.md` — `ADD COLUMN IF NOT EXISTS ... DEFAULT` silent-skip
- `.squad/skills/optimistic-ui-error-surfacing/SKILL.md` — rollback + toast on `{ok: false}`
- `.squad/skills/anticipatory-test-authoring/SKILL.md` — scenario authoring from bug report

## Open follow-ups (Fenster questions)
- FX on bond income_series — bonds currently summed in native currency without conversion; ILS bond holders may see miscounted plan years
- Dividend constant vs growth — current implementation uses flat forward annual total; should it apply `dividendGrowthRate` from settings?

## Currency contract
Round 8 ÷100 contract honored — no frontend re-conversion.
