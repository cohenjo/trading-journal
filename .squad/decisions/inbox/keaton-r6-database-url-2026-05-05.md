# Keaton R6 — #282 review — 2026-05-05

## Merged
- **#282**: fail-loud DATABASE_URL/DIRECT_DATABASE_URL validation

## Issues closed
- **#126** (auto-closed by PR merge)

## Design rationale

**Approach: Sentinel value + startup validation + dev override**

1. **Sentinel constant** (`_DB_URL_NOT_CONFIGURED`): Allows safe module import for tests that override `get_session` with SQLite. Tests never need `DATABASE_URL`.

2. **Fail-loud at startup** via FastAPI lifespan: `validate_database_url()` raises `RuntimeError` with actionable error message if:
   - URL is sentinel (unset), OR
   - URL resolves to `localhost`/`127.0.0.1`/`0.0.0.0`/`not-configured` AND `APP_ENV` is NOT in `{local, development, dev, test}`

3. **Dev override**: Set `APP_ENV=development` (or `local`/`dev`/`test`) to allow localhost for local development without suppressing production safety.

4. **Documentation**: Updated `.env.example` files and README with:
   - Correct Supabase pooler format (transaction-mode)
   - Port 6543 (pooler) vs 5432 (direct)
   - **Critical gotcha:** `aws-1` region prefix, NOT `aws-0` (copy-paste error prone)
   - `sslmode=require` requirement
   - Step-by-step: Dashboard → Project Settings → Database → Connection string

## Test coverage

5 unit tests in `test_database_url_validation.py`:
1. `test_raises_when_not_configured`: Sentinel raises RuntimeError
2. `test_raises_on_localhost_in_production`: `localhost` in prod mode raises
3. `test_raises_on_127_0_0_1_in_production`: `127.0.0.1` in prod mode raises
4. `test_localhost_allowed_in_development`: `localhost` allowed when `APP_ENV=dev`
5. `test_valid_supabase_url_passes`: Real Supabase pooler URL passes

## Migration impact
None — schema unchanged. Workers with valid `DATABASE_URL` unaffected.

## Follow-ups
- #281 (Kujan, `playwright-e2e.yml` hardening) is queued with correct `squad:kujan` label.
- Monitor for any integration test failures in environments where `APP_ENV` is not explicitly set (should default to production-safe mode).
