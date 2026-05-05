# Triage decision — 2026-05-05

Board triage: 14 untriaged issues assigned to squad members per routing heuristics.

## Summary

| Issue | Assigned | Rationale |
|-------|----------|-----------|
| #267 | squad:redfoot | E2E nightly failure (2026-05-05) — entails test investigation |
| #265 | squad:mcmanus | Financial data domain — IBKR assignment pairing logic (A/Ex codes) |
| #245 | squad:hockney | Backend IBKR Flex Query integration + field mapping (Phase 0 research) |
| #232 | squad:redfoot | E2E nightly failure (2026-05-04) — duplicate detection recommended |
| #177 | squad:redfoot | E2E test domain — FastAPI endpoint migration tracking |
| #176 | squad:redfoot | E2E test domain — wave-2 CRUD coverage expansion |
| #173 | squad:fenster | Frontend Server Action migration — port plan_service.py logic to Next.js |
| #170 | squad:kujan | CI/DevOps — auto-apply Supabase migrations on main merge |
| #162 | squad:redfoot | E2E nightly failure (2026-05-03) — duplicate detection recommended |
| #127 | squad:redfoot | E2E test domain — auth fixture migration (auth-cookie.ts) |
| #126 | squad:kujan | DevOps/infra — env setup issue: DATABASE_URL default silently breaks Supabase |
| #99  | squad:keaton | Stale meta-tracker ("trading journal") — recommend closing or archiving |
| #67  | squad:kujan | DevOps/infra — hardcoded env values & API URL migration |
| #53  | squad:kujan | DevOps/platform — Supabase + Vercel free-tier verification |

## Notes

### E2E Nightly Failures (Dedup Opportunity)
Issues #267, #232, #162 are all nightly Playwright suite failures on consecutive days. Recommend Redfoot consolidate these into a single tracking issue or close the older ones as duplicates once root cause is identified.

### Domain Distribution
- **Redfoot (Testing):** 6 issues — E2E test failures, auth fixture migration, CRUD coverage
- **Kujan (DevOps):** 5 issues — CI/migrations, env/infra setup, free-tier verification
- **Others:** 3 issues split across McManus, Hockney, Fenster per technical domain

### Cross-Functional Note
- #245 (IBKR Flex) involves Hockney (backend) + McManus (math/reconciliation); primary route to Hockney, with note to loop McManus for field mapping validation.
- #173 (Server Action port) is frontend-primary (Fenster) but requires planning handoff from Hockney for plan_service.py logic port.

All 14 issues now have routing labels. Board is fully triaged.
