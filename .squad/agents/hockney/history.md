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

---

## 2026-05-27 — RSU Local Migration Attempt

**Task:** Run merged RSU Alembic migrations against local dev Postgres after PR #480.

**Learnings:**

- **Main synced to PR #480 merge commit `8c9a117`.** The head commit is `RSU automation: live price/yield, 25% dividend tax, payout to income pool (#480)`.
- **Migration chain is blocked before DB contact.** `f2a3b4c5d6e7_normalize_price_cache_yield_to_percent.py` is present and correctly uses `WHERE dividend_yield IS NOT NULL AND dividend_yield > 0 AND dividend_yield < 1`, but its `down_revision = "e5f6a7b8c9d0"` file is missing from `main`.
- **No rows were converted.** Per safety rules, I stopped before `uv run alembic current` / `upgrade` because the Alembic revision chain is broken. Final DB head is therefore unverified, and pre/post backfill counts were not collected.
- **Invocation pattern remains:** run from `apps/backend/` with `uv run alembic ...` once the missing `e5f6a7b8c9d0_add_dividend_yield_to_price_cache.py` migration is restored to `main`.
- **Gotcha:** unrelated local worktree changes were preserved in a stash named `pre-rsu-migration-sync-2026-05-27T23-37-09+03-00` so `main` could be fast-forwarded safely.
📌 Team update (2026-05-29T122212Z): Credit-Card Expense Analysis Pipeline architecture proposal completed by Keaton. Work items CC-1..CC-14 pending Jony sign-off on Section 8 blockers. Your assignments coming imminently.

---

## 2026-06-06 — CC-4 Categorization Engine

**Task:** Implement 3-tier categorization engine resolving `category_id + subcategory_id` for each parsed CC transaction. Unblock Redfoot's 10 Section 2 test stubs (C-1 through C-10) in `test_plan_scaffold.py`.

**Learnings:**

- **Resolution order deviates from task spec (user mapping beats YAML rule).** The spec said Tier 1 → Tier 2 (rules) → Tier 3 (mappings). But Redfoot's C-4 explicitly requires user mappings to win over YAML rules. Correct order: transfer pre-check → issuer sector → user-confirmed DB mappings (`source='user'`) → YAML rules → inferred DB mappings → unresolved.

- **Hebrew RTL extraction gotcha (critical for sector dict and rule patterns).** pdfplumber extracts Hebrew PDF characters in visual left-to-right order. Each Hebrew word has characters reversed: `ביטוח` (insurance) → extracted as `חוטיב`. The `_SECTOR_TO_SLUG` dict keys and YAML patterns must be written in the **extracted (reversed)** form.

- **Sector lookup is substring-based, not exact.** `sector_raw` may be multi-word (e.g., `'ניפו חוטיב'`). Lookup iterates `_SECTOR_TO_SLUG` checking `sector_key.lower() in sector_raw.lower()`. Shorter keys like `'חוטיב'` (insurance) match longer sector strings containing that word.

- **`_pick_best_match`: subcategory rules must beat parent rules on equal weight.** The sort key `(-weight, slug_key)` with `slug_key = "category/subcategory"` causes parent rule `"transfers/"` to beat subcategory rule `"transfers/transfers-paybox"` alphabetically (slash < letter). Fix: add a middle sort term `0 if has_subcategory else 1` so subcategory (more specific) wins on weight tie. This was a silent bug — C-5 PAYBOX test failed with `subcategory_id=None` until fixed.

- **SQLModel `Optional[List]` (bare, no type arg) has no SQLAlchemy type mapping.** `parse_warnings: Optional[List]` in `expenses.py` raises `TypeError: Could not resolve type 'List'`. Must be `sa_column=Column(JSON, nullable=True)`. Lesson: always pass a concrete type arg to `List` when SQLModel needs to infer the column type, or use an explicit `sa_column`.

- **SQLModel `Field(nullable=False, sa_column=Column(...))` raises RuntimeError.** `nullable=` in `Field()` conflicts with `sa_column=`. The `nullable` constraint must live only inside `Column()`. Remove it from `Field()` entirely.

- **`gen_random_uuid()` is PostgreSQL-only — SQLite tests need explicit `id=uuid4()`.** The `MerchantCategoryMapping` schema uses `server_default=text("gen_random_uuid()")` for its PK. SQLite in-memory tests must provide an explicit `id` when inserting, otherwise the INSERT fails with `unknown function: gen_random_uuid()`.

- **Module-level category cache (`_CATEGORY_SLUG_CACHE`).** Tests MUST call `_invalidate_category_cache()` before seeding the in-memory DB — and again in fixture teardown. The `seeded_session` fixture handles both. Without teardown invalidation, stale UUIDs from a prior test's engine leak into the next test.

- **Conftest `from __future__ import annotations` must be at file top.** Placing it mid-file inside a section block causes `SyntaxError`. When extending an existing test file that already has `from __future__ import annotations`, don't add it again.

- **`tests/__init__.py` breaks existing tests that `from conftest import ...`.** Adding `tests/__init__.py` to enable `tests.credit_card_pipeline.helpers` imports changes how pytest resolves `conftest` as a module. Existing files using `from conftest import TEST_HOUSEHOLD_ID` stop working. Solution: use relative imports (`from .helpers import ...`) inside the package's own conftest, and define helper classes inline in test files rather than cross-importing.

- **YAML default weight is 0.5, not 1.0.** The task CC-4 description said "default 1.0" but McManus's YAML header comment says `Default = 0.5`. Used 0.5 as `_DEFAULT_RULE_WEIGHT`.

- **`entertainment` category does NOT exist in McManus's YAML.** Redfoot's C-2 expected `category.slug == 'entertainment'` for NETFLIX. McManus put Netflix under `utilities-streaming` (subcategory of `utilities`). Tests must expect `utilities` + `utilities-streaming`.

- **`resolution_source='issuer_sector'` (not `'sector'`).** Matches both decisions.md and Redfoot's test plan C-1.

- **Rabin §5.2 audit requirement.** `match_count += 1` and `last_used_at = datetime.utcnow()` must be set every time a Tier-3 mapping is applied. The DB commit happens inside `_query_mapping()`.

**Files changed:**
- `apps/backend/app/services/expenses/categorize.py` (new — full 3-tier engine)
- `apps/backend/app/services/expenses/__init__.py` (re-exports CategoryResolver, CategoryAssignment)
- `apps/backend/app/schema/expenses.py` (fix parse_warnings JSON column, remove nullable conflict)
- `apps/backend/tests/credit_card_pipeline/test_plan_scaffold.py` (Section 2: 10 skips → passing tests)
- `apps/backend/tests/credit_card_pipeline/conftest.py` (new — seeded_session fixture)
- `apps/backend/tests/credit_card_pipeline/helpers.py` (new — _SyntheticTxn, seed_expense_categories)
- `apps/backend/tests/conftest.py` (import expenses schema to register tables in SQLModel.metadata)

**Commit:** `bf899da` on `squad/credit-cards`

---

## 2026-06-01 — CC-2: Credit-Card PDF Parsers

**Task:** Implement 4 PDF parsers (Cal, CalPayBox, Max, Isracard) using pdfplumber;
base classes, fingerprint detector, dispatcher; all Rabin security conditions.

**Learnings:**

- **pdfplumber extracts Hebrew in VISUAL (character-reversed) order.** Do NOT
  reverse or re-order Hebrew codepoints. Store `merchant_raw` and `sector_raw`
  verbatim. The category engine's sector lookup works on visual-order strings.
  Reversing them will silently break category resolution.

- **Cal column order is LTR extracted:** `charge_ils | txn_amount | card_shown | [installment] | sector | merchant | date`.
  The installment marker `N - מ M םולשת` has total FIRST (N), num SECOND (M)
  in visual order — opposite of logical reading order.

- **Fixture trap: `_CAL_FIXTURES["fx_row"]` = `04-26-2.pdf` is CalPayBox, not Cal FX.**
  Real Cal FX row is in `05-26.pdf`. `_CAL_FIXTURES["installment"]` = `05-26-3.pdf`
  has no installment rows — use `01-26.pdf` or `02-26.pdf` instead.

- **Max date artefact**: pdfplumber occasionally yields 3-digit year `05/04/267`.
  Fix: take first 2 digits of year field → `26` → `2026`. Pattern: `DD/MM/YY[Y]`.

- **Max date–merchant concatenation**: date is often directly appended to merchant
  with no space separator: `UPAPP05/04/267`. Use `_DATE_RE = re.compile(r'(\d{2}/\d{2}/\d{2,3})$')`.

- **Isracard split-letter artefact**: pdfplumber inserts a space after the first letter
  of all-caps Latin words in the foreign section: `E UROPAPARK` → fix with
  `_fix_split_latin_merchant()` using `re.sub(r'(?<![A-Z])([A-Z]) ([A-Z])', r'\1\2', s)`
  applied twice.

- **Isracard refund FX rows omit the commission column.** Normal FX rows have
  `charge | 0.00 | rate | ...`; refund rows have `charge | rate | ...` (no commission).
  Detect by checking if charge is negative.

- **SIGALRM timeout works on macOS/Linux but NOT on Windows.** If porting to Windows,
  replace with a threading.Timer approach.

- **pdfplumber==0.11.9 pin**: changes to pyproject.toml pin require Docker image
  rebuild when CC-5 worker ships. Flag in PR.

- **Sector/merchant split strategy**: sort known sector tokens by descending length
  and use `str.find()` not regex — more reliable for Hebrew substring matching
  since re anchoring interacts poorly with bidirectional text.

**Files changed:**
- `apps/backend/app/services/expenses/parsers/__init__.py` (new)
- `apps/backend/app/services/expenses/parsers/base.py` (new)
- `apps/backend/app/services/expenses/parsers/fingerprint.py` (new)
- `apps/backend/app/services/expenses/parsers/cal.py` (new)
- `apps/backend/app/services/expenses/parsers/cal_paybox.py` (new)
- `apps/backend/app/services/expenses/parsers/max.py` (new)
- `apps/backend/app/services/expenses/parsers/isracard.py` (new)
- `apps/backend/app/services/expenses/parsers/dispatcher.py` (new)
- `apps/backend/tests/credit_card_pipeline/test_cc2_parsers.py` (new — 19 tests)
- `apps/backend/pyproject.toml` (pin pdfplumber==0.11.9)
- `apps/backend/uv.lock` (regenerated)

**PR:** https://github.com/cohenjo/trading-journal/pull/483
