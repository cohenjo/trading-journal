# Hosting Free-Tier Baseline Facts

**Author:** Kujan (DevOps/Platform)
**Issue:** [#53 — TJ-000](https://github.com/cohenjo/trading-journal/issues/53)
**Date:** 2026-05-05
**Status:** Complete — Wave 1 pre-flight check before any hosting commit

---

## Purpose

This document verifies current free-tier limits for Supabase and Vercel against live
documentation, measures (or estimates) the existing local Postgres baseline size, and
surfaces blockers before the hosting migration begins.

All limits are taken from official pricing/docs pages fetched on **2026-05-05**.

---

## 1. Supabase Free Tier

### 1.1 Limits table

| Category | Free-Tier Limit | Current Usage (estimate) | Headroom | Notes / ⚠️ |
|---|---|---|---|---|
| **Database storage** | 500 MB per project | ~5–15 MB schema-only (see §3) | ~485–495 MB | Schema-only install; data grows when broker sync runs |
| **Monthly Active Users (MAU)** | 50,000 MAU | 2 users (Jony + spouse) | 49,998 | Well within limit for household scope |
| **Postgres direct connections** | 60 (nano compute, shared) | ~3–5 (backend worker + Server Actions) | ~55 | Use pooler (port 6543) for web traffic; direct only for Alembic |
| **Realtime concurrent connections** | 200 | 0 (not yet used) | 200 | Dashboard may add Realtime later |
| **Edge Function invocations** | 500,000 / month | 0 (none deployed yet) | 500,000 | Next.js Server Actions on Vercel; Supabase Edge Functions not planned for Phase 1 |
| **File storage** | 1 GB | 0 | 1 GB | No file storage used yet |
| **Storage bandwidth (egress)** | 5 GB / month | ~0 | 5 GB | |
| **Active projects (free account)** | 2 | 2 planned (dev + prod) | 0 free slots | **Fully consumed** — no room for a third project; local Docker fills the gap |
| **Automated daily backups** | 1-day retention (free tier) | N/A | N/A | ⚠️ See §5.1 |
| **Project auto-pause** | After 7 days inactivity | N/A | N/A | ⚠️ See §5.2 |
| **Compute tier** | Nano (0.5 vCPU shared, 256 MB RAM) | — | — | Sufficient for MVP; upgrade path is Micro at $10/mo |

> **Design.md discrepancy:** `docs/design-hosting/sections/04-deployment-cicd.md` listed
> "2 concurrent connections" for Supabase free. The correct figure for **direct Postgres
> connections** is **60** on the nano compute tier. The pooler (port 6543, transaction mode)
> accepts far more concurrent app connections. Always use the pooler URL for the backend
> worker and Server Actions; reserve direct-connect for Alembic migrations only.

**Sources:**
- Supabase Pricing: https://supabase.com/pricing (fetched 2026-05-05)
- Supabase Free Tier overview: https://supabase.com/docs/guides/platform/manage-your-usage (fetched 2026-05-05)
- Third-party limit summary: https://www.freetiers.com/directory/supabase (fetched 2026-05-05)

---

## 2. Vercel Hobby Tier

### 2.1 Limits table

| Category | Hobby Limit | Current Usage (estimate) | Headroom | Notes / ⚠️ |
|---|---|---|---|---|
| **Bandwidth (Fast Data Transfer)** | 100 GB / month | ~0.1–0.5 GB (dev traffic) | ~99.5–99.9 GB | Small household app; very safe |
| **Build execution time** | 6,000 min / month | ~5–20 min (current CI) | ~5,980 min | Per-commit builds; fine for daily dev cadence |
| **Concurrent builds** | 1 | 1 | 0 extra | Merges to main queue; PRs may wait |
| **Serverless function invocations** | 1,000,000 / month | ~100–1,000 (dev only) | ~999,000 | Server Actions count as serverless invocations |
| **Function CPU time** | 4 CPU-hrs / month | ~0.1 CPU-hr | ~3.9 CPU-hrs | Light CRUD; no heavy compute on Vercel |
| **Function duration (per invocation)** | 60 s max (Hobby) | <1 s per Server Action | — | ⚠️ Long-running aggregations must stay in local worker |
| **Edge function invocations** | 1,000,000 / month | ~100 (middleware) | ~999,900 | `middleware.ts` counts as Edge; very light |
| **Projects** | 200 | 1 planned | 199 | |
| **Preview deploys** | Unlimited per PR | — | — | Free, each PR gets a preview URL |
| **Custom domain** | Free (1 per project) | 0 | 1 | DNS cutover tracked in #79 |
| **Analytics events** | 50,000 / month | 0 | 50,000 | Optional; enable when needed |
| **Overage policy** | Hard cap — no overages | — | — | ⚠️ See §5.3 |
| **Commercial use** | **Not permitted** on Hobby | — | — | ⚠️ See §5.4 |

**Sources:**
- Vercel Hobby Plan: https://vercel.com/docs/plans/hobby (fetched 2026-05-05)
- Vercel Limits: https://vercel.com/docs/limits (fetched 2026-05-05)
- Vercel Pricing breakdown: https://flexprice.io/blog/vercel-pricing-breakdown (fetched 2026-05-05)

---

## 3. Local Postgres Baseline DB Size

### 3.1 Measurement status

**Local Docker stack was NOT running at audit time.** The `docker-compose.yml` Postgres
container (`trading_journal_db`) was confirmed stopped via `docker ps`. Size measurement
via `pg_database_size()` was therefore not possible.

### 3.2 Migration-file-based estimate

The Supabase migration chain comprises **43 SQL files** totalling **4,845 lines** across
the following schema areas:

| Schema | Tables created | Character of data |
|---|---|---|
| `public` | ~39 tables (execution, manualtrade, trade, positions, bonds, dividends, options_*, plans, insurance, pension, etc.) | Transactional — row size varies |
| `raw` | 4 tables (broker_statements, broker_trade_events, dividend_announcements, market_data_quotes) | Bulk ingest — can grow large once broker sync runs |
| `compute` | 3 tables (daily_pnl_intermediates, pnl_runs, position_snapshots) | Job intermediates — bounded by compute frequency |
| `cooked` | 3 tables (daily_performance, dashboard_summary, position_history) | Read models — small relative to raw |
| **Total** | **~49 tables** | |

**Estimated schema-only footprint:** 5–15 MB (empty tables + indexes + Postgres system
overhead). This is well within the 500 MB free-tier limit.

**Estimated data footprint after initial broker backfill (#65):** highly dependent on
historical IBKR Flex data volume. Typical single-account IBKR history for 3–5 years
at ~100 trades/year ≈ 500 rows in `execution` + `manualtrade`. At ~2 KB/row average
with all option legs and bar data: **estimated 50–150 MB post-backfill**, still well
within 500 MB.

**⚠️ Largest growth risk:** `raw.market_data_quotes` and `historicaloptionbar` — if daily
bars are synced for a large watchlist (100+ tickers × 252 bars/yr × 5 yr ≈ 126,000 rows
at ~200 B/row ≈ 25 MB/year). Monitor monthly; consider pruning policy after 2 years.

### 3.3 Per-table size order (predicted)

Based on schema analysis — largest tables expected post-backfill:

| Rank | Table | Expected size driver |
|---|---|---|
| 1 | `historicaloptionbar` | Daily OHLCV bars per contract |
| 2 | `raw.market_data_quotes` | Tick/bar cache from IB sync |
| 3 | `execution` | Fills from IBKR |
| 4 | `options_trades` + `options_legs` | Options chains |
| 5 | `options_income` | Aggregated per-cycle rows |
| 6 | `manualtrade` | Manual entries (bounded) |
| 7 | `matchedtrade` | Matched from executions |
| 8 | `raw.broker_statements` | Statement XML/JSON chunks |
| 9 | `dailybar` | Daily aggregates |
| 10 | `cooked.daily_performance` | Read model rows |

---

## 4. Headroom Analysis

### 4.1 When do we outgrow free tier?

| Platform | Limit | Estimated trigger | Action |
|---|---|---|---|
| **Supabase — Storage** | 500 MB | Year 3–5 with active market-data sync (optimistic); Year 1–2 if bar history is backfilled aggressively | Add pruning policy / retention TTL on `historicaloptionbar` and `raw.market_data_quotes`; or upgrade to Supabase Pro ($25/mo) |
| **Supabase — Projects** | 2 active | Already at limit with dev + prod | Keep local Docker as the third environment; never provision a third cloud project on free tier |
| **Supabase — Compute** | Nano (shared) | When backend worker runs high-frequency polling (<60 s interval) | Upgrade to Micro ($10/mo) before enabling sub-minute polling |
| **Vercel — Bandwidth** | 100 GB/mo | Never, for household scope (2–5 users) | No action needed |
| **Vercel — Invocations** | 1,000,000/mo | Never at household scale (even at 100 page loads/day with 10 Server Actions = 300k/mo) | No action needed |
| **Vercel — Build minutes** | 6,000 min/mo | At 20 PR merges/day × 5 min build = 3,000 min; safe even for active sprints | No action needed |
| **Vercel — Commercial use** | Prohibited on Hobby | As soon as the app has paying users | Upgrade to Pro ($20/user/mo) before any monetisation |

---

## 5. Risks and Blockers

### 5.1 ⚠️ Supabase backup retention (blocker-class for §65 backfill)

The free tier provides **only 1-day point-in-time recovery**. Pro adds 7-day PITR; Enterprise
adds 30-day. Before the data backfill (#65), Kujan must schedule a **manual `pg_dump` to
encrypted local archive** (already called for in design.md §6). Do not start backfill
without a verified off-platform backup.

### 5.2 ⚠️ Project auto-pause (operational risk)

Free projects pause after **7 consecutive days of inactivity**. A paused project will
reject all connections — the frontend and worker will be broken for Jony until he manually
unpauses via the Supabase dashboard. Mitigations:
- Set up a lightweight uptime ping (GitHub Actions cron, free tier: 2,000 min/mo) that
  hits the Supabase Health endpoint every 3 days.
- Document the unpause procedure in `docs/design-hosting/runbooks/`.
- Consider upgrading to Pro ($25/mo) once daily use begins — Pro projects never auto-pause.

### 5.3 ⚠️ Vercel hard caps (operational risk)

Vercel Hobby enforces hard limits with **no overage option**. If bandwidth or invocations
are exceeded mid-month, deploys are blocked until the monthly reset. Vercel Pro ($20/user/mo)
enables paid overages. For a 2-person household this is unlikely to trigger, but the risk
is zero-warning service interruption. Track usage in Vercel Analytics.

### 5.4 ⚠️ Vercel Hobby commercial-use prohibition

The Vercel Hobby plan **prohibits commercial use**. If trading-journal ever charges users
or is used in a business context, upgrade to Vercel Pro before launch. This is not a
current blocker for personal household use.

### 5.5 ⚠️ Supabase Realtime not enabled (future risk)

If the dashboard adds live data streaming (issue not yet filed), Supabase Realtime will be
needed. Free tier allows 200 concurrent connections but the Realtime service must be
explicitly enabled per-table. No current blocker.

---

## 6. Recommendations

| Priority | Recommendation | When |
|---|---|---|
| 🔴 **Before backfill (#65)** | Take a `pg_dump` encrypted backup of local Postgres before any cloud data migration | Before #65 merges |
| 🔴 **Before prod deploy (#79)** | Document unpause procedure in runbook; set up 3-day health-ping cron | Before #79 |
| 🟡 **Post-launch** | Enable Vercel Analytics to track bandwidth and invocation trends | Week 1 post-launch |
| 🟡 **Post-launch** | Add a Supabase dashboard alert on storage > 300 MB | Week 1 post-launch |
| 🟢 **Future** | Add TTL/pruning policy on `historicaloptionbar` and `raw.market_data_quotes` (keep N years) | When storage > 200 MB |
| 🟢 **Future** | Upgrade Supabase to Pro ($25/mo) when: (a) daily use is regular (avoids pause), (b) storage > 400 MB, or (c) PITR > 1 day is needed | Based on usage |
| 🟢 **Future** | Upgrade Vercel to Pro ($20/mo) when: (a) commercial use begins, (b) team > 1 developer, (c) need overage protection | Based on usage |

---

## 7. Confirmation

- [x] Current data (schema-only) **fits within** the 500 MB Supabase free-tier limit with ~485 MB headroom.
- [x] Post-backfill estimate (50–150 MB) **fits within** limit with ~350–450 MB headroom.
- [x] Vercel Hobby limits are not a concern at household scale (2–5 users).
- [x] Two active Supabase free projects (dev + prod) account is at its limit — local Docker is the required third environment.
- [x] Key pre-migration blocker identified: **manual backup before #65 backfill**.
- [x] Key operational blocker identified: **auto-pause mitigation before prod launch**.
