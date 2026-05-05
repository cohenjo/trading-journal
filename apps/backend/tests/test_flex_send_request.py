"""Tests for IBKR Flex SendRequest URL construction."""

from __future__ import annotations

from datetime import date
from typing import Any
from xml.etree.ElementTree import fromstring

import pytest

from scripts.flex_probe import QueryConfig, send_flex_request


@pytest.fixture()
def stub_request_xml(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_request_xml(url: str, params: dict[str, str]) -> Any:
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

    def fake_request_xml(url: str, params: dict[str, str]) -> Any:
        calls.append(dict(params))
        return responses.pop(0)

    sleeps: list[float] = []

    monkeypatch.setattr("scripts.flex_probe.request_xml", fake_request_xml)
    config = QueryConfig(name="trades", query_id="1496910")
    ref = send_flex_request(config, "TOKEN", date(2024, 1, 1), date(2024, 12, 31), sleep=sleeps.append)
    assert ref == "OK"
    assert len(calls) == 2
    assert sleeps == [15.0]


def test_send_flex_request_raises_after_exhausting_1001_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    """Persistent 1001 surfaces a clear error, not a silent loop."""

    failure = fromstring(
        "<FlexStatementResponse><Status>Fail</Status>"
        "<ErrorCode>1001</ErrorCode>"
        "<ErrorMessage>Throttled</ErrorMessage>"
        "</FlexStatementResponse>"
    )
    monkeypatch.setattr("scripts.flex_probe.request_xml", lambda *_a, **_k: failure)
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
