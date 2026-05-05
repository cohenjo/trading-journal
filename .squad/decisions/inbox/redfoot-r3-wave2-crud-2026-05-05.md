# Redfoot R3 — E2E wave-2 CRUD — 2026-05-05

## Features covered

- **`/holdings`** — full CRUD: create bond holding, verify persistence on reload, delete and verify disappears. DB table: `bond_holdings`.
- **`/insurance`** — full CRUD: create policy (provider required), edit provider, delete with confirm dialog. DB table: `insurance_policies`.
- **`/settings`** — persistence: planning mode toggle persists across localStorage reload; page-load smoke (no FastAPI dependency — uses localStorage).
- **`/cash-flow`** — smoke: page loads without 5xx, renders "Cash Flow Analysis" heading or loading state. Full CRUD deferred (depends on FastAPI simulation).
- **`/pension`** — smoke: loads without 5xx, renders page content. Full CRUD (PDF upload → report delete) deferred pending FastAPI pension parser in E2E env. `test.fixme` placeholder left for unblocking.
- **`/after-i-leave`** — smoke: loads without 5xx, renders table/section structure, no critical console errors.

## Cleanup additions

Tables added to `cleanupHouseholdData` in `e2e/fixtures/seed-data.ts`:
- `bond_holdings` — was missing; caused `deleteE2eUser` FK failures on nightly re-runs (addresses Keaton's R2 escalation about `/holdings` teardown)
- `insurance_policies` — was missing; same FK failure vector

## Out-of-scope (follow-up in #176)

- `/summary` CRUD — create/update summary items. `/summary` currently renders income projections from FastAPI + ladder data; no standalone DB write path found for "summary items" distinct from plan/finances. Needs Fenster/Hockney clarification on what "create/update summary items" means post-FastAPI migration.
- `/pension` full CRUD — PDF upload flow requires running FastAPI pension parser. `test.fixme` placeholder in `wave2-pages.spec.ts`.
- `/cash-flow` full CRUD — Sankey simulation requires FastAPI `/api/plans/simulate`. Deferred per issue #176 scope note.
- `/progress` — P3, not included this PR.
- `/trading/accounts` — P3, already covered by `flows/trading-accounts.spec.ts`.

## Files created/modified

- `e2e/flows/wave2-holdings.spec.ts` — new
- `e2e/flows/wave2-insurance.spec.ts` — new
- `e2e/flows/wave2-settings.spec.ts` — new
- `e2e/flows/wave2-pages.spec.ts` — new (cash-flow + pension + after-i-leave)
- `e2e/fixtures/seed-data.ts` — added `bond_holdings` and `insurance_policies` to `cleanupHouseholdData`

## PR
#277
