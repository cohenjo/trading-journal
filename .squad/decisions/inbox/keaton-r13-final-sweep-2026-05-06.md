**Date:** 2026-05-06
**Author:** Keaton (Squad Lead)
**Round:** R13 — final sweep before user check-in

## Context

Four R12 PRs queued for landing: #320 (Keaton decision drop), #321 (Hockney schema),
#322 (Fenster dashboard), #323 (Fenster decision drop). One legacy hold (#316).

## Actions taken

### #320 — `docs(squad): keaton r12 decision drop — PR sweep 2026-05-05`
- Scope: single file `.squad/decisions/inbox/keaton-r12-merges-2026-05-05.md` ✅
- **Merged** (squash, branch deleted).

### #321 — `feat(schema): R12 household_invites table + RLS + helper functions` (Hockney)
- CI: Dry-Run Migrations FAIL + Lint FAIL — two blocking issues in migration:
  1. RLS policy uses `auth.jwt() ->> 'email'` — not stubbed in shadow DB. Fix: use
     `(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')`.
  2. `gen_random_bytes(32)` requires `pgcrypto` extension not enabled in lint env.
     Fix: add `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at migration top.
- Schema design is sound (partial unique index, SECURITY DEFINER accept_invite, FOR UPDATE
  race guard, NOT VALID FK, audit-trail preserved via status FSM).
- **Held** — commented with exact fixes. Fast-merge once CI is green.

### #322 — `feat(dashboard): TJ-020 — Dashboard reads cooked tables` (Fenster)
- CI: E2E + Vercel build FAIL — `actions.ts` exports non-async items from `'use server'`.
  Offenders: 5 types/interfaces, 2 constants, 2 sync helpers (`computeFreshnessStatus`,
  `secondsSince`). Fix: split into `dashboard.types.ts` (no directive) + `actions.ts`
  (async-only). Logic and cooked-table read path are correct; staleness at 24 h matches
  issue default; refresh rate-limit guard present; all 4 freshness states covered in tests.
- **Held** — commented with exact split instructions. Fast-merge once CI is green.

### #323 — `docs(squad): Fenster R12 decision drop — dashboard cooked tables TJ-020`
- Scope LEAK: branch `squad/fenster-r12-decision-drop` was cut from `squad/73-dashboard-
  cooked-tables` rather than `main`; diff vs main includes all dashboard source files.
  Decision drop must be inbox-only.
- **Held** — commented: rebase/recreate from `main` with inbox file only; fix #322 first.

### #316 — Keaton R11 decision drop (legacy hold, scope leak)
- Still held. Touches `.squad/decisions.md` directly.
- Commented: move content to `.squad/decisions/inbox/keaton-r11-pr-sweep.md` and re-spin.

## Carry-forward

- Hockney: two-line migration fix → CI green → #321 fast-merge.
- Fenster: split `actions.ts` → CI green → #322 fast-merge, then re-spin #323 from main.
- Keaton (or next Scribe run): resolve #316 via inbox rebase.
