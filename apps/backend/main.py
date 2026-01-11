from fastapi import FastAPI
import uvicorn
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from app.dal.database import create_db_and_tables
from app.api import (
    trades,
    day,
    summary,
    ndx,
    ladder,
    holdings,
    bonds,
    dividends,
    options,
    tax_condor,
    backtest,
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

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Creating tables..")
    create_db_and_tables()
    yield

app = FastAPI(lifespan=lifespan)

# Instrument FastAPI
FastAPIInstrumentor.instrument_app(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"Hello": "World"}

# Include routers
app.include_router(trades.router, prefix="/api", tags=["trades"])
app.include_router(day.router, prefix="/api", tags=["day"])
app.include_router(summary.router, prefix="/api", tags=["summary"])
app.include_router(ndx.router, prefix="/api", tags=["ndx"])
app.include_router(ladder.router, prefix="/api", tags=["ladder"])
app.include_router(holdings.router, prefix="/api", tags=["holdings"])
app.include_router(bonds.router, prefix="/api", tags=["bonds"])
app.include_router(dividends.router, prefix="/api", tags=["dividends"])
app.include_router(options.router, prefix="/api", tags=["options"])
app.include_router(tax_condor.router, prefix="/api/tax-condor", tags=["tax-condor"])
app.include_router(backtest.router, prefix="/api/backtest", tags=["backtest"])

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
