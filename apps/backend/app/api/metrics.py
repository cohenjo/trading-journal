from fastapi import APIRouter
from pydantic import BaseModel
from opentelemetry import metrics

router = APIRouter(prefix="/api/metrics", tags=["metrics"])
meter = metrics.get_meter(__name__)

page_load_count = meter.create_counter(
    "frontend.page_load.count",
    unit="1",
    description="Number of page load metric payloads received from frontend.",
)
ttfb_histogram = meter.create_histogram(
    "frontend.page_load.ttfb.ms",
    unit="ms",
    description="Frontend time-to-first-byte measurements.",
)
dom_content_loaded_histogram = meter.create_histogram(
    "frontend.page_load.dom_content_loaded.ms",
    unit="ms",
    description="Frontend DOMContentLoaded timings.",
)
load_event_histogram = meter.create_histogram(
    "frontend.page_load.load_event.ms",
    unit="ms",
    description="Frontend load event timings.",
)
lcp_histogram = meter.create_histogram(
    "frontend.page_load.lcp.ms",
    unit="ms",
    description="Frontend largest contentful paint timings.",
)


class PageLoadMetrics(BaseModel):
    path: str
    ttfb_ms: float | None = None
    dom_content_loaded_ms: float | None = None
    load_event_ms: float | None = None
    first_contentful_paint_ms: float | None = None
    largest_contentful_paint_ms: float | None = None
    timestamp: str | None = None


@router.post("/page-load")
def capture_page_load_metrics(payload: PageLoadMetrics):
    attributes = {"path": payload.path}
    page_load_count.add(1, attributes)

    if payload.ttfb_ms is not None:
        ttfb_histogram.record(payload.ttfb_ms, attributes)
    if payload.dom_content_loaded_ms is not None:
        dom_content_loaded_histogram.record(payload.dom_content_loaded_ms, attributes)
    if payload.load_event_ms is not None:
        load_event_histogram.record(payload.load_event_ms, attributes)
    if payload.largest_contentful_paint_ms is not None:
        lcp_histogram.record(payload.largest_contentful_paint_ms, attributes)

    return {"status": "accepted"}
