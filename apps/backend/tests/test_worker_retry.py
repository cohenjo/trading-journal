"""Unit tests for exponential-backoff and DB-retry utilities."""

from __future__ import annotations

import pytest

from app.worker.retry import backoff_interval_sql, backoff_seconds, with_db_retry


def test_backoff_seconds_doubles_each_attempt() -> None:
    """Delay doubles per attempt: 1, 2, 4, 8, 16..."""
    assert backoff_seconds(1) == 1.0
    assert backoff_seconds(2) == 2.0
    assert backoff_seconds(3) == 4.0
    assert backoff_seconds(4) == 8.0
    assert backoff_seconds(5) == 16.0


def test_backoff_seconds_capped_at_max() -> None:
    """Delay is capped at _BACKOFF_MAX_SECONDS (60 s)."""
    assert backoff_seconds(100) == 60.0


def test_backoff_seconds_jitter_non_negative() -> None:
    """All backoff values are non-negative."""
    for i in range(1, 10):
        assert backoff_seconds(i) >= 0


def test_backoff_interval_sql_doubles() -> None:
    """SQL interval strings reflect the same doubling schedule."""
    assert backoff_interval_sql(1) == "1 seconds"
    assert backoff_interval_sql(2) == "2 seconds"
    assert backoff_interval_sql(3) == "4 seconds"
    assert backoff_interval_sql(4) == "8 seconds"


def test_backoff_interval_sql_capped() -> None:
    """SQL interval string is capped at 60 seconds."""
    assert backoff_interval_sql(100) == "60 seconds"


def test_with_db_retry_success_on_first_try() -> None:
    """Successful function is called exactly once."""
    calls: list[int] = []

    def fn() -> int:
        calls.append(1)
        return 42

    result = with_db_retry(fn)()
    assert result == 42
    assert len(calls) == 1


def test_with_db_retry_retries_on_os_error() -> None:
    """OSError triggers a retry."""
    attempts: list[int] = []

    def fn() -> int:
        attempts.append(1)
        if len(attempts) < 2:
            raise OSError("connection refused")
        return 99

    result = with_db_retry(fn)()
    assert result == 99
    assert len(attempts) == 2


def test_with_db_retry_exhaustion_raises() -> None:
    """After all retries are exhausted, RuntimeError is raised."""

    def fn() -> int:
        raise OSError("always fails")

    with pytest.raises(RuntimeError, match="DB connection failed"):
        with_db_retry(fn)()


def test_with_db_retry_non_transient_no_retry() -> None:
    """Non-transient exceptions (not OSError/ConnectionError) propagate immediately."""
    calls: list[int] = []

    def fn() -> int:
        calls.append(1)
        raise ValueError("bad input")

    with pytest.raises(ValueError, match="bad input"):
        with_db_retry(fn)()

    assert len(calls) == 1
