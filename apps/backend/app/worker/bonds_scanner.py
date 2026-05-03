"""Scheduled bond scanner refresh job."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import datetime, timezone
from decimal import Decimal
import json
import logging

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine
from app.services.bond_scanner import BondScannerCandidate, CURATED_BOND_SYMBOLS, fetch_bond_candidate

logger = logging.getLogger(__name__)

BondFetcher = Callable[[str], BondScannerCandidate]


def _json_default(value: object) -> object:
    """Serialize precise financial values for jsonb storage."""

    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()  # type: ignore[no-any-return]
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a privileged database session for worker writes."""

    return Session(engine)


class BondScannerRefreshJob:
    """Refresh and upsert daily bond scanner result rows."""

    def __init__(
        self,
        symbols: tuple[str, ...] = CURATED_BOND_SYMBOLS,
        fetcher: BondFetcher = fetch_bond_candidate,
        session_factory: Callable[[], AbstractContextManager[Session]] | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        """Initialize the refresh job with injectable dependencies for tests."""

        self.symbols = symbols
        self.fetcher = fetcher
        self.session_factory = session_factory or _default_session_factory
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def run(self) -> int:
        """Fetch the scanner universe and upsert successful symbol results."""

        refreshed_at = self.clock()
        upserted = 0
        with self.session_factory() as session:
            for symbol in self.symbols:
                try:
                    candidate = self.fetcher(symbol)
                except Exception as exc:  # noqa: BLE001 - scheduled batch must continue
                    logger.warning("Skipping bond scanner symbol %s after fetch failure: %s", symbol, exc)
                    continue
                self._upsert_candidate(session, candidate, refreshed_at)
                upserted += 1
            session.commit()
        logger.info("Bond scanner refresh upserted %d/%d symbol(s)", upserted, len(self.symbols))
        return upserted

    def _upsert_candidate(self, session: Session, candidate: BondScannerCandidate, refreshed_at: datetime) -> None:
        """Persist one scanner candidate using an idempotent symbol upsert."""

        session.execute(
            text(
                """
                insert into public.bond_scanner_results (symbol, data, refreshed_at)
                values (:symbol, cast(:data as jsonb), :refreshed_at)
                on conflict (symbol) do update
                   set data = excluded.data,
                       refreshed_at = excluded.refreshed_at
                """
            ),
            {
                "symbol": candidate.symbol,
                "data": json.dumps(candidate.to_result_data(), default=_json_default),
                "refreshed_at": refreshed_at,
            },
        )


def refresh_bond_scanner_results() -> int:
    """Run one global bond scanner refresh pass."""

    return BondScannerRefreshJob().run()
