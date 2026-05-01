import json

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
import uvicorn
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.dal.database import create_db_and_tables
from app.utils.decimal_encoder import decimal_default
from app.dependencies import get_current_user
from app.api import (
    auth as auth_router_module,
    trades,
    day,
    summary,
    ndx,
    ladder,
    holdings,
    bonds,
    dividends,
    dividend_accounts,
    options,
    tax_condor,
    backtest,
    finances,
    plans,
    trading,
    pension,
    analyze,
    insurance,
    metrics as telemetry_metrics,
)
import os
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.sdk.resources import Resource

# Setup OTel
resource = Resource.create(attributes={
    "service.name": os.getenv("OTEL_SERVICE_NAME", "trading-journal-backend")
})

trace.set_tracer_provider(TracerProvider(resource=resource))
tracer_provider = trace.get_tracer_provider()
otlp_exporter = OTLPSpanExporter(
    endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317"),
    insecure=True
)
span_processor = BatchSpanProcessor(otlp_exporter)
tracer_provider.add_span_processor(span_processor)

metric_reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(
        endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317"),
        insecure=True
    )
)
meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
metrics.set_meter_provider(meter_provider)

LoggingInstrumentor().instrument(set_logging_format=True)


class DecimalSafeJSONResponse(JSONResponse):
    """JSONResponse that serializes Decimal values as numbers (float)."""
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
            default=decimal_default,
        ).encode("utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Creating tables..")
    create_db_and_tables()
    await _warmup_jwks_cache()
    yield


async def _warmup_jwks_cache() -> None:
    """Pre-populate the Supabase JWKS cache at startup (non-fatal on failure)."""
    import asyncio

    try:
        from app.supabase_auth import SupabaseAuthSettings, init_jwks_cache

        sb_settings = SupabaseAuthSettings()
        cache = init_jwks_cache(sb_settings)

        async def _prefetch() -> None:
            try:
                # Trigger a fetch by requesting any key (uses the public _refresh path)
                import httpx

                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(sb_settings.jwks_url)
                    resp.raise_for_status()
                    data = resp.json()
                import time

                for key_data in data.get("keys", []):
                    kid = key_data.get("kid", "default")
                    cache._keys[kid] = key_data  # type: ignore[attr-defined]
                cache._last_fetch = time.monotonic()  # type: ignore[attr-defined]
                print(f"JWKS cache warmed: {cache.key_count} key(s)")
            except Exception as exc:  # noqa: BLE001
                print(f"JWKS pre-fetch skipped (non-fatal): {type(exc).__name__}: {exc}")

        asyncio.create_task(_prefetch())
    except Exception as exc:  # noqa: BLE001
        print(f"Supabase auth settings not configured (non-fatal): {type(exc).__name__}: {exc}")

app = FastAPI(
    title="Trading Journal API",
    description="API for managing trades, portfolios, pensions, insurance, and financial analysis",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
    default_response_class=DecimalSafeJSONResponse,
)

# Instrument FastAPI
FastAPIInstrumentor.instrument_app(app)

# CORS: restrict origins. Set CORS_ORIGINS env var (comma-separated) for production.
cors_origins = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(SecurityHeadersMiddleware)

# Public paths that skip JWT authentication
PUBLIC_PATHS = {"/", "/docs", "/redoc", "/openapi.json", "/api/auth/register", "/api/auth/login"}


@app.get("/")
def read_root():
    """Health-check root endpoint."""
    return {"Hello": "World"}


@app.get("/health/auth", tags=["health"])
def health_auth():
    """Supabase JWKS cache diagnostics — no authentication required.

    Returns the current state of the JWKS signing-key cache so operators
    can verify the cache is populated after deployment.
    """
    from app.supabase_auth import get_jwks_cache

    cache = get_jwks_cache()
    if cache is None:
        return {"status": "not_initialized", "key_count": 0, "populated": False}
    return {
        "status": "ok",
        "key_count": cache.key_count,
        "populated": cache.is_populated,
    }

# Auth router (public endpoints — registered first, no auth dependency)
app.include_router(auth_router_module.router)

# All remaining routers require authentication
auth_dep = [Depends(get_current_user)]

# Include routers
app.include_router(trades.router, prefix="/api", tags=["trades"], dependencies=auth_dep)
app.include_router(day.router, prefix="/api", tags=["day"], dependencies=auth_dep)
app.include_router(summary.router, prefix="/api", tags=["summary"], dependencies=auth_dep)
app.include_router(ndx.router, prefix="/api", tags=["ndx"], dependencies=auth_dep)
app.include_router(ladder.router, prefix="/api", tags=["ladder"], dependencies=auth_dep)
app.include_router(holdings.router, prefix="/api", tags=["holdings"], dependencies=auth_dep)
app.include_router(bonds.router, prefix="/api", tags=["bonds"], dependencies=auth_dep)
app.include_router(dividends.router, prefix="/api", tags=["dividends"], dependencies=auth_dep)
app.include_router(dividend_accounts.router, dependencies=auth_dep)
app.include_router(options.router, prefix="/api", tags=["options"], dependencies=auth_dep)
app.include_router(tax_condor.router, prefix="/api/tax-condor", tags=["tax-condor"], dependencies=auth_dep)
app.include_router(backtest.router, prefix="/api/backtest", tags=["backtest"], dependencies=auth_dep)
app.include_router(finances.router, dependencies=auth_dep)
app.include_router(plans.router, dependencies=auth_dep)
app.include_router(trading.router, dependencies=auth_dep)
app.include_router(pension.router, dependencies=auth_dep)
app.include_router(analyze.router, dependencies=auth_dep)
app.include_router(insurance.router, dependencies=auth_dep)
# Metrics router handles optional auth internally (telemetry must work with sendBeacon)
app.include_router(telemetry_metrics.router)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
