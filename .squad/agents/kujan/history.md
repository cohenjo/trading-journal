# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application
- **Agent:** Kujan (DevOps/Platform)
- **Created:** 2026-02-23T22:46:19Z

## Summary

DevOps/Platform engineer. Owns Supabase infrastructure, Docker/Aspire setup, CI/CD pipelines, pre-commit hooks, secret scanning hardening, E2E CI configuration, and deployment runbooks.

---

## 2026-05-11 — ✅ Nightly Backup Triage: #344–#349 (pg_dump v17 mismatch + issue-spam dedupe)

**Scope:** Root-cause the 6× backup failure issues filed 2026-05-09 and harden the workflow.

**Root cause:** Commit `870a253` (2026-05-05) added the PGDG APT repo but kept installing `postgresql-client-15`. Supabase runs PostgreSQL 17; `PG_DUMP` pointed to `/usr/lib/postgresql/17/bin/pg_dump` which wasn't installed, causing every nightly run to fail immediately. An operator manually triggered the workflow 6 times while investigating, and the `alert-on-failure` job had no deduplication guard, producing 6 identical `priority:critical` issues (#344–#349).

**Executed:**
- ✅ Confirmed root cause via log analysis (run 25609713276 shows `postgresql-client-15` install attempt with v17 binary path)
- ✅ pg_dump fix already applied (commits `04d3558`, `fa6b75c`, `1e9e011`) — backup verified working at run [25654224589](https://github.com/cohenjo/trading-journal/actions/runs/25654224589) (`2026-05-11T06:35:26Z`)
- ✅ Added deduplication to `alert-on-failure` job: closes prior open `🚨 Nightly backup FAILED` issues as "superseded" before opening a single fresh issue
- ✅ Filed decisions inbox: `kujan-backup-triage-2026-05-11.md`
- ✅ Closed issues #344–#349 with root-cause comment

**PR:** `squad/backup-triage-344-349` — `chore(infra): backup workflow hardening + dedupe (#344-#349)`

---

## 2026-05-10 — ✅ Flex Pipeline v2: Applied Migrations + Rebuilt Worker (Image 82fe82a9)

**Scope:** Infrastructure work to apply Flex v2 schema migrations and deploy updated worker for live Flex sync.

**Executed:**

**Migrations Applied (05:00–05:15 UTC):**
- ✅ 20260510000100: Extend stock_positions flex fields (8 new columns: listing_exchange, cusip, isin, figi, security_id, security_id_type, accrued_interest, cost_basis_total)
- ✅ 20260510000200: Flex bond_holdings snapshot (Flex identifier cols + nullable coupon/issue_date)
- ✅ 20260510000300: Dividend payments table (UNIQUE constraint on account_id + source_transaction_id)
- ✅ 20260510000400: Dividend accruals table (asset_category + fx_rate_to_base columns)
- ✅ 20260510000500: Security reference table (con_id as PK, 12 identifier/meta columns)
- ✅ 20260510000600: Bond holdings add listing_exchange (hotfix, applied 01:15 UTC after Phase E backfill)

**Worker Rebuild:**
- Old image SHA: 9fe849fe7779ab6db8a1d6c2e8ae33e1caaae1f6e94df32763f5eef5a2eec67d
- New image SHA: 82fe82a954d26f9e665b6eb398a1ec3a1bf63afa34f935190eb23690b82d320e
- Container status: ✅ Healthy
- APScheduler: ✅ 10 jobs registered and scheduler started

**Fresh Flex Sync Attempt:**
- Status: ❌ Failed after 8 retries (2562s elapsed)
- Error: IBKR Flex API error 1001 — "Statement could not be generated at this time."
- Duration: ~43 minutes (exponential backoff on retry)
- **Cause:** Manual syncs running back-to-back triggered IBKR API throttle.
- **Workarounds:** (1) Re-save Flex query in Account Management to reset throttle counter, (2) wait ~30 minutes before retry.
- **Impact:** No data synced; stock_positions snapshot remains dated 2026-05-01 pending retry or cooldown.

**Schema Verification (Post-Migration):**
- stock_positions: 270 rows (flex), 8 new identifier columns all present and nullable
- bond_holdings: 0 rows (pre-backfill); schema ready with Flex fields
- dividend_payments: 0 rows (pre-backfill); UNIQUE constraint applied
- dividend_accruals: 0 rows (pre-backfill); composite index created
- security_reference: 0 rows (pre-backfill); con_id PK created with symbol/cusip/isin indexes

**Handoff:**
Infrastructure ready (migrations applied, worker rebuilt and healthy, new schema verified). Data import pending: IBKR Flex API throttle must clear before sync can succeed. Hockney's Phase 3 backfill (commit eacd8d4) populated all 4 new tables with 5,524 + 217 + 75 + 18 rows. McManus can revalidate end-to-end once throttle clears and next sync completes.

---

## 2026-05-10 — ✅ Fresh XML Backfill Phases A-E + New Master XML

**Scope:** Executed 5-phase XML backfill using the new May 10 master XML (`reports/activity/OptionsIncomeDashboard_Master-10-may.xml`, 374 lines, 216 KB, period=LastBusinessWeek 2026-05-04→2026-05-08).

**Executed via temporary swap of Master.xml (restored after backfill):**

| Phase | Operation | Result |
|-------|-----------|--------|
| A | stock_positions: update identifier cols + cost_basis_total | 14 rows updated |
| B | dividend_payments: re-route from options_cash_events | 5,524 inserted |
| C | dividend_accruals: seed from master XML | 16 inserted |
| D | security_reference: seed from OpenPositions | 75 inserted |
| E | bond_holdings: seed BOND rows | 18 inserted |

**Final DB counts post-backfill:** stock_positions 270 (5 snapshots, max 2026-05-01), bond_holdings 18 (1 snapshot, max 2026-05-08), dividend_accruals 217, dividend_payments 5,524, security_reference 75.

**Gaps identified and handed off to Hockney:**
1. `NetStockPositionSummary` section has 57 rows in XML — no `net_stock_positions` table exists; rows silently dropped.
2. `issueDate` field confirmed empty (`""`) in every FII row even after new export — pending Jony portal config.
3. `underlyingSymbol` in SecurityInfo not captured.

**Live sync status:** Fresh sync triggered at 10:41 UTC+3; IBKR throttle (error 1001) may still be blocking. No confirmed fresh sync completion at time of handoff.

**Decisions filed:** `kujan-flex-fresh-data-2026-05-10.md` (processed by Scribe)

---

## 2026-05-11 — ✅ Nightly Backup Hardening: Issue Dedup (PR #370)

**Scope:** Add deduplication guard to the `alert-on-failure` job to prevent repeated backup failures from spamming multiple GitHub issues.

**Root cause:** pg_dump version mismatch (v15 installed, v17 binary path referenced) caused all nightly backups to fail from 2026-05-05 onward. On 2026-05-09, operator manually re-triggered the workflow 6 times while investigating. The `alert-on-failure` job created a new critical GitHub issue on each failure, producing 6 identical issues (#344–#349) in 31 minutes with no deduplication.

**Executed:**
- ✅ pg_dump fix already merged (commits `04d3558`, `fa6b75c`, `1e9e011`) — updated to `postgresql-client-17`, set explicit binary path
- ✅ Last successful backup: run [25654224589](https://github.com/cohenjo/trading-journal/actions/runs/25654224589) (2026-05-11T06:35:26Z)
- ✅ Deduplication logic added: `alert-on-failure` searches for open `🚨 Nightly backup FAILED` issues, closes any found as "superseded", then opens exactly one fresh issue
- ✅ Decisions folded into shared decisions.md (processed by Scribe)

**PR:** [#370](https://github.com/cohenjo/trading-journal/pull/370) — `chore(infra): backup workflow hardening + dedupe (#344-#349)`

**Outcome:** One open backup-failure issue at any given time; repeated manual re-triggers no longer spam issue tracker.
