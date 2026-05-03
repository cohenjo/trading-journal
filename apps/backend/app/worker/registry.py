"""Job handler and schedule registry for the backend worker."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from app.worker.pension_pdf_parse import handle_pension_pdf_parse

JobPayload = dict[str, object]
JobResult = dict[str, object]
JobHandler = Callable[[JobPayload], JobResult]
ScheduleKind = Literal["cron", "interval"]


@dataclass(frozen=True)
class JobSchedule:
    """Declarative schedule entry registered by follow-up compute migrations."""

    job_id: str
    kind: ScheduleKind
    handler: Callable[[], None]
    cron_expr: str | None = None
    seconds: int | None = None


JOB_HANDLERS: dict[str, JobHandler] = {"pension_pdf_parse": handle_pension_pdf_parse}
JOB_SCHEDULES: list[JobSchedule] = []
