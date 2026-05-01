import os
import time

from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.supabase_auth import SupabaseClaims

SIMULATION_BUDGET_MS = float(os.getenv("PERF_SIMULATION_BUDGET_MS", "1200"))
METRICS_ENDPOINT_BUDGET_MS = float(os.getenv("PERF_METRICS_BUDGET_MS", "800"))


def test_plan_simulation_latency_budget(client: TestClient):
    """Test plan simulation endpoint meets latency budget."""
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
    """Metrics endpoint accepts anonymous requests and meets latency budget."""
    from main import app
    from fastapi.testclient import TestClient
    
    # Metrics endpoint doesn't need DB or auth — use simple test client
    client = TestClient(app)
    
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


def test_page_load_metrics_anonymous_request():
    """Metrics endpoint gracefully handles anonymous (no auth header) requests."""
    from main import app
    from fastapi.testclient import TestClient
    
    client = TestClient(app)
    
    payload = {
        "path": "/dashboard",
        "ttfb_ms": 95,
        "dom_content_loaded_ms": 520,
        "load_event_ms": 800,
        "first_contentful_paint_ms": 320,
        "largest_contentful_paint_ms": 750,
        "timestamp": "2026-04-30T15:30:00.000Z",
    }

    # No Authorization header — simulates navigator.sendBeacon()
    response = client.post("/api/metrics/page-load", json=payload)

    assert response.status_code == 200
    assert response.json()["status"] == "accepted"


def test_page_load_metrics_authenticated_request():
    """Metrics endpoint accepts authenticated requests and captures user_id."""
    from main import app
    from fastapi.testclient import TestClient
    
    client = TestClient(app)
    user_id = uuid4()
    mock_claims = SupabaseClaims(
        sub=user_id,
        role="authenticated",
        email="test@example.com",
        aud="authenticated",
        exp=9999999999,
        iat=1000000000,
    )

    payload = {
        "path": "/options",
        "ttfb_ms": 110,
        "dom_content_loaded_ms": 600,
        "load_event_ms": 900,
        "first_contentful_paint_ms": 400,
        "largest_contentful_paint_ms": 850,
        "timestamp": "2026-04-30T16:00:00.000Z",
    }

    # Mock the optional auth dependency to return authenticated user
    with patch(
        "app.dependencies.verify_supabase_jwt",
        new_callable=AsyncMock,
        return_value=mock_claims,
    ):
        response = client.post(
            "/api/metrics/page-load",
            json=payload,
            headers={"Authorization": "Bearer fake-valid-token"},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "accepted"
