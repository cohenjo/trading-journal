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
