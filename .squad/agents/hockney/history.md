- Runtime dependency on PR #85 (auth.users table), not build-time

**Branch:** `squad/70-backend-jwt-validation`
**PR:** Closes #70

## Learnings

### 2026-05-01: Backend Endpoint Disposition Audit (TJ-006)

**Context:** Phase 3 migration requires classifying every backend endpoint as MOVE (Supabase direct), KEEP (heavy/batch), or DEPRECATE (replaced by Supabase Auth or obsolete).

**Audit results:**
- **67 total endpoints** across 19 routers
- **32 MOVE** — simple CRUD on single tables with household scoping
- **28 KEEP** — heavy compute (backtests, projections, AI analysis), third-party APIs (yfinance, IBKR), multi-table joins with complex business logic
- **7 DEPRECATE** — auth.py (replaced by Supabase Auth), options.py (XLSX storage deprecated), trading.py config endpoints (should use env vars/vault)

**Cross-cutting concerns identified:**
1. **Household ID injection:** 14 routers use `get_user_household_id(session, user_id)` pattern. MOVE candidates need RLS policies + Server Action household context. Medium-High migration complexity.
2. **Mixed routers:** 5 routers (analyze, dividends, finances, ndx, trading) have both MOVE + KEEP endpoints. Requires careful frontend routing to split calls during migration.
3. **JSON field mutations:** pension and dividend_accounts endpoints mutate `finance_snapshot.data` JSONB field. PostgREST supports JSONB operators but adds complexity.

**Disposition criteria refined:**
- **MOVE:** Single-table CRUD, simple queries, no external API, no multi-step transactions beyond RLS+triggers.
- **KEEP:** Backtests, projections, AI analysis (Copilot SDK), third-party API calls (yfinance, IBKR), CPU/memory-intensive work, multi-table joins with aggregation.
- **DEPRECATE:** Replaced by Supabase Auth, obsolete storage patterns (XLSX), config that should be env vars.

**Migration phasing:**
- **Phase 3A (1-2 weeks):** 20 low-hanging fruit endpoints (holdings, insurance, plans CRUD, summary, simple finances/dividends CRUD)
- **Phase 3B (1 week):** 5 partial migration endpoints (dividend_accounts list/create, backtest GET /years)
- **Phase 3C (2-3 weeks, defer):** 5 complex candidates (trades POST with summary recalc, day multi-table join, pension reports)
- **Phase 4 (ongoing):** 28 heavy/batch endpoints stay in FastAPI as local Docker worker

**Key insight:** Frontend-backend HTTP coupling is symptom of incomplete Phase 3. After MOVE migration, `NEXT_PUBLIC_API_URL` should only route to heavy compute endpoints (analyze, backtest, pension upload, plans simulate, trading sync). No round-trip for CRUD — frontend talks to Supabase directly via RLS.

**Deliverable:** `docs/design-hosting/endpoint-disposition.md` — full audit with per-router tables, complexity ratings, and migration recommendations.

---

📌 **Migration dry-run fix (2026-05-02):** Backfill section of `supabase/migrations/20260502120000_auto_provision_household_on_signup.sql` was referencing `auth.users.raw_user_meta_data` (Supabase-hosted column only), causing shadow DB CI dry-run to fail. Simplified backfill CTE to use only standard columns: `coalesce(u.email, 'My Household')`. Trigger function keeps full `raw_user_meta_data` fallback chain since it fires on real auth.users in production. Lesson: shadow DB does not expose `auth.users.raw_user_meta_data`; backfill migrations must use only standard Postgres columns (id, email, etc.).

📌 Team update (2026-05-02T09:03:04Z): Household provisioning (PR #142) — trigger chain caveat. trg_households_add_creator (existing) already inserts household_members owner row; don't re-insert in upstream `handle_new_user_household()` or backfill (causes constraint violations). Document trigger ownership: each trigger owns one side effect, never duplicate. — Coordinator

## 2026-05-03: Household Bootstrap RPC + View + Backfill Landed — PR #164

**Deliverables from 2026-05-03 morning:** Migration `20260503090000_household_bootstrap_rpc.sql` added `account_type` column, `ensure_household(p_account_type)` RPC (SECURITY DEFINER, idempotent), and `v_my_active_household` view (SECURITY INVOKER). Backfill ran cleanly (0 rows affected — all users already had households post-trigger).

**Merge:** PR #164 rebased on #165 (E2E fixes), CI green, merged (commit 0ab20ec). First in the household bootstrap merge stack.

**Operational Blocker:** Stale Vercel env vars post key-rotation remain Jony's responsibility; backend contract is solid.
