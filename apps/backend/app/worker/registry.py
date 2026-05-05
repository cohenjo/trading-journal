"""Job handler and schedule registry for the backend worker."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from app.services.trading_batch import run_trading_sync_batch
from app.worker.backtest_handler import run_backtest_job
from app.worker.bonds_scanner import refresh_bond_scanner_results
from app.worker.handlers.options_grouping import handle_compute_options_strategy_groups
from app.worker.handlers.options_metrics import handle_compute_options_monthly_metrics
from app.worker.handlers.options_margin_sync import (
    handle_options_margin_sync,
    run_intraday_options_margin_sync,
    run_scheduled_options_margin_sync,
)
from app.worker.handlers.options_sync import handle_flex_options_sync, run_scheduled_flex_options_sync
from app.worker.handlers.pnl_daily import handle_pnl_daily
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


JOB_HANDLERS: dict[str, JobHandler] = {
    "pension_pdf_parse": handle_pension_pdf_parse,
    "backtest": run_backtest_job,
    "flex_options_sync": handle_flex_options_sync,
    "compute_options_strategy_groups": handle_compute_options_strategy_groups,
    "compute_options_monthly_metrics": handle_compute_options_monthly_metrics,
    "options_margin_sync": handle_options_margin_sync,
    "pnl_daily": handle_pnl_daily,
}
JOB_SCHEDULES: list[JobSchedule] = [
    JobSchedule(
        job_id="trading_sync",
        kind="interval",
        seconds=15 * 60,
        handler=run_trading_sync_batch,
    ),
    JobSchedule(
        job_id="bonds_scanner_refresh",
        kind="cron",
        handler=refresh_bond_scanner_results,
        cron_expr="0 4 * * *",
    ),
    JobSchedule(
        job_id="flex_options_sync",
        kind="cron",
        handler=run_scheduled_flex_options_sync,
        cron_expr="30 22 * * *",
    ),
    JobSchedule(
        job_id="options_margin_sync_intraday",
        kind="interval",
        seconds=15 * 60,
        handler=run_intraday_options_margin_sync,
    ),
    JobSchedule(
        job_id="options_margin_sync_daily",
        kind="cron",
        handler=run_scheduled_options_margin_sync,
        cron_expr="35 22 * * *",
    ),
]
