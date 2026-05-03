"""Job handler and schedule registry for the backend worker."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from app.worker.bonds_scanner import refresh_bond_scanner_results

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


JOB_HANDLERS: dict[str, JobHandler] = {}
JOB_SCHEDULES: list[JobSchedule] = [
    JobSchedule(
        job_id="bonds_scanner_refresh",
        kind="cron",
        handler=refresh_bond_scanner_results,
        cron_expr="0 4 * * *",
    ),
]
