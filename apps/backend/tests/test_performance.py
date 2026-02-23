import os
import pathlib
import sys
import time

from fastapi.testclient import TestClient

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from main import app

client = TestClient(app)

SIMULATION_BUDGET_MS = float(os.getenv("PERF_SIMULATION_BUDGET_MS", "1200"))
METRICS_ENDPOINT_BUDGET_MS = float(os.getenv("PERF_METRICS_BUDGET_MS", "800"))


def test_plan_simulation_latency_budget():
    request_payload = {
        "plan": {
            "items": [
                {
                    "id": "job1",
                    "name": "My Job",
                    "category": "Income",
                    "sub_category": "Earned Income",
                    "owner": "You",
                    "value": 100000,
                    "growth_rate": 0,
                    "start_condition": "Now",
                    "tax_rate": 20,
                },
                {
                    "id": "rent1",
                    "name": "Apartment Rent",
                    "category": "Expense",
                    "sub_category": "Housing",
                    "owner": "You",
                    "value": 30000,
                    "growth_rate": 0,
                    "start_condition": "Now",
                },
            ],
            "milestones": [],
            "settings": {},
        },
        "finances": None,
        "settings": {"primaryUser": {"birthYear": 1990}},
    }

    warmup_response = client.post("/api/plans/simulate", json=request_payload)
    assert warmup_response.status_code == 200

    measured_latencies = []
    for _ in range(3):
        start = time.perf_counter()
        response = client.post("/api/plans/simulate", json=request_payload)
        elapsed_ms = (time.perf_counter() - start) * 1000
        assert response.status_code == 200
        measured_latencies.append(elapsed_ms)

    avg_latency = sum(measured_latencies) / len(measured_latencies)
    assert avg_latency < SIMULATION_BUDGET_MS, (
        f"simulate endpoint too slow after warmup: {avg_latency:.2f}ms >= "
        f"{SIMULATION_BUDGET_MS:.0f}ms"
    )


def test_page_load_metrics_endpoint_latency_budget():
    payload = {
        "path": "/plan",
        "ttfb_ms": 120,
        "dom_content_loaded_ms": 680,
        "load_event_ms": 950,
        "first_contentful_paint_ms": 410,
        "largest_contentful_paint_ms": 920,
        "timestamp": "2026-02-23T20:00:00.000Z",
    }

    start = time.perf_counter()
    response = client.post("/api/metrics/page-load", json=payload)
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert response.status_code == 200
    assert response.json()["status"] == "accepted"
    assert elapsed_ms < METRICS_ENDPOINT_BUDGET_MS, (
        f"metrics endpoint too slow: {elapsed_ms:.2f}ms >= {METRICS_ENDPOINT_BUDGET_MS:.0f}ms"
    )
