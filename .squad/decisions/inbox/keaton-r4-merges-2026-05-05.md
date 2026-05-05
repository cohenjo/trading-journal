# Keaton R4 — squad PR merges — 2026-05-05

## Merged

- **#277** (`test(e2e): wave-2 CRUD coverage — partial #176`, Redfoot): FK cleanup order verified correct (`bond_holdings` + `insurance_policies` added to `cleanupHouseholdData` Promise.all batch — children before `deleteE2eUser`). Selectors use accessibility-based `getByRole`/`getByLabel`. No leaked creds (Gitleaks clean). `test.fixme` for `/pension` PDF CRUD intentional — FastAPI pension parser unavailable in E2E env. All CI green. #176 stays open per Redfoot's scoping.
- **#279** (`feat(options): harden STK assignment pairing using IBKR notes/codes`, McManus): Rebased onto main — conflict was in `test_flex_parser.py` between Hockney's phase-0 test (#276, already on main) and McManus's 7 new pairing tests. Resolved by keeping both blocks. Algorithm reviewed: `order_id` tier uses correct `ibOrderID`/`orderID` field names; ambiguous reject uses `len(notes_confirmed)==1` guard (correct); heuristic fallback unchanged (backward compat). 93 options tests pass post-rebase. All CI green.

## Issues closed

- **#265** (auto-closed by #279 merge): "Harden assignment STK pairing using IBKR notes/codes"

## Still pending

- **#275** (`ci(migrations): auto-apply Supabase migrations`, Kujan) — `needs-changes` from Keaton R3 review: shell-injection risk in `${{ github.event.pull_request.head.sha }}` without sanitisation. Awaiting Kujan fix.
- **#176** — partial E2E wave-2 CRUD scope (per Redfoot's scoping: `/summary`, `/pension` full CRUD, `/cash-flow` full CRUD deferred pending FastAPI integration).
