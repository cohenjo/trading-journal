"""Unit tests for the Supabase compute job queue poller."""

from __future__ import annotations

from contextlib import AbstractContextManager
from types import TracebackType
from typing import Any
from uuid import UUID

from app.worker.job_queue import JobQueuePoller


class FakeMappings:
    """Result wrapper that mimics SQLAlchemy's mappings() and fetchall() APIs."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        """Return mapping rows."""

        return self.rows

    def fetchall(self) -> list[dict[str, Any]]:
        """Return rows (used by reclaim stale-running query)."""

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
        if "returning id, household_id, job_type, payload, attempts" in sql:
            return FakeMappings(self.rows)
        return FakeMappings([])

    def commit(self) -> None:
        """Record that the poller committed its batch."""

        self.committed = True


def test_poller_dispatches_handler_and_marks_done() -> None:
    """The poller claims pending jobs, calls the handler, and stores results."""

    job_id = UUID("00000000-0000-0000-0000-000000000001")
    household_id = UUID("10000000-0000-0000-0000-000000000001")
    session = FakeSession(
        [{"id": job_id, "household_id": household_id, "job_type": "fake", "payload": {"x": 1}, "attempts": 0}]
    )
    seen_payloads: list[dict[str, object]] = []

    def handler(payload: dict[str, object]) -> dict[str, object]:
        seen_payloads.append(payload)
        return {"ok": True}

    poller = JobQueuePoller(handlers={"fake": handler}, session_factory=lambda: session)

    assert poller.poll_once() == 1
    assert seen_payloads == [
        {
            "x": 1,
            "household_id": str(household_id),
            "compute_job_id": str(job_id),
        }
    ]
    assert session.committed is True
    assert any(call["params"].get("result") == '{"ok": true}' for call in session.executions)
    assert any("status = 'done'" in call["sql"] for call in session.executions)


def test_poller_requeues_failed_job_until_retry_cap() -> None:
    """Handler exceptions increment attempts and keep retryable jobs pending."""

    job_id = UUID("00000000-0000-0000-0000-000000000002")
    household_id = UUID("10000000-0000-0000-0000-000000000002")
    session = FakeSession(
        [{"id": job_id, "household_id": household_id, "job_type": "fake", "payload": {"x": 1}, "attempts": 1}]
    )

    def handler(_payload: dict[str, object]) -> dict[str, object]:
        raise RuntimeError("boom")

    poller = JobQueuePoller(handlers={"fake": handler}, session_factory=lambda: session)

    assert poller.poll_once() == 1
    failure_params = session.executions[-1]["params"]
    assert failure_params["status"] == "pending"
    assert failure_params["attempts"] == 2
    assert failure_params["error"] == "boom"


def test_poller_marks_failed_at_retry_cap() -> None:
    """The fifth failed attempt permanently marks the job failed (MAX_ATTEMPTS=5)."""

    job_id = UUID("00000000-0000-0000-0000-000000000003")
    household_id = UUID("10000000-0000-0000-0000-000000000003")
    session = FakeSession(
        [{"id": job_id, "household_id": household_id, "job_type": "fake", "payload": {"x": 1}, "attempts": 4}]
    )

    def handler(_payload: dict[str, object]) -> dict[str, object]:
        raise RuntimeError("still broken")

    poller = JobQueuePoller(handlers={"fake": handler}, session_factory=lambda: session)

    assert poller.poll_once() == 1
    failure_params = session.executions[-1]["params"]
    assert failure_params["status"] == "failed"
    assert failure_params["attempts"] == 5
    assert failure_params["error"] == "still broken"


def test_poller_marks_unknown_job_type_failed() -> None:
    """Unknown job types fail permanently so the queue cannot spin forever."""

    job_id = UUID("00000000-0000-0000-0000-000000000004")
    household_id = UUID("10000000-0000-0000-0000-000000000004")
    session = FakeSession(
        [{"id": job_id, "household_id": household_id, "job_type": "missing", "payload": {}, "attempts": 0}]
    )
    poller = JobQueuePoller(handlers={}, session_factory=lambda: session)

    assert poller.poll_once() == 1
    failure_params = session.executions[-1]["params"]
    assert failure_params["status"] == "failed"
    assert failure_params["attempts"] == 1
    assert "No handler registered" in failure_params["error"]


def test_poller_failure_sets_backoff_next_retry_at() -> None:
    """A retryable failure embeds a next_retry_at interval expression in the SQL."""

    job_id = UUID("00000000-0000-0000-0000-000000000005")
    household_id = UUID("10000000-0000-0000-0000-000000000005")
    session = FakeSession(
        [{"id": job_id, "household_id": household_id, "job_type": "fake", "payload": {}, "attempts": 0}]
    )

    def handler(_payload: dict[str, object]) -> dict[str, object]:
        raise RuntimeError("transient")

    poller = JobQueuePoller(handlers={"fake": handler}, session_factory=lambda: session)
    poller.poll_once()

    failure_call = next(
        (c for c in session.executions if c["params"].get("status") == "pending"),
        None,
    )
    assert failure_call is not None, "Expected a pending re-queue call"
    assert "next_retry_at" in failure_call["sql"]
    assert "interval" in failure_call["sql"]


def test_poller_permanent_failure_clears_next_retry_at() -> None:
    """On permanent failure the SQL sets next_retry_at = null."""

    job_id = UUID("00000000-0000-0000-0000-000000000006")
    household_id = UUID("10000000-0000-0000-0000-000000000006")
    session = FakeSession(
        [{"id": job_id, "household_id": household_id, "job_type": "fake", "payload": {}, "attempts": 4}]
    )

    def handler(_payload: dict[str, object]) -> dict[str, object]:
        raise RuntimeError("fatal")

    poller = JobQueuePoller(handlers={"fake": handler}, session_factory=lambda: session)
    poller.poll_once()

    failure_call = next(
        (c for c in session.executions if c["params"].get("status") == "failed"),
        None,
    )
    assert failure_call is not None
    assert "next_retry_at = null" in failure_call["sql"]


def test_poller_reclaims_stale_running_jobs() -> None:
    """poll_once issues a reclaim UPDATE for jobs stuck in running state."""

    session = FakeSession([])
    poller = JobQueuePoller(handlers={}, session_factory=lambda: session)
    poller.poll_once()

    reclaim_calls = [
        c for c in session.executions if "next_retry_at = now()" in c["sql"] and "status = 'pending'" in c["sql"]
    ]
    assert len(reclaim_calls) == 1, "Expected exactly one stale-running reclaim UPDATE"
