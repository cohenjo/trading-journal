# ADR: TJ-019 Compute Backend Hosting and Supabase Integration

- **Status:** Proposed — draft PR for Jony review
- **Date:** 2026-05-03
- **Owner:** Keaton (Lead)
- **Issue:** #189

## Context

Most CRUD-style FastAPI endpoints are moving to Next.js Server Actions, but compute-heavy endpoints still need a deployed backend. The backend must verify Supabase Auth tokens, connect directly to Supabase Postgres, and be reachable from Vercel through the existing `NEXT_PUBLIC_API_URL` rewrite wiring in `apps/frontend/next.config.ts`.

## Decision summary

Run the existing FastAPI Docker container on **Railway** as the cheapest viable single-region personal-project host, using Supabase JWT validation at the API boundary and Supabase Postgres via `DIRECT_DATABASE_URL`. Keep CRUD migration work blocked where Supabase schemas are missing; for SQLModel tables that previously depended on backend-created schema, explicit `supabase/migrations/` files are required before Server Actions can rely on them.

## 1. Hosting target

**Decision: Railway.**

Railway is the recommended target for the TJ-019 pilot because it is the cheapest viable always-on Docker host for a personal project: the Hobby plan is roughly the $5/month floor, provides simple Docker deploys, environment variable management, logs, and a public HTTPS service URL. Single-region is acceptable because Supabase is also single-region for this project.

Alternatives considered:

- **Fly.io:** strong Docker/runtime story and good global edge, but the cheapest always-on practical setup is usually slightly above Railway and the operational model is more involved.
- **Render:** simple and predictable, but paid always-on web services are typically about $7/month; free tier spin-down is not acceptable for a backend Vercel may call interactively.
- **Azure Container Apps:** powerful, but more operationally complex and not the cheapest personal-project option once always-on, logging, and Azure overhead are considered.

**Review gate:** open the PR as draft so Jony can confirm the hosting cost/choice before implementation.

## 2. Auth: Supabase JWT verification in FastAPI

Use Supabase JWT validation in FastAPI for every protected compute endpoint. The current backend already has `app.supabase_auth` with JWKS verification and HS256 fallback via `SUPABASE_JWT_SECRET`; keep that direction because Supabase Cloud can rotate asymmetric keys and JWKS handles rotation better than a hard-coded symmetric secret.

Recommended dependency shape:

```python
from fastapi import Depends, HTTPException, Request, status
from app.supabase_auth import SupabaseAuthSettings, get_jwks_cache, verify_supabase_jwt

async def get_current_user_id(request: Request) -> UUID:
    auth_header = request.headers.get("Authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    claims = await verify_supabase_jwt(
        token,
        SupabaseAuthSettings(),
        get_jwks_cache(),
    )
    return claims.sub
```

For local-dev HS256 tokens, set `SUPABASE_JWT_SECRET`. For Supabase Cloud, prefer JWKS with `SUPABASE_URL` and keep `SUPABASE_JWT_SECRET` only as fallback if needed.

## 3. DB connection: Supabase Postgres via DIRECT_DATABASE_URL

Switch SQLModel/SQLAlchemy to prefer `DIRECT_DATABASE_URL` in deployed environments and fall back to `DATABASE_URL` for local Docker/Aspire development.

```python
import os
from sqlmodel import Session, create_engine

DATABASE_URL = os.environ.get("DIRECT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL",
    "postgresql://user:password@localhost/trading-journal",
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=2,
    pool_recycle=1800,
    echo=False,
)

def get_session():
    with Session(engine) as session:
        yield session
```

Connection pooling notes:

- Keep the pool intentionally small; this is a low-traffic personal app and Supabase connection limits are finite.
- Use `pool_pre_ping=True` because container platforms can idle or recycle network connections.
- Do not call `SQLModel.metadata.create_all()` in production. Tables must come from explicit Supabase migrations.

## 4. Schema strategy and audit

Supabase MCP `list_tables` was used for the audit, then SQLModel definitions under `apps/backend/app/schema/` and API modules under `apps/backend/app/api/` were compared.

| Domain | FastAPI model | Supabase table | RLS? | Household scoping | Migration needed? |
|---|---|---|---|---|---|
| finances | `FinanceSnapshot` | `finance_snapshots` | Yes | `household_id` PK component; member read, writer write | No |
| plans | `Plan` | `plans` | Yes | `household_id`; member read, writer write | No |
| holdings | `BondHolding` | **missing** `bond_holdings` | N/A | SQLModel requires non-null `household_id` | **Yes — add table + RLS** |
| trading | `TradingAccountConfig`, `TradingAccountSummary`, `TradingPosition` | `trading_account_config`, `trading_account_summary`, `trading_positions` | Yes | `household_id`; config member read/write + owner delete; summary/positions writer write | No |
| insurance | `InsurancePolicy` | `insurance_policies` | Yes | `household_id` plus legacy `user_id` own policies; prefer household policies | No |
| options | `OptionsRecord` | **missing** options income table | N/A | No SQLModel table today; xlsx-backed data needs household scope | **Yes — add household-scoped options income table** |
| ladder | `LadderRung`, `LadderBond` dataclasses; mock `BondHolding` source | **missing** ladder rungs/bonds tables | N/A | Mock/in-memory today; target should be `household_id` | **Yes — add ladder rungs and/or use `bond_holdings` for bonds** |
| dividends | `DividendPosition`, `DividendAccount`, `DividendTickerData` | `dividend_positions`, `dividend_accounts`, `dividend_ticker_data` | Yes | positions/accounts use `household_id`; ticker data is global read-only | No |
| pension | no dedicated SQLModel; uses `FinanceSnapshot` + `Plan` JSON | `finance_snapshots`, `plans` | Yes | pension entries inherit household scope from snapshots/plans | No dedicated table needed for current API |
| summary/day/trades/ndx | `DailySummary`, `ManualTrade`, `Trade`, `Note`, `Ndx1m`, `DailyBar`, `Execution`, `MatchedTrade` | `dailysummary`, `manualtrade`, `trade`, `note`, `ndx1m`, `dailybar`, `execution`, `matchedtrade` | Yes | trade/manual/execution/matched/summary use `household_id`; note uses `owner_user_id`; ndx/dailybar global read-only | No |
| backtest/options market data | `OptionContract`, `HistoricalOptionBar`, `BacktestRun`, `BacktestTrade` | `optioncontract`, `historicaloptionbar`, `backtestrun`, `backtesttrade` | Yes | contracts/bars global read-only; runs `owner_user_id`; trades inherit run owner | No |

Explicit migrations required before wave-1 CRUD migrations proceed:

1. `bond_holdings` with `household_id uuid not null references households(id)`, soft-delete/audit columns, RLS through `is_household_member`/`is_household_writer`.
2. Household-scoped options income records, e.g. `options_income_records(household_id, year, amount, ...)` with a uniqueness constraint on `(household_id, year)` and standard household RLS.
3. Ladder persistence, minimally `ladder_rungs(household_id, rung_id/year, target_amount, ...)`; ladder bonds can either reference `bond_holdings` or use a dedicated `ladder_bonds` table if ladder-specific holdings diverge from the portfolio.

## 5. CORS

Allow only Vercel-hosted frontend origins and local development:

- Production: `https://trading-journal.vercel.app` or the final custom domain once assigned.
- Vercel previews: `https://*.vercel.app`, preferably constrained to the project/team pattern if the middleware supports origin regex.
- Local dev: `http://localhost:3000` and `http://127.0.0.1:3000`.

Do not use wildcard CORS with credentials. Preflight should allow `Authorization` so Vercel can forward Supabase bearer tokens to FastAPI.

## 6. Secrets and environment variables

The deployed backend needs:

- `DIRECT_DATABASE_URL` — Supabase direct Postgres URL for SQLModel/SQLAlchemy.
- `SUPABASE_URL` — project URL for issuer/JWKS discovery.
- `SUPABASE_JWT_SECRET` — HS256 fallback/local compatibility; avoid using it when JWKS succeeds.
- `SUPABASE_SERVICE_ROLE_KEY` — only for backend-only administrative operations that cannot be performed as the caller. Never expose this to the frontend.
- `CORS_ALLOWED_ORIGINS` or equivalent allowlist config.
- `PORT` — provided by Railway; uvicorn should bind `0.0.0.0:$PORT`.
- Optional external-service settings already used by compute endpoints, such as Copilot/PDF analysis, market data, broker integrations, and telemetry exporters.

## 7. Deployment URL strategy

Railway provides the backend public HTTPS URL. Vercel learns it through `NEXT_PUBLIC_API_URL`, which is already read by `apps/frontend/next.config.ts` and used to rewrite `/api/:path*` to `${NEXT_PUBLIC_API_URL}/api/:path*` when the URL is public.

## 8. Pilot endpoint

Pilot endpoint: **`/api/plans/simulate`**.

Reasons:

- It is compute-heavy and already called out in #189 and #173.
- It exercises auth, CORS, DB reads for household-scoped `plans`/`finance_snapshots`, and Vercel-to-backend routing without requiring broker or PDF integrations.
- It is a clean proof point for the split: CRUD stays in Server Actions, compute stays in FastAPI.

## 9. Migration order

Move compute endpoints first, in this order:

1. `/api/plans/simulate` — TJ-019 pilot; validates Railway + Supabase JWT + direct Postgres.
2. `/api/backtest/*` — already compute-oriented and backed by existing `backtestrun`/`backtesttrade` schema.
3. `/api/tax_condor/*` and options projection — pure compute/math with limited persistence.
4. `/api/pension/upload` — compute-heavy PDF analysis, writes to existing household-scoped snapshots/plans.
5. `/api/bonds/scanner` / ladder income calculations — after `bond_holdings`/ladder schema is added.
6. `/api/finances/price` and market-data sync endpoints — external data fetch/compute.
7. Dividend dashboard aggregations — keep CRUD in Server Actions, move only heavier aggregation/projection if Server Actions become too slow.

CRUD migrations that are blocked on schema should not start until their Supabase migration lands and RLS is verified.

## Consequences

- Keeps the monthly platform floor low while preserving Docker deployability.
- Establishes a clear boundary: Server Actions for CRUD, FastAPI for compute and external integrations.
- Requires schema discipline: no production `create_all`; every persistent FastAPI model needs a Supabase migration and RLS policy first.
- Requires Rabin/security review before enabling broad backend access because bearer tokens, service-role secrets, CORS, and direct DB credentials are all in scope.
