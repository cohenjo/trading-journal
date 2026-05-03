"""Scheduled analysis refresh jobs for TJ-020.

The frontend reads analysis results from Supabase. These helpers let the local
backend worker refresh yfinance-backed ticker analysis and growth stories on a
schedule without exposing FastAPI business routes to the browser.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlmodel import Session

from app.api.analyze import (
    get_fundamentals,
    get_option_chain,
    get_price_history,
    get_synthesis,
    get_technicals,
    post_growth_story,
)
from app.dal.database import engine

logger = logging.getLogger(__name__)
STALE_AFTER_HOURS = 24


@dataclass(frozen=True)
class TickerInput:
    """A household-scoped ticker discovered from tracked portfolio tables."""

    ticker: str
    household_id: UUID | None


SessionFactory = Callable[[], Session]


def _default_session_factory() -> Session:
    """Return a privileged SQLModel session for worker writes."""

    return Session(engine)


def _normalize_response(value: Any) -> dict[str, Any]:
    """Convert FastAPI route return values into plain dictionaries."""

    if isinstance(value, JSONResponse):
        decoded = json.loads(value.body.decode("utf-8"))
        return decoded if isinstance(decoded, dict) else {"data": decoded}
    if isinstance(value, dict):
        return value
    return {"data": value}


def _json_dumps(value: dict[str, Any]) -> str:
    """Serialize data for jsonb binds, preserving unsupported values as strings."""

    return json.dumps(value, default=str, allow_nan=False)


async def build_ticker_analysis(ticker: str) -> dict[str, Any]:
    """Build the combined yfinance analysis payload stored in analysis_tickers."""

    normalized = ticker.upper().strip()
    sections: dict[str, Any] = {}
    errors: dict[str, str] = {}

    async def required_section(name: str, loader: Callable[[], Any]) -> None:
        sections[name] = _normalize_response(await loader())

    async def optional_section(name: str, loader: Callable[[], Any]) -> None:
        try:
            sections[name] = _normalize_response(await loader())
        except HTTPException as exc:
            errors[name] = str(exc.detail)
            logger.info("Optional analysis section skipped ticker=%s section=%s error=%s", normalized, name, exc.detail)
        except Exception as exc:  # noqa: BLE001 - a section failure should not abort all tickers
            errors[name] = str(exc)
            logger.exception("Optional analysis section failed ticker=%s section=%s", normalized, name)

    await required_section("fundamentals", lambda: get_fundamentals(normalized))
    await optional_section("price_history_1y_1d", lambda: get_price_history(normalized, "1y", "1d"))
    await optional_section("price_history_5y_1wk", lambda: get_price_history(normalized, "5y", "1wk"))
    await optional_section("technicals", lambda: get_technicals(normalized))
    await optional_section("options", lambda: get_option_chain(normalized))
    await optional_section("synthesis", lambda: get_synthesis(normalized))

    return {
        "ticker": normalized,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sections": sections,
        "errors": errors,
        "source": "backend_batch",
    }


async def build_growth_story(ticker: str, ticker_analysis: dict[str, Any] | None = None) -> dict[str, Any]:
    """Generate or fetch a growth-story payload for a ticker."""

    normalized = ticker.upper().strip()
    fundamentals = (ticker_analysis or {}).get("sections", {}).get("fundamentals", {})
    company_name = str(fundamentals.get("name") or "")
    sector = str(fundamentals.get("sector") or "")
    return _normalize_response(
        await post_growth_story(
            normalized, None if not company_name and not sector else _GrowthStoryBody(company_name, sector)
        )
    )


class _GrowthStoryBody:
    """Small duck-typed body compatible with the FastAPI route helper."""

    def __init__(self, company_name: str, sector: str) -> None:
        self.company_name = company_name
        self.sector = sector


class AnalyzeBatchRefresher:
    """Refresh analysis result tables idempotently."""

    def __init__(self, session_factory: Callable[[], Session] | None = None) -> None:
        self.session_factory = session_factory or _default_session_factory

    def discover_tickers(self, session: Session) -> list[TickerInput]:
        """Find tickers from tracked household portfolio tables."""

        rows = session.execute(
            text(
                """
                with candidates as (
                  select household_id, upper(btrim(symbol)) as ticker
                    from public.trading_positions
                   where household_id is not null
                     and nullif(btrim(symbol), '') is not null
                     and coalesce(sec_type, '') in ('STK', 'ETF', '')
                  union
                  select household_id, upper(btrim(ticker)) as ticker
                    from public.dividend_positions
                   where household_id is not null
                     and nullif(btrim(ticker), '') is not null
                  union
                  select household_id, upper(btrim(ticker)) as ticker
                    from public.bond_holdings
                   where household_id is not null
                     and deleted_at is null
                     and nullif(btrim(ticker), '') is not null
                  union
                  select household_id, upper(btrim(symbol)) as ticker
                    from public.trade
                   where household_id is not null
                     and nullif(btrim(symbol), '') is not null
                     and coalesce("assetCategory", '') in ('STK', 'ETF')
                )
                select household_id, ticker
                  from candidates
                 where ticker ~ '^[A-Z][A-Z0-9.-]{0,14}$'
                 order by household_id, ticker
                """
            )
        ).mappings()
        return [TickerInput(ticker=str(row["ticker"]), household_id=row["household_id"]) for row in rows]

    def refresh_ticker_analyses(self) -> int:
        """Refresh all discovered ticker-analysis rows; failures skip only one ticker."""

        with self.session_factory() as session:
            ticker_inputs = self.discover_tickers(session)
            refreshed = self.refresh_specific_tickers(session, ticker_inputs)
            session.commit()
            return refreshed

    def refresh_growth_stories(self) -> int:
        """Refresh growth-story rows for all discovered tickers."""

        with self.session_factory() as session:
            ticker_inputs = self.discover_tickers(session)
            refreshed = 0
            for ticker_input in ticker_inputs:
                try:
                    existing_analysis = self._latest_ticker_analysis(session, ticker_input)
                    story = asyncio.run(build_growth_story(ticker_input.ticker, existing_analysis))
                    self._upsert_growth_story(session, ticker_input, story)
                    refreshed += 1
                except Exception:  # noqa: BLE001 - one bad ticker must not abort the batch
                    logger.exception("Growth-story refresh skipped ticker=%s", ticker_input.ticker)
            session.commit()
            return refreshed

    def refresh_specific_tickers(self, session: Session, ticker_inputs: Iterable[TickerInput]) -> int:
        """Refresh a supplied ticker set into analysis_tickers."""

        refreshed = 0
        for ticker_input in ticker_inputs:
            try:
                data = asyncio.run(build_ticker_analysis(ticker_input.ticker))
                self._upsert_ticker_analysis(session, ticker_input, data)
                refreshed += 1
            except Exception:  # noqa: BLE001 - one bad ticker must not abort the batch
                logger.exception("Ticker analysis refresh skipped ticker=%s", ticker_input.ticker)
        return refreshed

    def should_refresh(self, table_name: str) -> bool:
        """Return true when a result table is empty or older than the stale threshold."""

        if table_name not in {"analysis_tickers", "analysis_growth_stories"}:
            raise ValueError(f"Unsupported analysis table: {table_name}")
        with self.session_factory() as session:
            row = (
                session.execute(
                    text(
                        f"""
                    select coalesce(max(refreshed_at) < now() - interval '{STALE_AFTER_HOURS} hours', true) as stale
                      from public.{table_name}
                    """
                    )
                )
                .mappings()
                .first()
            )
            return bool(row is None or row["stale"])

    def _latest_ticker_analysis(self, session: Session, ticker_input: TickerInput) -> dict[str, Any] | None:
        row = (
            session.execute(
                text(
                    """
                select data
                  from public.analysis_tickers
                 where ticker = :ticker
                   and household_scope = coalesce(:household_id, '00000000-0000-0000-0000-000000000000'::uuid)
                 limit 1
                """
                ),
                {"ticker": ticker_input.ticker, "household_id": ticker_input.household_id},
            )
            .mappings()
            .first()
        )
        return row["data"] if row else None

    def _upsert_ticker_analysis(self, session: Session, ticker_input: TickerInput, data: dict[str, Any]) -> None:
        session.execute(
            text(
                """
                insert into public.analysis_tickers (ticker, household_id, data, refreshed_at, updated_at)
                values (:ticker, :household_id, cast(:data as jsonb), now(), now())
                on conflict (household_scope, ticker) do update
                   set data = excluded.data,
                       refreshed_at = excluded.refreshed_at,
                       updated_at = excluded.updated_at
                """
            ),
            {"ticker": ticker_input.ticker, "household_id": ticker_input.household_id, "data": _json_dumps(data)},
        )

    def _upsert_growth_story(self, session: Session, ticker_input: TickerInput, story: dict[str, Any]) -> None:
        session.execute(
            text(
                """
                insert into public.analysis_growth_stories (ticker, household_id, story, refreshed_at, updated_at)
                values (:ticker, :household_id, cast(:story as jsonb), now(), now())
                on conflict (household_scope, ticker) do update
                   set story = excluded.story,
                       refreshed_at = excluded.refreshed_at,
                       updated_at = excluded.updated_at
                """
            ),
            {"ticker": ticker_input.ticker, "household_id": ticker_input.household_id, "story": _json_dumps(story)},
        )


def refresh_ticker_analyses() -> int:
    """Refresh ticker analyses using the default database session."""

    return AnalyzeBatchRefresher().refresh_ticker_analyses()


def refresh_growth_stories() -> int:
    """Refresh growth stories using the default database session."""

    return AnalyzeBatchRefresher().refresh_growth_stories()


def refresh_ticker_analyses_if_stale() -> int:
    """Refresh ticker analyses on startup when stored results are stale."""

    refresher = AnalyzeBatchRefresher()
    if not refresher.should_refresh("analysis_tickers"):
        return 0
    return refresher.refresh_ticker_analyses()


def refresh_growth_stories_if_stale() -> int:
    """Refresh growth stories on startup when stored results are stale."""

    refresher = AnalyzeBatchRefresher()
    if not refresher.should_refresh("analysis_growth_stories"):
        return 0
    return refresher.refresh_growth_stories()
