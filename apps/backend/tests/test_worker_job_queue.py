"""Unit tests for the Supabase compute job queue poller."""

from __future__ import annotations

from contextlib import AbstractContextManager
from types import TracebackType
from typing import Any
from uuid import UUID

from app.worker.job_queue import JobQueuePoller


class FakeMappings:
    """Result wrapper that mimics SQLAlchemy's mappings() API."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        """Return mapping rows."""

        return self.rows


class FakeSession(AbstractContextManager["FakeSession"]):
    """Minimal SQLAlchemy session fake for queue transition assertions."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.executions: list[dict[str, Any]] = []
        self.committed = False

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        return False

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
        sql = str(statement)
        self.executions.append({"sql": sql, "params": params or {}})
        if "returning id, job_type, payload, attempts" in sql:
            return FakeMappings(self.rows)
        return FakeMappings([])

    def commit(self) -> None:
        """Record that the poller committed its batch."""

        self.committed = True


def test_poller_dispatches_handler_and_marks_done() -> None:
    """The poller claims pending jobs, calls the handler, and stores results."""

    job_id = UUID("00000000-0000-0000-0000-000000000001")
    session = FakeSession([{"id": job_id, "job_type": "fake", "payload": {"x": 1}, "attempts": 0}])
    seen_payloads: list[dict[str, object]] = []

    def handler(payload: dict[str, object]) -> dict[str, object]:
        seen_payloads.append(payload)
        return {"ok": True}

    poller = JobQueuePoller(handlers={"fake": handler}, session_factory=lambda: session)

    assert poller.poll_once() == 1
    assert seen_payloads == [{"x": 1}]
    assert session.committed is True
    assert any(call["params"].get("result") == '{"ok": true}' for call in session.executions)
    assert any("status = 'done'" in call["sql"] for call in session.executions)


def test_poller_requeues_failed_job_until_retry_cap() -> None:
    """Handler exceptions increment attempts and keep retryable jobs pending."""

    job_id = UUID("00000000-0000-0000-0000-000000000002")
    session = FakeSession([{"id": job_id, "job_type": "fake", "payload": {"x": 1}, "attempts": 1}])

    def handler(_payload: dict[str, object]) -> dict[str, object]:
        raise RuntimeError("boom")

    poller = JobQueuePoller(handlers={"fake": handler}, session_factory=lambda: session)

    assert poller.poll_once() == 1
    failure_params = session.executions[-1]["params"]
    assert failure_params["status"] == "pending"
    assert failure_params["attempts"] == 2
    assert failure_params["error"] == "boom"


def test_poller_marks_failed_at_retry_cap() -> None:
    """The third failed attempt permanently marks the job failed."""

    job_id = UUID("00000000-0000-0000-0000-000000000003")
    session = FakeSession([{"id": job_id, "job_type": "fake", "payload": {"x": 1}, "attempts": 2}])

    def handler(_payload: dict[str, object]) -> dict[str, object]:
        raise RuntimeError("still broken")

    poller = JobQueuePoller(handlers={"fake": handler}, session_factory=lambda: session)

    assert poller.poll_once() == 1
    failure_params = session.executions[-1]["params"]
    assert failure_params["status"] == "failed"
    assert failure_params["attempts"] == 3
    assert failure_params["error"] == "still broken"


def test_poller_marks_unknown_job_type_failed() -> None:
    """Unknown job types fail permanently so the queue cannot spin forever."""

    job_id = UUID("00000000-0000-0000-0000-000000000004")
    session = FakeSession([{"id": job_id, "job_type": "missing", "payload": {}, "attempts": 0}])
    poller = JobQueuePoller(handlers={}, session_factory=lambda: session)

    assert poller.poll_once() == 1
    failure_params = session.executions[-1]["params"]
    assert failure_params["status"] == "failed"
    assert failure_params["attempts"] == 1
    assert "No handler registered" in failure_params["error"]
