# Hosting-migration epic sequencing
_Drafted by Keaton, Round 8, 2026-05-05_

## Codebase ground-truth (pre-dispatch audit)

Before sequencing, I verified the live state so waves are calibrated to real work remaining:

| Area | Finding |
|------|---------|
| Supabase schema | **Complete** — 43 migrations through `20260504181442`. Households, RLS helpers, raw/compute/cooked tables, sharing RLS policies all landed. |
| `household_id` RLS pattern | Active across all tables via `public.is_household_member()` / `is_household_owner()` helpers. |
| Google OAuth scaffolding | **Substantially built** — `auth/callback/route.ts`, `middleware.ts` guarding `/auth/`, `supabase.auth.getUser()` called in ~20 Server Actions. The `/signin` page UI and cookie hardening may be the remaining delta for #69. Recommend auditing #69 acceptance criteria before dispatch — it may be S not M. |
| Compute worker (`apps/backend/`) | **Zero code** — no `compute_runs`, `cooked_*`, or worker scaffolding in backend. #64 is real L-sized work. |
| Household invites | **Not started** — no `household_invites` table in migrations, no backend code. #74 owner must add migration. |
| Env vars | SUPABASE_URL + ANON_KEY present in `.env.local`; Docker compose and CORS vars still need #67 for completeness. |
| Legacy auth (passlib / python-jose) | Still live in `apps/backend/app/auth/security.py`. #81 is real work with rollback risk. |

---

## Wave 1 — Foundation (no dependencies, dispatch immediately)

| Issue | Title (TJ-#) | Owner | Size | Risk | Blocks |
|-------|-------------|-------|------|------|--------|
| #53 | TJ-000 — Verify Supabase + Vercel free-tier facts | Kujan | S | low | #65 (size gate for backfill decisions) |
| #67 | TJ-014 — Migrate hardcoded env values to env vars | Kujan | S | low | #63, #69 (env completeness for CRUD + OAuth) |

**Rationale:** #53 is a read-only doc task; its output gates the backfill risk assessment in #65. #67 is a mechanical env-var sweep; it's cheap and unlocks two Wave 2 branches. Both are parallelisable and have zero production blast radius.

---

## Wave 2 — Data plane + Auth foundation (after Wave 1 lands)

| Issue | Title (TJ-#) | Owner | Size | Risk | Blocked-by | Blocks |
|-------|-------------|-------|------|------|------------|--------|
| #63 | TJ-010 — Wire manual trade entry to Supabase schema | Hockney | M | med | #67 | #78 (preview gate needs real CRUD) |
| #64 | TJ-011 — Implement compute worker raw→compute→cooked | McManus | L | med | schema ✓ (migrations done) | #73, #80 |
| #65 | TJ-012 — Backfill local Postgres → Supabase | McManus | M | **high** | #53 (size verified) | #79 |
| #69 | TJ-016 — Google OAuth sign-in flow (CRITICAL) | Fenster | M* | **high** | #67 | #73, #74, #76, #77, #78 |

\* #69 may be S — see audit note above. Fenster should diff acceptance criteria against existing `auth/callback/route.ts` before estimating.

**Parallelisable:** All four can be dispatched simultaneously once Wave 1 PRs merge.

**#65 special handling:** Backfill is largely irreversible. McManus must produce a pre-migration snapshot and validate financial totals (Σ positions, Σ P&L) match before marking done. Consider gating merge on owner sign-off.

---

## Wave 3 — Integration layer (after Wave 2 lands)

| Issue | Title (TJ-#) | Owner | Size | Risk | Blocked-by | Blocks |
|-------|-------------|-------|------|------|------------|--------|
| #73 | TJ-020 — Dashboard reads cooked tables + staleness | Fenster | M | low | #64 + #69 | — (UX only) |
| #74 | TJ-021 — Household invite flow (send/accept/revoke) | Fenster + Hockney | M | med | #69 | #76 |
| #77 | TJ-024 — Audit trail for household lifecycle | Hockney | S | low | #69 | #76 |
| #78 | TJ-025 — Validate preview deploys E2E (CRITICAL) | Kujan | M | med | #63 + #69 + #67 | #79 |
| #80 | TJ-027 — Worker Docker healthcheck + retry | Kujan | S | low | #64 | #82 |

**Parallelisable:** All five can start simultaneously once Wave 2 lands. #73 and #80 are purely additive; #74 and #77 are new schema+backend; #78 is infra validation with no prod exposure.

**#74 note:** Hockney must add `household_invites` migration — the table does not yet exist in `supabase/migrations/`. Migration filename: `20260505XXXXXX_household_invites.sql`. Fenster owns the UI layer; co-ordinate on the shape of the invite token endpoint.

---

## Wave 4 — Pre-production gate (sequential within wave: #76 must pass before #79 is triggered)

| Issue | Title (TJ-#) | Owner | Size | Risk | Blocked-by | Blocks |
|-------|-------------|-------|------|------|------------|--------|
| #76 | TJ-023 — Playwright E2E: auth, invite, sharing | Redfoot | L | low | #69 + #74 + #77 | #79 (E2E gate) |
| #79 | TJ-026 — Production deploy + DNS + data migration (CRITICAL) | Kujan | L | **high** | #78 (preview validated) + #76 (E2E green) + #65 (data ready) | #81, #82 |

**Dispatch rule:** Ralph dispatches #76 first. #79 is dispatched **only after #76 CI run is green**. This is the single mandatory sequential gate before production.

**#79 special handling:** Highest blast radius in the entire epic. Kujan must coordinate with owner (Jony) before triggering production DNS cutover. Rollback plan must be documented in the PR description before merge.

---

## Wave 5 — Cutover hardening (strictly sequential, each blocks the next)

```
#81 → #82 → #83
```

| Issue | Title (TJ-#) | Owner | Size | Risk | Blocked-by | Blocks |
|-------|-------------|-------|------|------|------------|--------|
| #81 | TJ-028 — Disable legacy auth, freeze CRUD routes, update CORS | Hockney | S | **high** | #79 (prod live) | #82 |
| #82 | TJ-029 — Post-cutover monitoring, nightly cron, alerting | Kujan | M | low | #79 + #80 + #81 | #83 |
| #83 | TJ-030 — Post-cutover review + decommission local stack | Keaton | S | low | #82 (monitoring confirmed healthy) | — |

**Cannot parallelise.** Freezing routes (#81) before confirming prod is stable risks a total auth blackout. Monitoring (#82) must be live before declaring success. Decommission (#83) is the epic completion gate — Keaton signs off, triggering the Scribe retrospective.

---

## Full dependency graph (summary)

```
#53 ──────────────────────────────────► #65
#67 ──┬───────────────────────────────► #63 ──────────────────────────────────► #78
      └───────────────────────────────► #69 ──┬──► #73
                                              ├──► #74 ──► #76 ──► #79 ──► #81 ──► #82 ──► #83
                                              ├──► #77 ──► #76
                                              └──► #78 ──► #79
#64 ──────────────────────────────────► #73
#64 ──────────────────────────────────► #80 ──────────────────────────────────► #82
#65 ──────────────────────────────────────────────────────────────────────────► #79
```

---

## Risks & open questions

### 🔴 High risks
1. **#65 (data backfill) is irreversible.** A bad backfill with wrong household assignment corrupts Jony's financial history. Mitigation: require `pg_dump` snapshot of local Postgres before any writes; validate Σ totals post-backfill; gate merge on owner sign-off.
2. **#69 (OAuth) blast radius.** Cookie misconfiguration (missing `HttpOnly`, `Secure`, `SameSite`) leaks sessions. The scaffolding in `auth/callback/route.ts` looks correct but Rabin should review the final PR for cookie flags and CSRF exposure.
3. **#79 (prod deploy) is the point of no return.** DNS cutover, production data migration, no easy rollback. Kujan must have a tested rollback runbook before dispatch.
4. **#81 (freeze legacy auth) may break integrations.** If any client still calls legacy JWT-minted endpoints at cutover time, freeze will immediately 410 them. Hockney must audit all active callers before merging.

### 🟡 Medium risks
5. **#69 scope audit needed.** Auth scaffolding is substantially done. Before dispatch, Fenster should spend 15 minutes diffing the current code against the issue's acceptance criteria. If >70% is done, file a sub-issue for the remaining delta (e.g., just the `/signin` UI page) rather than re-doing work in a new branch.
6. **#74 `household_invites` migration.** The table is not in migrations. If Fenster starts the UI before Hockney lands the migration, the feature will be broken in CI. Recommend Hockney's migration PR merge before Fenster opens the frontend PR.
7. **#64 (worker framework) is 100% greenfield.** The `apps/backend/` directory has zero compute worker code. L-sized estimate may be optimistic if compute job semantics are under-specified.

### 🟢 Open questions for Ralph
- **DNS/custom domain (in #79):** Is a custom domain decided? If still TBD, Kujan can skip DNS steps and note as a follow-up, keeping the prod deploy unblocked.
- **Preview Supabase project:** Does a separate Supabase dev/preview project already exist, or does Kujan need to provision one? This affects Wave 3 (#78) effort estimate.
- **Worker Docker target:** Is the worker expected to run locally (Docker Desktop) or in a VPS/cloud runner? #80 and #82 scope differ significantly.

---

## Recommendation for Ralph

**Dispatch Wave 1 immediately** (#53 and #67 — both Kujan, parallel, low risk, ~1–2 hours each). They're blockers for nearly everything.

**Dispatch Wave 2 as a batch** once Wave 1 PRs merge (~same round). Four agents can run in parallel: Hockney on #63, McManus on #64 + #65 (sequential within McManus's queue — #64 first, then #65 once #53 is in), Fenster on #69. Note #65 requires owner sign-off before merge.

**Wave 3 after Wave 2** — five issues, all additive, manageable in one round.

**Wave 4 is the critical gate.** Redfoot on #76 first; Kujan holds on #79 until E2E is green. Do not rush this gate.

**Wave 5 is post-cutover hardening** — sequential, user-supervised, Keaton signs off on #83 as epic completion.

> Total: **5 waves, 16 issues, ~3–4 squad rounds** assuming normal velocity. Wave 5 cadence depends on prod stability — could be same round as Wave 4 or deferred by a day.
