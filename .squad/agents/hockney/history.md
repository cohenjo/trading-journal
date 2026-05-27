## 2026-05-27 — RSU Pricing Pipeline

**Task:** End-to-end RSU pricing pipeline: nightly price + dividend_yield cached for MSFT/WIX, exposed via API, hydrated into plan/snapshot JSON blobs.

**Learnings:**

- **`price_cache` and `stock_positions` are two separate caches.** `yahoo_refresh` writes to `stock_positions` (trading positions). `price_cache` is the plan/snapshot layer. The RSU pipeline lives entirely in the `price_cache` layer — never touch `yahoo_refresh`.

- **`dividend_yield` unit convention matters.** `price_cache` stores as decimal fraction (0.0087 = 0.87%). `plan_components.AccountManager.load_accounts` reads `account_settings.dividend_yield` and uses it via `acc['value'] * (yield_rate / 100.0)`, meaning it treats the stored value as a **percentage** (0.87 for 0.87%). For `price_cache`-sourced values this means we store the raw decimal fraction from Yahoo and the plan engine must interpret it correctly. Review `plan_components.py` line 278 carefully before any yield unit changes.

- **RSU business rules are hard-coded, not configurable.** Dividend tax rate is fixed at 25% and `dividend_policy` must always be `"Payout"`. The hydration worker writes these unconditionally — they cannot be overridden by the plan's global `incomeTaxRate`. Enforced in `_apply_rsu_hydration()`.

- **FastAPI router prefix must not be doubled.** The finances router self-declares `prefix="/api/finances"` in the router definition. Test code using `TestClient` must include the router **without** an additional prefix, then hit `/api/finances/price-data/...`.

- **`ticker.info` is slow but necessary for yield.** `fast_info` is the fast Yahoo path for price. `ticker.info` is the full metadata dict needed for `trailingAnnualDividendYield`. We fetch info only in `fetch_external_price` (the scheduled nightly path), not in hot-path request handling.

- **WIX pays no dividend — must handle gracefully.** `trailingAnnualDividendYield` returns `None` for WIX. The hydration worker stores `Decimal("0")` in that case so the plan engine gets a clean zero rather than a null.

**Files changed:**
- `apps/backend/alembic/versions/e5f6a7b8c9d0_add_dividend_yield_to_price_cache.py` (new migration)
- `apps/backend/app/services/price_cache.py` (PriceQuote + fetch + upsert + lookup_cached_price_data)
- `apps/backend/app/api/finances.py` (new GET /price-data/{symbol} endpoint)
- `apps/backend/app/worker/rsu_plan_hydration.py` (new hydration worker)
- `apps/backend/app/worker/runtime.py` (register new worker)
- `apps/backend/tests/test_rsu_plan_hydration.py` (new tests)
- `apps/backend/tests/test_price_cache_worker.py` (updated upsert params assertion)

**Decisions:** `.squad/decisions/inbox/hockney-rsu-pricing.md`

---

## 2026-05-27 — RSU Yield Units Fix

**Task:** Normalize `dividend_yield` to percentage form at the yfinance boundary — fixes 100× calculation error in `plan_components.py`.

**Learnings:**

- **Chosen convention: percentage form (0.87 = 0.87%).** `plan_components.py` line 427 computes `acc['value'] * (yield_rate / 100.0)`, treating the stored value as percentage. The UI `<input>` in `PlanAccountDetails.tsx` also shows percentage with a "%" label. Storing decimal fraction (0.0087) caused projections to be 100× too small.

- **Normalization boundary: `_yfinance_yield_to_percent()` in `price_cache.py`.** yfinance's `trailingAnnualDividendYield` returns decimal fraction (0.0087). The helper multiplies by 100 before any DB write. `dividendYield` occasionally returns percentage integers (10.43) — the helper detects values > 1 and passes them through unchanged.

- **`yahoo_refresh.py` / `stock_positions` use decimal fraction — do NOT change.** That is a different table with its own downstream consumers. The convention unification applies only to `price_cache.dividend_yield` and `account_settings.dividend_yield` in plan/snapshot JSON.

- **Data migration is idempotent.** Migration `f2a3b4c5d6e7` multiplies only rows where `0 < dividend_yield < 1`. Re-running is safe — already-migrated rows (>= 1) are untouched.

**Files changed:**
- `apps/backend/app/services/price_cache.py` (add `_yfinance_yield_to_percent`, update `fetch_external_price`, update `PriceQuote` docstring)
- `apps/backend/app/api/finances.py` (update docstring)
- `apps/backend/app/worker/rsu_plan_hydration.py` (update docstring)
- `apps/backend/alembic/versions/f2a3b4c5d6e7_normalize_price_cache_yield_to_percent.py` (new data migration)
- `apps/backend/tests/test_price_cache_worker.py` (add `_yfinance_yield_to_percent` + `fetch_external_price` tests)
- `apps/backend/tests/test_rsu_plan_hydration.py` (update all 0.0087 → 0.87 fixtures)

**Decisions:** `.squad/decisions/inbox/hockney-rsu-yield-units.md`

---

## 2026-05-19 — Flex Query Worker Diagnostic

**Task:** Read-only diagnostic of IBKR Flex Query worker for Jony's 5 questions.

**Learnings:**

- **Two completely separate sync paths, two separate "last synced" fields.** The Accounts page reads `trading_account_config.last_synced` (written only by live IB Gateway path). The Options page reads `options_flex_sync_state.last_sync_at` (written by Flex XML path). These are decoupled — one can be stale while the other is fresh. The Accounts page will ALWAYS show "Never" while IB Gateway is offline, regardless of Flex health.

- **Orphaned E2E test rows in production are silent P0s.** An E2E test account config (`E2E_TRADING_*`) was left in `trading_account_config` with a `household_id` that no longer exists in `households`. `_load_accounts()` has no join guard against orphaned households. This caused 7 consecutive silent nightly failures (May 13–19) before being discovered. Always clean up E2E test data in teardown, and add a join guard in `_load_accounts()`.

- **APScheduler logs errors but raises no alerts.** 7 nights of P0 failures, zero team notification. The nightly-backup workflow has a GitHub-issue alert pattern we should copy for the Flex sync. Log monitoring ≠ alerting.

- **Flex API fetch succeeds even when DB write fails.** IBKR Flex token and query IDs are valid and the live API responds correctly each night. The failure is entirely in the local DB write step. So the Flex integration with IBKR itself is healthy — only our DB has the orphaned row problem.

- **`IBKR_FLEX_TOKEN` absent from `docker-compose.backend.yml` env block.** It's passed via `.env` auto-read. New developers missing this will get synthetic data silently. Should be documented in `.env.example` and optionally validated at worker startup.

- **Container started May 13 per `docker ps` output.** The `docker ps` "X days ago" field is a reliable way to date the current container's birth. Cross-reference with `git log` to identify what code the container is running.

**Report:** `.squad/decisions/inbox/hockney-flex-query-diagnosis-2026-05-19.md`
**Bugs found:** 2 bugs (P0 FK violation, P1 misleading "Never"), 2 smells (no alerting, missing env doc)

---


📌 Team update (2026-05-19): Strict-lockout 5-round P0 fix protocol shipped Flex sync fixes in ~2.5h (diagnostic → implement → parallel review → merge → deploy). 88 orphan trading_account_config rows discovered; cascade gap suggests future audit needed. IB Gateway is desktop app, not Docker-managed. Decided by Scribe during cross-agent orchestration.
📌 2026-05-19: PR #462 (env-doc) merged a57d4c8; PR #463 backend shipped (migration, endpoint, worker poll, throttle, 10+2 tests, blocker fixed) merged 34d83d7 (641 passing)

---

📌 **Team update (2026-05-27)**: RSU automation batch completed. All 5 agents collaborated on price_cache extension (backend), engine tax/policy enforcement (frontend), and UI configuration. 46 acceptance tests pass. Branch: squad/rsu-ui-wiring. Decisions merged to .squad/decisions.md. Next: yield-units normalization follow-up pending from Hockney.
