"""Supabase-backed compute job queue poller."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
import logging
from typing import Any, Protocol, cast
from uuid import UUID

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine
from app.worker.registry import JOB_HANDLERS, JobHandler, JobPayload, JobResult

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 3
DEFAULT_BATCH_SIZE = 10


class SessionFactory(Protocol):
    """Callable protocol for creating worker database sessions."""

    def __call__(self) -> AbstractContextManager[Session]:
        """Return a database session context manager."""


@dataclass(frozen=True)
class ComputeJob:
    """Pending compute job row claimed by the worker."""

    id: UUID
    job_type: str
    payload: JobPayload
    attempts: int


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a SQLModel session using the configured privileged DB engine."""

    return Session(engine)


class JobQueuePoller:
    """Poll, claim, dispatch, and finalize rows in public.compute_jobs."""

    def __init__(
        self,
        handlers: dict[str, JobHandler] | None = None,
        session_factory: Callable[[], AbstractContextManager[Session]] | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> None:
        """Initialize a poller for the configured handler registry."""

        self.handlers = handlers if handlers is not None else JOB_HANDLERS
        self.session_factory = session_factory or _default_session_factory
        self.batch_size = batch_size

    def poll_once(self) -> int:
        """Claim and process one batch of pending jobs.

        Returns:
            Number of jobs claimed for processing.
        """

        with self.session_factory() as session:
            jobs = self._claim_pending_jobs(session)
            for job in jobs:
                self._process_job(session, job)
            session.commit()
            return len(jobs)

    def _claim_pending_jobs(self, session: Session) -> list[ComputeJob]:
        """Mark pending jobs running and return their payloads."""

        rows = session.execute(
            text(
                """
                update public.compute_jobs
                   set status = 'running',
                       started_at = now(),
                       finished_at = null,
                       error = null
                 where id in (
                   select id
                     from public.compute_jobs
                    where status = 'pending'
                      and attempts < :max_attempts
                    order by created_at
                    limit :batch_size
                    for update skip locked
                 )
                returning id, job_type, payload, attempts
                """
            ),
            {"max_attempts": MAX_ATTEMPTS, "batch_size": self.batch_size},
        ).mappings()

        return [
            ComputeJob(
                id=cast(UUID, row["id"]),
                job_type=cast(str, row["job_type"]),
                payload=cast(JobPayload, row["payload"] or {}),
                attempts=cast(int, row["attempts"]),
            )
            for row in rows
        ]

    def _process_job(self, session: Session, job: ComputeJob) -> None:
        """Dispatch one claimed job and persist its terminal or retry state."""

        handler = self.handlers.get(job.job_type)
        if handler is None:
            self._record_failure(
                session,
                job,
                ValueError(f"No handler registered for job_type '{job.job_type}'"),
                permanent=True,
            )
            return

        try:
            result = handler(job.payload)
        except Exception as exc:  # noqa: BLE001 - queue must capture handler failures
            logger.exception("Compute job %s failed", job.id)
            self._record_failure(session, job, exc)
            return

        self._record_success(session, job.id, result)

    def _record_success(self, session: Session, job_id: UUID, result: JobResult) -> None:
        """Mark a job done with its JSON result."""

        session.execute(
            text(
                """
                update public.compute_jobs
                   set status = 'done',
                       result = cast(:result as jsonb),
                       error = null,
                       finished_at = now()
                 where id = :job_id
                """
            ),
            {"job_id": job_id, "result": _json_safe(result)},
        )

    def _record_failure(
        self,
        session: Session,
        job: ComputeJob,
        exc: Exception,
        permanent: bool = False,
    ) -> None:
        """Record a failed attempt and requeue until the retry cap is reached."""

        next_attempts = min(job.attempts + 1, MAX_ATTEMPTS)
        next_status = "failed" if permanent or next_attempts >= MAX_ATTEMPTS else "pending"
        session.execute(
            text(
                """
                update public.compute_jobs
                   set status = :status,
                       error = :error,
                       attempts = :attempts,
                       finished_at = case when :status = 'failed' then now() else null end
                 where id = :job_id
                """
            ),
            {
                "job_id": job.id,
                "status": next_status,
                "error": str(exc),
                "attempts": next_attempts,
            },
        )


def _json_safe(value: dict[str, Any]) -> str:
    """Serialize a handler result to JSON for jsonb binding."""

    import json

    return json.dumps(value, default=str)


def poll_compute_jobs() -> int:
    """Run one compute-job polling pass using the global registry."""

    return JobQueuePoller().poll_once()
