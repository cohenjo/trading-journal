"""Scheduled trading account sync batch."""

from __future__ import annotations

import asyncio
import logging
import os
import socket
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Any

from sqlmodel import Session

from app.dal.database import engine
from app.services.trading_service import trading_service

logger = logging.getLogger(__name__)
DEFAULT_IB_GATEWAY_HOST = "127.0.0.1"
DEFAULT_IB_GATEWAY_PORT = 4002
DEFAULT_IB_GATEWAY_TIMEOUT_SECONDS = 2.0
SessionFactory = Callable[[], AbstractContextManager[Session]]


def ib_gateway_endpoint() -> tuple[str, int]:
    """Return the configured IB Gateway host and port for health checks."""

    host = os.getenv("IB_GATEWAY_HOST") or os.getenv("IB_HOST") or DEFAULT_IB_GATEWAY_HOST
    raw_port = os.getenv("IB_GATEWAY_PORT") or os.getenv("IB_PORT") or str(DEFAULT_IB_GATEWAY_PORT)
    try:
        port = int(raw_port)
    except ValueError:
        logger.warning("Invalid IB gateway port %r; using %s", raw_port, DEFAULT_IB_GATEWAY_PORT)
        port = DEFAULT_IB_GATEWAY_PORT
    return host, port


def is_ib_gateway_available(host: str, port: int, timeout: float = DEFAULT_IB_GATEWAY_TIMEOUT_SECONDS) -> bool:
    """Return whether a TCP connection to IB Gateway can be established."""

    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _session_factory() -> AbstractContextManager[Session]:
    """Create a SQLModel session bound to the worker database engine."""

    return Session(engine)


async def run_trading_sync_batch_async(session_factory: SessionFactory = _session_factory) -> dict[str, Any]:
    """Run one trading sync batch if IB Gateway is reachable."""

    host, port = ib_gateway_endpoint()
    if not is_ib_gateway_available(host, port):
        logger.info("IB Gateway offline, skipping")
        return {"status": "skipped", "reason": "ib_gateway_offline", "host": host, "port": port}

    try:
        with session_factory() as session:
            return await trading_service.sync_all_configured_accounts(session)
    except Exception as exc:  # noqa: BLE001 - scheduler must keep running after failures
        logger.exception("Trading sync batch failed")
        return {"status": "failed", "error": str(exc)}


def run_trading_sync_batch(session_factory: SessionFactory = _session_factory) -> dict[str, Any]:
    """Synchronous APScheduler entry point for the trading sync batch."""

    return asyncio.run(run_trading_sync_batch_async(session_factory=session_factory))
