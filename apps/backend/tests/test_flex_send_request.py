"""Tests for IBKR Flex SendRequest URL construction."""

from __future__ import annotations

from datetime import date
from typing import Any
from unittest.mock import Mock
from xml.etree.ElementTree import fromstring

import pytest
import requests

from scripts.flex_probe import FlexProbeError, QueryConfig, send_flex_request


@pytest.fixture()
def stub_request_xml(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_request_xml(url: str, params: dict[str, str], timeout_seconds: int = 30, **kwargs: Any) -> Any:
        captured["url"] = url
        captured["params"] = params
        return fromstring(
            "<FlexStatementResponse><Status>Success</Status><ReferenceCode>123</ReferenceCode></FlexStatementResponse>"
        )

    monkeypatch.setattr("scripts.flex_probe.request_xml", fake_request_xml)
    return captured


def test_send_flex_request_adds_period_customdate_when_dates_supplied(
    stub_request_xml: dict[str, Any],
) -> None:
    config = QueryConfig(name="trades", query_id="1496910")
    send_flex_request(config, "TOKEN", date(2024, 1, 1), date(2024, 12, 31))
    params = stub_request_xml["params"]
    assert params["period"] == "CustomDate"
    assert params["startdate"] == "20240101"
    assert params["enddate"] == "20241231"


def test_send_flex_request_omits_period_when_dates_missing(
    stub_request_xml: dict[str, Any],
) -> None:
    config = QueryConfig(name="trades", query_id="1496910")
    send_flex_request(config, "TOKEN", None, None)
    params = stub_request_xml["params"]
    assert "period" not in params
    assert "startdate" not in params
    assert "enddate" not in params


def test_send_flex_request_retries_on_1001_throttle(monkeypatch: pytest.MonkeyPatch) -> None:
    """A transient 1001 must trigger backoff+retry, not surface to the caller."""

    responses = [
        fromstring(
            "<FlexStatementResponse><Status>Fail</Status>"
            "<ErrorCode>1001</ErrorCode>"
            "<ErrorMessage>Statement could not be generated at this time.</ErrorMessage>"
            "</FlexStatementResponse>"
        ),
        fromstring(
            "<FlexStatementResponse><Status>Success</Status><ReferenceCode>OK</ReferenceCode></FlexStatementResponse>"
        ),
    ]
    calls: list[dict[str, str]] = []

    def fake_request_xml(url: str, params: dict[str, str], timeout_seconds: int = 30, **kwargs: Any) -> Any:
        calls.append(dict(params))
        return responses.pop(0)

    sleeps: list[float] = []
    monkeypatch.setattr("scripts.flex_probe.request_xml", fake_request_xml)
    # Pin jitter to 1.0 for deterministic assertion.
    monkeypatch.setattr("scripts.flex_probe.random.uniform", lambda _lo, _hi: 1.0)
    config = QueryConfig(name="trades", query_id="1496910")
    ref = send_flex_request(config, "TOKEN", date(2024, 1, 1), date(2024, 12, 31), sleep=sleeps.append)
    assert ref == "OK"
    assert len(calls) == 2
    assert sleeps == [60.0]


def test_send_flex_request_raises_after_exhausting_1001_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    """Persistent 1001 surfaces a clear error, not a silent loop."""

    failure = fromstring(
        "<FlexStatementResponse><Status>Fail</Status>"
        "<ErrorCode>1001</ErrorCode>"
        "<ErrorMessage>Throttled</ErrorMessage>"
        "</FlexStatementResponse>"
    )
    monkeypatch.setattr("scripts.flex_probe.request_xml", lambda *_a, **_k: failure)
    monkeypatch.setattr("scripts.flex_probe.random.uniform", lambda _lo, _hi: 1.0)
    config = QueryConfig(name="trades", query_id="1496910")
    sleeps: list[float] = []
    with pytest.raises(Exception, match="1001"):
        send_flex_request(
            config,
            "TOKEN",
            None,
            None,
            max_retries=3,
            initial_backoff_seconds=1.0,
            sleep=sleeps.append,
        )
    assert sleeps == [1.0, 2.0]


def test_send_flex_request_does_not_retry_other_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-1001 Flex errors must fail fast — don't burn retries on real failures."""

    response = fromstring(
        "<FlexStatementResponse><Status>Fail</Status>"
        "<ErrorCode>1003</ErrorCode>"
        "<ErrorMessage>Date range exceeds retention</ErrorMessage>"
        "</FlexStatementResponse>"
    )
    calls: list[Any] = []

    def fake_request_xml(*_a: Any, **_k: Any) -> Any:
        calls.append(1)
        return response

    monkeypatch.setattr("scripts.flex_probe.request_xml", fake_request_xml)
    config = QueryConfig(name="trades", query_id="1496910")
    with pytest.raises(Exception, match="1003"):
        send_flex_request(config, "TOKEN", None, None, sleep=lambda _s: None)
    assert len(calls) == 1


def test_fetch_live_xml_dedupes_by_query_id(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """When multiple QueryConfigs share a query_id, only one SendRequest fires."""

    from scripts import flex_probe

    monkeypatch.setattr(flex_probe, "OUTPUT_DIR", tmp_path)
    send_calls: list[str] = []
    get_calls: list[str] = []

    def fake_send(config, token, start, end, **_kw):  # type: ignore[no-untyped-def]
        send_calls.append(config.query_id)
        return f"REF-{config.query_id}"

    def fake_get(config, token, ref, poll, max_polls):  # type: ignore[no-untyped-def]
        get_calls.append(ref)
        return b"<FlexQueryResponse/>"

    monkeypatch.setattr(flex_probe, "send_flex_request", fake_send)
    monkeypatch.setattr(flex_probe, "get_statement", fake_get)

    configs = [
        flex_probe.QueryConfig(name="trades", query_id="1496910"),
        flex_probe.QueryConfig(name="cash", query_id="1496910"),
        flex_probe.QueryConfig(name="positions", query_id="1496910"),
        flex_probe.QueryConfig(name="other", query_id="999999"),
    ]
    args = type("A", (), {"from_date": None, "to_date": None, "poll_seconds": 1, "max_polls": 1})()
    paths = flex_probe.fetch_live_xml(configs, "TOKEN", args)
    assert send_calls == ["1496910", "999999"]
    assert get_calls == ["REF-1496910", "REF-999999"]
    assert len(paths) == 2


# Transport-level retry tests


def test_transport_retry_succeeds_after_transient_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    """Transport errors trigger exponential backoff, then succeed."""

    attempts: list[int] = []
    success_response = Mock(spec=requests.Response)
    success_response.status_code = 200
    success_response.content = (
        b"<FlexStatementResponse><Status>Success</Status><ReferenceCode>OK</ReferenceCode></FlexStatementResponse>"
    )
    success_response.raise_for_status = Mock()

    def fake_get(url: str, params: dict[str, str], timeout: int) -> requests.Response:
        attempts.append(len(attempts) + 1)
        if len(attempts) < 3:
            raise requests.ConnectionError("Connection reset by peer")
        return success_response

    sleeps: list[float] = []
    monkeypatch.setattr("scripts.flex_probe.requests.get", fake_get)
    monkeypatch.setattr("scripts.flex_probe.random.uniform", lambda _lo, _hi: 1.0)

    config = QueryConfig(name="trades", query_id="1496910")
    ref = send_flex_request(config, "TOKEN", date(2024, 1, 1), date(2024, 12, 31), sleep=sleeps.append)
    assert ref == "OK"
    assert len(attempts) == 3
    # Backoff: 5s * 1.0, 10s * 1.0
    assert sleeps == [5.0, 10.0]


def test_transport_retry_exhaustion(monkeypatch: pytest.MonkeyPatch) -> None:
    """Persistent transport errors surface clear FlexProbeError."""

    def fake_get(url: str, params: dict[str, str], timeout: int) -> requests.Response:
        raise requests.ConnectionError(ConnectionResetError(54, "Connection reset by peer"))

    sleeps: list[float] = []
    monkeypatch.setattr("scripts.flex_probe.requests.get", fake_get)
    monkeypatch.setattr("scripts.flex_probe.random.uniform", lambda _lo, _hi: 1.0)

    config = QueryConfig(name="trades", query_id="1496910")
    with pytest.raises(FlexProbeError, match="Transport retries exhausted.*ConnectionError"):
        send_flex_request(config, "TOKEN", None, None, sleep=sleeps.append)
    # 5 attempts means 4 sleeps: 5s, 10s, 20s, 40s
    assert sleeps == [5.0, 10.0, 20.0, 40.0]


def test_transport_retry_5xx(monkeypatch: pytest.MonkeyPatch) -> None:
    """HTTP 5xx errors trigger retry, then succeed."""

    attempts: list[int] = []
    success_response = Mock(spec=requests.Response)
    success_response.status_code = 200
    success_response.content = (
        b"<FlexStatementResponse><Status>Success</Status><ReferenceCode>OK</ReferenceCode></FlexStatementResponse>"
    )
    success_response.raise_for_status = Mock()

    def fake_get(url: str, params: dict[str, str], timeout: int) -> requests.Response:
        attempts.append(len(attempts) + 1)
        if len(attempts) <= 2:
            response = Mock(spec=requests.Response)
            response.status_code = 503
            response.raise_for_status = Mock()
            return response
        return success_response

    sleeps: list[float] = []
    monkeypatch.setattr("scripts.flex_probe.requests.get", fake_get)
    monkeypatch.setattr("scripts.flex_probe.random.uniform", lambda _lo, _hi: 1.0)

    config = QueryConfig(name="trades", query_id="1496910")
    ref = send_flex_request(config, "TOKEN", date(2024, 1, 1), date(2024, 12, 31), sleep=sleeps.append)
    assert ref == "OK"
    assert len(attempts) == 3
    assert sleeps == [5.0, 10.0]


def test_transport_retry_does_not_retry_4xx(monkeypatch: pytest.MonkeyPatch) -> None:
    """HTTP 4xx errors fail immediately without retry."""

    attempts: list[int] = []

    def fake_get(url: str, params: dict[str, str], timeout: int) -> requests.Response:
        attempts.append(len(attempts) + 1)
        response = Mock(spec=requests.Response)
        response.status_code = 401
        response.raise_for_status = Mock(side_effect=requests.HTTPError("401 Unauthorized", response=response))
        return response

    sleeps: list[float] = []
    monkeypatch.setattr("scripts.flex_probe.requests.get", fake_get)

    config = QueryConfig(name="trades", query_id="1496910")
    with pytest.raises(FlexProbeError, match="HTTP 401"):
        send_flex_request(config, "TOKEN", None, None, sleep=sleeps.append)
    # Should fail immediately without retry
    assert len(attempts) == 1
    assert sleeps == []


def test_transport_retry_ssl_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """SSL errors trigger retry, then succeed."""

    attempts: list[int] = []
    success_response = Mock(spec=requests.Response)
    success_response.status_code = 200
    success_response.content = (
        b"<FlexStatementResponse><Status>Success</Status><ReferenceCode>OK</ReferenceCode></FlexStatementResponse>"
    )
    success_response.raise_for_status = Mock()

    def fake_get(url: str, params: dict[str, str], timeout: int) -> requests.Response:
        attempts.append(len(attempts) + 1)
        if len(attempts) == 1:
            raise requests.exceptions.SSLError("SSL handshake failed")
        return success_response

    sleeps: list[float] = []
    monkeypatch.setattr("scripts.flex_probe.requests.get", fake_get)
    monkeypatch.setattr("scripts.flex_probe.random.uniform", lambda _lo, _hi: 1.0)

    config = QueryConfig(name="trades", query_id="1496910")
    ref = send_flex_request(config, "TOKEN", date(2024, 1, 1), date(2024, 12, 31), sleep=sleeps.append)
    assert ref == "OK"
    assert len(attempts) == 2
    assert sleeps == [5.0]


# Application-level retry budget tests


def test_send_flex_request_uses_new_default_retry_count() -> None:
    """Default retry count for 1001 is now 8, not 3 (bumped for heavy Activity queries)."""
    from scripts import flex_probe
    from xml.etree.ElementTree import fromstring

    failure = fromstring(
        "<FlexStatementResponse><Status>Fail</Status>"
        "<ErrorCode>1001</ErrorCode>"
        "<ErrorMessage>Throttled</ErrorMessage>"
        "</FlexStatementResponse>"
    )
    calls: list[int] = []

    def fake_request_xml(*_a: Any, **_k: Any) -> Any:
        calls.append(1)
        return failure

    # Patch at module level
    original_request_xml = flex_probe.request_xml
    flex_probe.request_xml = fake_request_xml
    original_uniform = flex_probe.random.uniform
    flex_probe.random.uniform = lambda _lo, _hi: 1.0

    try:
        config = QueryConfig(name="trades", query_id="1496910")
        sleeps: list[float] = []
        with pytest.raises(FlexProbeError) as exc_info:
            send_flex_request(config, "TOKEN", None, None, sleep=sleeps.append)

        # Should have made 8 attempts (bumped from 5 for resilience)
        assert len(calls) == 8
        # Should have slept 7 times (between attempts 1-2, 2-3, ..., 7-8)
        assert len(sleeps) == 7
        # Error message should mention "8 retries"
        assert "8 retries" in str(exc_info.value)
        # Error message should contain guidance
        assert "Recommended:" in str(exc_info.value)
        assert "Account Management" in str(exc_info.value)
    finally:
        flex_probe.request_xml = original_request_xml
        flex_probe.random.uniform = original_uniform


def test_send_flex_request_respects_explicit_max_retries() -> None:
    """Explicit max_retries parameter controls retry count."""
    from scripts import flex_probe
    from xml.etree.ElementTree import fromstring

    failure = fromstring(
        "<FlexStatementResponse><Status>Fail</Status>"
        "<ErrorCode>1001</ErrorCode>"
        "<ErrorMessage>Throttled</ErrorMessage>"
        "</FlexStatementResponse>"
    )
    calls: list[int] = []

    def fake_request_xml(*_a: Any, **_k: Any) -> Any:
        calls.append(1)
        return failure

    original_request_xml = flex_probe.request_xml
    flex_probe.request_xml = fake_request_xml
    original_uniform = flex_probe.random.uniform
    flex_probe.random.uniform = lambda _lo, _hi: 1.0

    try:
        config = QueryConfig(name="trades", query_id="1496910")
        sleeps: list[float] = []
        with pytest.raises(FlexProbeError) as exc_info:
            # Explicitly pass max_retries=2
            send_flex_request(config, "TOKEN", None, None, max_retries=2, sleep=sleeps.append)

        # Should have made 2 attempts
        assert len(calls) == 2
        # Should have slept 1 time (between attempt 1 and 2)
        assert len(sleeps) == 1
        # Error message should mention "2 retries"
        assert "2 retries" in str(exc_info.value)
    finally:
        flex_probe.request_xml = original_request_xml
        flex_probe.random.uniform = original_uniform


def test_send_flex_request_exhaustion_message_includes_guidance() -> None:
    """Exhaustion error message includes actionable guidance for 1001."""
    from scripts import flex_probe
    from xml.etree.ElementTree import fromstring

    failure = fromstring(
        "<FlexStatementResponse><Status>Fail</Status>"
        "<ErrorCode>1001</ErrorCode>"
        "<ErrorMessage>Statement generation stuck</ErrorMessage>"
        "</FlexStatementResponse>"
    )

    def fake_request_xml(*_a: Any, **_k: Any) -> Any:
        return failure

    original_request_xml = flex_probe.request_xml
    flex_probe.request_xml = fake_request_xml
    original_uniform = flex_probe.random.uniform
    flex_probe.random.uniform = lambda _lo, _hi: 1.0

    try:
        config = QueryConfig(name="trades", query_id="1496910")
        sleeps: list[float] = []
        with pytest.raises(FlexProbeError) as exc_info:
            send_flex_request(config, "TOKEN", None, None, max_retries=2, sleep=sleeps.append)

        error_msg = str(exc_info.value)
        # Check for all key guidance components
        assert "Recommended:" in error_msg
        assert "wait ~30 minutes" in error_msg
        assert "Account Management" in error_msg
        assert "Flex Web Service Configuration" in error_msg
        assert "query_id=1496910" in error_msg
        assert "Last IBKR message: Statement generation stuck" in error_msg
    finally:
        flex_probe.request_xml = original_request_xml
        flex_probe.random.uniform = original_uniform


def test_send_flex_request_elapsed_total_accumulates() -> None:
    """elapsed_total tracks cumulative wait time across retries."""
    from scripts import flex_probe
    from xml.etree.ElementTree import fromstring
    import sys
    from io import StringIO

    failure = fromstring(
        "<FlexStatementResponse><Status>Fail</Status>"
        "<ErrorCode>1001</ErrorCode>"
        "<ErrorMessage>Throttled</ErrorMessage>"
        "</FlexStatementResponse>"
    )

    def fake_request_xml(*_a: Any, **_k: Any) -> Any:
        return failure

    original_request_xml = flex_probe.request_xml
    flex_probe.request_xml = fake_request_xml
    original_uniform = flex_probe.random.uniform
    flex_probe.random.uniform = lambda _lo, _hi: 1.0

    # Capture stderr to check log messages
    captured_stderr = StringIO()
    original_stderr = sys.stderr
    sys.stderr = captured_stderr

    try:
        config = QueryConfig(name="trades", query_id="1496910")
        sleeps: list[float] = []
        with pytest.raises(FlexProbeError) as exc_info:
            send_flex_request(
                config, "TOKEN", None, None, max_retries=3, initial_backoff_seconds=10.0, sleep=sleeps.append
            )

        stderr_output = captured_stderr.getvalue()

        # Verify we slept twice (between attempts 1-2 and 2-3)
        # With jitter=1.0, backoff sequence is: 10, 20
        assert sleeps == [10.0, 20.0]

        # First log: 0s elapsed (before first sleep)
        assert "total wait so far: 0s" in stderr_output
        # Second log: 10s elapsed (after first sleep of 10s)
        assert "total wait so far: 10s" in stderr_output

        # Error message should show total elapsed time (10 + 20 = 30s)
        error_msg = str(exc_info.value)
        assert "30s elapsed" in error_msg or "30.0s elapsed" in error_msg
    finally:
        flex_probe.request_xml = original_request_xml
        flex_probe.random.uniform = original_uniform
        sys.stderr = original_stderr
