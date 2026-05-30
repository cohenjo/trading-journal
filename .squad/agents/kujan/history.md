## Summary

DevOps/Platform engineer. Owns Supabase infrastructure, Docker/Aspire setup, CI/CD pipelines, pre-commit hooks, secret scanning hardening, E2E CI configuration, and deployment runbooks.

---

## Learnings

### 2026-05-30: P1 Hardcoded Migration Allowlist Bug — CI Silently Skipped New Migrations

**Root cause:** `.github/workflows/supabase-migrations.yml`'s db-url fallback path had a hardcoded 2-migration array (`expense_migrations`). The `apply_expense_pipeline_directly()` function only applied these two specific migrations, silently skipping ANY new migration added to `supabase/migrations/`.

McManus's PR #489 added `20260530055800_add_transportation_category.sql`. The workflow ran "successfully" in 21s, reported `✅ Migrations applied successfully`, but the log showed `expense_categories rows: 35` (should be 39 after Transportation). The Transportation migration was never applied because it wasn't in the hardcoded allowlist.

**Fix:** Replaced `apply_expense_pipeline_directly()` with `apply_pending_migrations_directly()` that dynamically discovers all local `*.sql` files in `supabase/migrations/`, queries prod `supabase_migrations.schema_migrations` for applied versions, and applies any pending migrations via `psql -v ON_ERROR_STOP=1 -f migrations/{file}`.

**Workflow run `26679731909`** (2026-05-30T08:54) applied 5 pending migrations including Transportation. Final verification: **expense_categories rows: 39** ✅.

**Secondary fix:** Migration `20260512010000_enforce_dividend_yield_decimal.sql` wasn't idempotent — it tried to create a constraint that already existed in prod due to historical drift. Wrapped the `ALTER TABLE ADD CONSTRAINT` in a `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...') THEN ... END IF; END$$;` guard.

**Pattern:** CI migration fallbacks must be **dynamic, not hardcoded**. Hardcoded allowlists rot immediately and fail silently. Dynamic discovery (sorted local files vs. prod history) is the only safe pattern for fallback migration paths.

---

### 2026-05-29: CC-11 Worker Rebuild Verification — v1 (Pre-Fix)

**✅ Rebuild successful — new job registered & running.**

- Image rebuild (Phase C): **27 seconds** (very fast — uv dependency resolve is efficient)
- Phase D healthcheck: **25 seconds** to healthy status
- Image SHA change: `f6a00f73e972` → `d2e918be8d60` ✅
- `pdfplumber==0.11.9` installed cleanly (CC-2 back-dependency)
- New job `expenses_inbox_scan` confirmed running on 60s interval with proper APScheduler registration
- Volume mount gap (v1): `/app/reports/credit-card/inbox` not mounted in compose — flagged as TODO

**Smoke test blocked (pre-existing code issue):**
- PDF detected (`scanned=1`) but parser failed with "signal only works in main thread" error
- Root cause: Hockney's 30s SIGALRM timeout in `dispatch_pdf()` can't run in APScheduler thread pool context
- This is a CC-5 follow-up issue (timeout refactor needed), not a build problem
- Rebuild itself is clean ✅

**Build observations:**
- Deprecation warning: `tool.uv.dev-dependencies` → migrate to `dependency-groups.dev` in pyproject.toml
- Stock refresh verification passed: 745/777 refreshed, 17 skipped, 15 failed (all expected delisted tickers)

### 2026-05-29: CC-11 Worker Rebuild Verification — v2 (Post-Fix) ✅ READY FOR CC-14

**Hockney's two fixes validated end-to-end.**

- **Commit 12aeb4b** (SIGALRM → ThreadPoolExecutor timeout): ✅ **PDF parsing succeeded** — no more main-thread signal errors
- **Commit 462afc9** (volume mount + env vars): ✅ **Mount live, subdirs created with 0700 perms**
- Image SHA change: `d2e918be8d60` → `50e763bad0a1` ✅
- Smoke test: `scanned=1 completed=1 deduped=0 errored=0` ✅
- Database ingestion: 1 statement + 3 transactions created ✅

**Friction encountered + resolved:**
- Env vars (CREDIT_CARD_INBOX_DIR/ENABLED) not auto-wired in docker-compose
- Fix: Added to `docker-compose.backend.yml` environment block + root `.env`
- Lesson: ENV sourcing is automatic but vars must be explicitly declared in compose YAML

**Key observations:**
- Volume mount working RW; PDF successfully processed inbox→processed
- Worker honors dedup (file_hash unique constraint) + handles errors cleanly
- Household resolution auto-detected (3964 households, used first by id; TODO: add CREDIT_CARD_DEFAULT_HOUSEHOLD_ID env var)
- No new blocking issues

**Verdict:** 🟢 Worker ready for CC-14 backfill. All blockers resolved. Rebuild process stable.

---

📌 Team update (2026-05-19): Strict-lockout 5-round P0 fix protocol shipped Flex sync fixes in ~2.5h (diagnostic → implement → parallel review → merge → deploy). 88 orphan trading_account_config rows discovered; cascade gap suggests future audit needed. IB Gateway is desktop app, not Docker-managed. Decided by Scribe during cross-agent orchestration.
📌 2026-05-19: Py3.12/distroless research completed (Option 4: conservative split chosen); clean worker rebuild (image f6a00f73e972, replaces docker-commit workaround); migration 20260519120000 applied via psql; follow-up PRs A+B queued
📌 Team update (2026-05-29T122212Z): Credit-Card Expense Analysis Pipeline architecture proposal completed by Keaton. Work items CC-1..CC-14 pending Jony sign-off on Section 8 blockers. Your assignments coming imminently.
📌 Team update (2026-05-30T14:00:00Z): Dynamic migration discovery pattern shipped in `.github/workflows/supabase-migrations.yml`. Replaced hardcoded `apply_expense_pipeline_directly()` with `apply_pending_migrations_directly()`. McManus's Housing taxonomy migration (20260530165734_add_housing_category.sql) is the first to flow through the new dynamic discovery path. Workflow run 26685706819 applied it successfully (39→47 expense_categories). Pattern: future CI migration fallbacks must be dynamic, not hardcoded allowlists. Hardcoded lists rot silently. — Kujan
