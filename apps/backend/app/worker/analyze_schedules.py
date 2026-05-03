"""Schedule registration for TJ-020 analysis batch jobs."""

from __future__ import annotations

import logging

from app.services.analyze_batch import (
    refresh_growth_stories,
    refresh_growth_stories_if_stale,
    refresh_ticker_analyses,
    refresh_ticker_analyses_if_stale,
)
from app.worker.registry import JOB_SCHEDULES, JobSchedule

logger = logging.getLogger(__name__)

ANALYZE_TICKERS_JOB_ID = "analyze_tickers_refresh"
ANALYZE_GROWTH_STORIES_JOB_ID = "analyze_growth_stories_refresh"


def run_analyze_tickers_refresh() -> None:
    """Refresh ticker analysis rows for all tracked tickers."""

    refreshed = refresh_ticker_analyses()
    logger.info("%s refreshed %d ticker(s)", ANALYZE_TICKERS_JOB_ID, refreshed)


def run_analyze_growth_stories_refresh() -> None:
    """Refresh growth-story rows for all tracked tickers."""

    refreshed = refresh_growth_stories()
    logger.info("%s refreshed %d ticker(s)", ANALYZE_GROWTH_STORIES_JOB_ID, refreshed)


def run_startup_analyze_refreshes() -> None:
    """Run stale analysis jobs once on worker startup."""

    ticker_count = refresh_ticker_analyses_if_stale()
    story_count = refresh_growth_stories_if_stale()
    if ticker_count or story_count:
        logger.info(
            "startup analysis refresh completed tickers=%d growth_stories=%d",
            ticker_count,
            story_count,
        )


JOB_SCHEDULES.extend(
    [
        JobSchedule(
            job_id=ANALYZE_TICKERS_JOB_ID,
            kind="cron",
            cron_expr="0 3 * * *",
            handler=run_analyze_tickers_refresh,
        ),
        JobSchedule(
            job_id=ANALYZE_GROWTH_STORIES_JOB_ID,
            kind="cron",
            cron_expr="30 3 * * *",
            handler=run_analyze_growth_stories_refresh,
        ),
    ]
)
