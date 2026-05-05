"""Unit tests for the compute-worker CLI healthcheck."""

from __future__ import annotations

import pathlib
import time

import pytest

from app.worker.healthcheck import _check_db_url, _check_heartbeat, run_healthcheck


def test_heartbeat_missing_returns_error(tmp_path: pathlib.Path) -> None:
    """Missing heartbeat file reports an error."""
    missing = tmp_path / "no_heartbeat"
    error = _check_heartbeat(missing, stale_seconds=120)
    assert error is not None
    assert "not found" in error


def test_heartbeat_fresh_returns_none(tmp_path: pathlib.Path) -> None:
    """A freshly written heartbeat file is healthy."""
    hb = tmp_path / "heartbeat"
    hb.touch()
    error = _check_heartbeat(hb, stale_seconds=120)
    assert error is None


def test_heartbeat_stale_returns_error(tmp_path: pathlib.Path) -> None:
    """A heartbeat file older than the threshold is reported as stale."""
    hb = tmp_path / "heartbeat"
    hb.touch()
    stale_mtime = time.time() - 300
    import os

    os.utime(hb, (stale_mtime, stale_mtime))
    error = _check_heartbeat(hb, stale_seconds=120)
    assert error is not None
    assert "old" in error


def test_db_url_missing_returns_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing DATABASE_URL is reported as an error."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    error = _check_db_url()
    assert error is not None
    assert "DATABASE_URL" in error


def test_db_url_present_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """Present DATABASE_URL is healthy."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
    error = _check_db_url()
    assert error is None


def test_run_healthcheck_healthy(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Healthy worker returns exit code 0."""
    hb = tmp_path / "heartbeat"
    hb.touch()
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
    monkeypatch.setenv("WORKER_HEARTBEAT_FILE", str(hb))
    assert run_healthcheck() == 0


def test_run_healthcheck_stale_heartbeat(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Stale heartbeat returns exit code 1."""
    hb = tmp_path / "heartbeat"
    hb.touch()
    import os

    stale_mtime = time.time() - 300
    os.utime(hb, (stale_mtime, stale_mtime))
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
    monkeypatch.setenv("WORKER_HEARTBEAT_FILE", str(hb))
    assert run_healthcheck() == 1


def test_run_healthcheck_missing_db_url(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing DATABASE_URL returns exit code 1."""
    hb = tmp_path / "heartbeat"
    hb.touch()
    monkeypatch.setenv("WORKER_HEARTBEAT_FILE", str(hb))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert run_healthcheck() == 1
