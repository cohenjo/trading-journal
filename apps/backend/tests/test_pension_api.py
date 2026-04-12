from datetime import date

from sqlmodel import SQLModel, Session, create_engine, select

import copy


from app.api.pension import (
    _safe_float,
    _validate_pension_payload,
    build_pension_dashboard_payload,
    delete_pension,
    extract_pension_payload,
    remove_pension_identity,
    upsert_plan_pension,
    upsert_snapshot_pension,
)
from app.schema.finance_models import FinanceSnapshot
from app.schema.plan_models import Plan


def make_snapshot(snapshot_date: date, items: list[dict]) -> FinanceSnapshot:
    total_investments = sum(item.get("value", 0) for item in items)
    return FinanceSnapshot(
        date=snapshot_date,
        data={
            "items": items,
            "total_savings": 0.0,
            "total_investments": total_investments,
            "total_assets": total_investments,
            "total_liabilities": 0.0,
        },
        net_worth=total_investments,
        total_assets=total_investments,
        total_liabilities=0.0,
    )


def make_plan() -> Plan:
    return Plan(name="Retirement Plan", data={"items": [], "milestones": [], "settings": {}})


def make_session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def test_extract_pension_payload_separates_owner_product_and_account() -> None:
    target_date = date(2025, 9, 30)

    jony_comprehensive = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה מקיפה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 1194873,
        },
        filename="Report_03_2025.pdf",
        target_date=target_date,
    )
    jony_supplementary = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה משלימה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 800545,
        },
        filename="Report_03_2025-comp.pdf",
        target_date=target_date,
    )
    rita_comprehensive = extract_pension_payload(
        owner="Rita",
        result={
            "Pension Product": "פנסיה מקיפה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 1027372,
        },
        filename="Report_03_2025.pdf",
        target_date=target_date,
    )
    rita_gemel = extract_pension_payload(
        owner="Rita",
        result={
            "Pension Product": "קופת גמל",
            "Pension Fund Name": "כלל תמר",
            "Account Number": "10211034",
            "Total Amount": 251516,
        },
        filename="Report_03_2025-gemel-2.pdf",
        target_date=target_date,
    )

    identities = {
        jony_comprehensive["id"],
        jony_supplementary["id"],
        rita_comprehensive["id"],
        rita_gemel["id"],
    }

    assert len(identities) == 4
    assert jony_comprehensive["name"] != jony_supplementary["name"]
    assert rita_gemel["details"]["account_number"] == "10211034"


def test_upsert_snapshot_and_plan_keep_multiple_products_for_same_owner() -> None:
    snapshot = make_snapshot(date(2025, 9, 30), [])
    plan = make_plan()

    comprehensive = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה מקיפה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 1194873,
            "Monthly Deposits": 5460,
        },
        filename="Report_03_2025.pdf",
        target_date=date(2025, 9, 30),
    )
    supplementary = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה משלימה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 800545,
            "Monthly Deposits": 3652,
        },
        filename="Report_03_2025-comp.pdf",
        target_date=date(2025, 9, 30),
    )

    upsert_snapshot_pension(snapshot, comprehensive)
    upsert_snapshot_pension(snapshot, supplementary)
    upsert_plan_pension(plan, comprehensive)
    upsert_plan_pension(plan, supplementary)

    pension_items = [item for item in snapshot.data["items"] if item.get("type") == "Pension"]
    plan_items = [item for item in plan.data["items"] if item.get("sub_category") == "Pension"]

    assert len(pension_items) == 2
    assert len(plan_items) == 2
    assert {item["id"] for item in pension_items} == {comprehensive["id"], supplementary["id"]}

    updated_supplementary = {
        **supplementary,
        "value": 810000,
        "details": {**supplementary["details"], "monthly_contribution": 3927, "deposits": 3927},
    }
    upsert_snapshot_pension(snapshot, updated_supplementary)

    refreshed_item = next(item for item in snapshot.data["items"] if item["id"] == supplementary["id"])
    assert refreshed_item["value"] == 810000
    assert refreshed_item["details"]["monthly_contribution"] == 3927
    assert len([item for item in snapshot.data["items"] if item.get("type") == "Pension"]) == 2


def test_dashboard_payload_only_emits_latest_active_pensions() -> None:
    comprehensive = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה מקיפה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 1194873,
        },
        filename="Report_03_2025.pdf",
        target_date=date(2025, 9, 30),
    )
    supplementary = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה משלימה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 800545,
            "Monthly Deposits": 3652,
        },
        filename="Report_03_2025-comp.pdf",
        target_date=date(2025, 9, 30),
    )

    older_snapshot = make_snapshot(date(2025, 8, 31), [comprehensive, supplementary])
    latest_snapshot = make_snapshot(date(2025, 9, 30), [supplementary])
    plan = make_plan()
    upsert_plan_pension(plan, comprehensive)
    upsert_plan_pension(plan, supplementary)

    dashboard = build_pension_dashboard_payload([older_snapshot, latest_snapshot], plan)

    assert [account["id"] for account in dashboard["accounts"]] == [supplementary["id"]]
    assert all(comprehensive["id"] not in point for point in dashboard["history"])
    assert dashboard["history"][-1][supplementary["id"]] == supplementary["value"]
    assert all(set(point.keys()) <= {"date", supplementary["id"]} for point in dashboard["projections"][:3])


def test_remove_pension_identity_uses_stable_identifier() -> None:
    comprehensive = extract_pension_payload(
        owner="Rita",
        result={
            "Pension Product": "פנסיה מקיפה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 1027372,
        },
        filename="Report_03_2025.pdf",
        target_date=date(2025, 9, 30),
    )
    gemel = extract_pension_payload(
        owner="Rita",
        result={
            "Pension Product": "קופת גמל",
            "Pension Fund Name": "כלל תמר",
            "Account Number": "10211034",
            "Total Amount": 251516,
        },
        filename="Report_03_2025-gemel-2.pdf",
        target_date=date(2025, 9, 30),
    )

    remaining_items = remove_pension_identity([comprehensive, gemel], gemel["id"])

    assert [item["id"] for item in remaining_items] == [comprehensive["id"]]


def test_delete_pension_removes_history_and_plan_entries() -> None:
    session = make_session()

    comprehensive = extract_pension_payload(
        owner="Rita",
        result={
            "Pension Product": "פנסיה מקיפה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 1027372,
        },
        filename="Report_03_2025.pdf",
        target_date=date(2025, 8, 31),
    )
    gemel = extract_pension_payload(
        owner="Rita",
        result={
            "Pension Product": "קופת גמל",
            "Pension Fund Name": "כלל תמר",
            "Account Number": "10211034",
            "Total Amount": 251516,
        },
        filename="Report_03_2025-gemel-2.pdf",
        target_date=date(2025, 8, 31),
    )

    older_snapshot = make_snapshot(date(2025, 8, 31), [comprehensive, gemel])
    latest_snapshot = make_snapshot(date(2025, 9, 30), [comprehensive, gemel])
    plan = make_plan()
    upsert_plan_pension(plan, comprehensive)
    upsert_plan_pension(plan, gemel)

    session.add(older_snapshot)
    session.add(latest_snapshot)
    session.add(plan)
    session.commit()

    response = delete_pension(gemel["id"], db=session)
    persisted_snapshots = session.exec(
        select(FinanceSnapshot).order_by(FinanceSnapshot.date.asc())
    ).all()
    persisted_plan = session.exec(select(Plan)).first()
    dashboard = build_pension_dashboard_payload(persisted_snapshots, persisted_plan)

    assert response == {"status": "success"}
    assert all(gemel["id"] not in point for point in dashboard["history"])
    assert [account["id"] for account in dashboard["accounts"]] == [comprehensive["id"]]
    assert all(item["id"] != gemel["id"] for item in persisted_plan.data["items"])
    for snapshot in persisted_snapshots:
        assert all(item["id"] != gemel["id"] for item in snapshot.data["items"])


# ---------------------------------------------------------------------------
# Regression tests: pension upload propagation & zero-value bugs
# ---------------------------------------------------------------------------


def _make_jony_comprehensive(target_date: date, total: float = 1194873) -> dict:
    return extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה מקיפה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": total,
            "Monthly Deposits": 5460,
        },
        filename="Report.pdf",
        target_date=target_date,
    )


def _make_jony_supplementary(target_date: date, total: float = 800545) -> dict:
    return extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה משלימה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": total,
            "Monthly Deposits": 3652,
        },
        filename="Report-comp.pdf",
        target_date=target_date,
    )


def test_upload_propagates_to_latest_snapshot() -> None:
    """Bug-1 regression: uploading to an older date must also appear in the latest snapshot."""
    report_date = date(2025, 9, 30)
    latest_date = date(2026, 1, 1)

    report_snapshot = make_snapshot(report_date, [])
    latest_snapshot = make_snapshot(latest_date, [])

    payload = _make_jony_comprehensive(report_date)

    # Upsert into the report-date snapshot (always happens)
    upsert_snapshot_pension(report_snapshot, payload)
    # Propagate to the latest snapshot (Hockney's fix)
    upsert_snapshot_pension(latest_snapshot, payload)

    plan = make_plan()
    upsert_plan_pension(plan, payload)

    # Pension must be present in BOTH snapshots
    report_items = [i for i in report_snapshot.data["items"] if i.get("type") == "Pension"]
    latest_items = [i for i in latest_snapshot.data["items"] if i.get("type") == "Pension"]
    assert len(report_items) == 1
    assert len(latest_items) == 1
    assert report_items[0]["id"] == payload["id"]
    assert latest_items[0]["id"] == payload["id"]

    # Dashboard (reads from latest snapshot) must surface the pension
    dashboard = build_pension_dashboard_payload(
        [report_snapshot, latest_snapshot], plan
    )
    account_ids = [a["id"] for a in dashboard["accounts"]]
    assert payload["id"] in account_ids


def test_upload_propagates_to_latest_snapshot_same_date() -> None:
    """When the report date IS the latest snapshot, no double-write or corruption."""
    target_date = date(2025, 9, 30)
    snapshot = make_snapshot(target_date, [])

    payload = _make_jony_comprehensive(target_date)

    # Upsert twice (simulating both report-date and latest being the same)
    upsert_snapshot_pension(snapshot, payload)
    upsert_snapshot_pension(snapshot, payload)

    pension_items = [i for i in snapshot.data["items"] if i.get("type") == "Pension"]
    assert len(pension_items) == 1, "Double-upsert on same snapshot must not duplicate"
    assert pension_items[0]["value"] == payload["value"]


def test_upload_creates_new_snapshot_when_none_exist() -> None:
    """Upload when no snapshots exist at all: snapshot is created with pension data."""
    target_date = date(2025, 9, 30)
    session = make_session()

    # No snapshots in DB at all
    assert session.exec(select(FinanceSnapshot)).first() is None

    snapshot = FinanceSnapshot(
        date=target_date,
        data=copy.deepcopy({"items": [], "total_savings": 0.0, "total_investments": 0.0,
                            "total_assets": 0.0, "total_liabilities": 0.0}),
        net_worth=0.0,
        total_assets=0.0,
        total_liabilities=0.0,
    )
    payload = _make_jony_comprehensive(target_date)
    upsert_snapshot_pension(snapshot, payload)

    session.add(snapshot)
    plan = make_plan()
    upsert_plan_pension(plan, payload)
    session.add(plan)
    session.commit()

    persisted = session.exec(select(FinanceSnapshot)).first()
    assert persisted is not None
    pension_items = [i for i in persisted.data["items"] if i.get("type") == "Pension"]
    assert len(pension_items) == 1
    assert pension_items[0]["id"] == payload["id"]
    assert persisted.net_worth == payload["value"]


def test_dashboard_shows_pension_after_upload_to_older_date() -> None:
    """End-to-end bug-1 scenario: multiple snapshots, upload to older date, dashboard returns it."""
    dates = [date(2025, 6, 30), date(2025, 9, 30), date(2026, 1, 1)]
    snapshots = [make_snapshot(d, []) for d in dates]

    payload = _make_jony_comprehensive(dates[1])  # upload targets Sep 2025

    # Hockney's fix: upsert to both report-date AND latest snapshot
    upsert_snapshot_pension(snapshots[1], payload)
    upsert_snapshot_pension(snapshots[2], payload)

    plan = make_plan()
    upsert_plan_pension(plan, payload)

    dashboard = build_pension_dashboard_payload(snapshots, plan)

    # Dashboard reads from latest snapshot — pension must appear
    account_ids = [a["id"] for a in dashboard["accounts"]]
    assert payload["id"] in account_ids
    assert len(dashboard["accounts"]) == 1

    # History should have the pension in both Sep and Jan points
    sep_point = next(p for p in dashboard["history"] if p["date"] == "2025-09-30")
    jan_point = next(p for p in dashboard["history"] if p["date"] == "2026-01-01")
    assert sep_point[payload["id"]] == payload["value"]
    assert jan_point[payload["id"]] == payload["value"]


def test_zero_value_pension_warning() -> None:
    """Bug-2 documentation: if Total Amount is 0 but sub-fields are non-zero, record the behavior."""
    payload = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה משלימה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 0,
            "Monthly Deposits": 3652,
            "Earnings": 12500,
            "Fees": 450,
        },
        filename="Report-comp.pdf",
        target_date=date(2025, 9, 30),
    )

    assert payload["value"] == 0.0, "Zero total is preserved as-is"
    # Sub-fields should still be populated even when total is zero
    assert payload["details"]["deposits"] == 3652
    assert payload["details"]["earnings"] == 12500
    assert payload["details"]["fees"] == 450

    # Put in a snapshot and verify it doesn't corrupt net worth
    snapshot = make_snapshot(date(2025, 9, 30), [])
    upsert_snapshot_pension(snapshot, payload)
    assert snapshot.net_worth == 0.0


def test_extract_pension_payload_zero_total() -> None:
    """Bug-2 unit test: _safe_float(None) == 0.0 — documents current behavior."""
    assert _safe_float(None) == 0.0
    assert _safe_float("") == 0.0
    assert _safe_float("not-a-number") == 0.0

    payload = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה משלימה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": None,
            "Monthly Deposits": 3652,
        },
        filename="Report-comp.pdf",
        target_date=date(2025, 9, 30),
    )

    assert payload["value"] == 0.0, "None total maps to 0.0 via _safe_float"
    assert payload["details"]["deposits"] == 3652, "Other fields unaffected"


def test_extract_pension_payload_comp_pension() -> None:
    """Verify complementary pension resolves to 'פנסיה משלימה' from fund name hints."""
    # Explicit product field
    payload_explicit = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "פנסיה משלימה",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 800000,
        },
        filename="report.pdf",
        target_date=date(2025, 9, 30),
    )
    assert payload_explicit["details"]["pension_product"] == "פנסיה משלימה"

    # Product resolved from fund name containing "comp" hint
    payload_from_fund = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "",
            "Pension Fund Name": "כלל פנסיה משלימה",
            "Total Amount": 800000,
        },
        filename="report.pdf",
        target_date=date(2025, 9, 30),
    )
    assert payload_from_fund["details"]["pension_product"] == "פנסיה משלימה"

    # Product resolved from filename containing "comp" hint
    payload_from_file = extract_pension_payload(
        owner="You",
        result={
            "Pension Product": "",
            "Pension Fund Name": "כלל פנסיה",
            "Total Amount": 800000,
        },
        filename="report-comp-pension.pdf",
        target_date=date(2025, 9, 30),
    )
    assert payload_from_file["details"]["pension_product"] == "פנסיה משלימה"


def test_two_reports_same_owner_different_products() -> None:
    """Jony uploads both פנסיה מקיפה and פנסיה משלימה — they must get distinct identities."""
    target_date = date(2025, 9, 30)
    comprehensive = _make_jony_comprehensive(target_date)
    supplementary = _make_jony_supplementary(target_date)

    assert comprehensive["id"] != supplementary["id"], "Same owner, different products must have unique IDs"
    assert comprehensive["details"]["pension_product"] == "פנסיה מקיפה"
    assert supplementary["details"]["pension_product"] == "פנסיה משלימה"

    # Both must coexist in the same snapshot and dashboard
    snapshot = make_snapshot(target_date, [])
    upsert_snapshot_pension(snapshot, comprehensive)
    upsert_snapshot_pension(snapshot, supplementary)

    plan = make_plan()
    upsert_plan_pension(plan, comprehensive)
    upsert_plan_pension(plan, supplementary)

    dashboard = build_pension_dashboard_payload([snapshot], plan)
    account_ids = {a["id"] for a in dashboard["accounts"]}
    assert comprehensive["id"] in account_ids
    assert supplementary["id"] in account_ids
    assert len(dashboard["accounts"]) == 2


def test_upload_propagates_to_latest_snapshot_via_extract() -> None:
    report_date = date(2025, 9, 30)
    later_date = date(2025, 12, 31)

    payload = extract_pension_payload(
        owner="Jony",
        result={
            "Pension Product": "פנסיה מקיפה",
            "Pension Fund Name": "Clal Pension",
            "Total Amount": 1194873,
            "Monthly Deposits": 5139,
            "Earnings": 50000,
            "Fees": 3000,
            "Insurance Fees": 500,
            "Report Date": "2025-09-30",
        },
        filename="Report_03_2025.pdf",
        target_date=report_date,
    )

    # Create the report-date snapshot and a later snapshot (simulates existing monthly data).
    report_snapshot = make_snapshot(report_date, [])
    latest_snapshot = make_snapshot(later_date, [])

    # Upsert into the report-date snapshot (the original behaviour).
    upsert_snapshot_pension(report_snapshot, payload)

    # Simulate the new fix: also upsert into the latest snapshot.
    upsert_snapshot_pension(latest_snapshot, payload)

    # Dashboard reads from the *latest* snapshot — pension must appear.
    dashboard = build_pension_dashboard_payload([report_snapshot, latest_snapshot], None)
    account_ids = {a["id"] for a in dashboard["accounts"]}
    assert payload["id"] in account_ids
    assert dashboard["accounts"][0]["value"] == 1194873


def test_validate_pension_payload_warns_on_zero_total_with_nonzero_subfields() -> None:
    """Bug 2: a payload with 0 total but non-zero earnings/fees should produce a warning."""
    payload = {
        "id": "pension::jony::comp",
        "value": 0.0,
        "details": {
            "deposits": 500.0,
            "earnings": 120818.0,
            "fees": 3000.0,
            "insurance_fees": 0.0,
        },
    }
    warnings = _validate_pension_payload(payload)
    assert len(warnings) == 1
    assert "Total Amount is 0" in warnings[0]
    assert "sub-fields are non-zero" in warnings[0]


def test_validate_pension_payload_warns_when_all_zero() -> None:
    """All-zero payload should warn about possible extraction failure."""
    payload = {
        "id": "pension::jony::unknown",
        "value": 0.0,
        "details": {
            "deposits": 0.0,
            "earnings": 0.0,
            "fees": 0.0,
            "insurance_fees": 0.0,
        },
    }
    warnings = _validate_pension_payload(payload)
    assert len(warnings) == 1
    assert "All financial fields are 0" in warnings[0]


def test_validate_pension_payload_no_warning_for_valid_data() -> None:
    """A valid payload with non-zero total should produce no warnings."""
    payload = {
        "id": "pension::jony::comp",
        "value": 800545.0,
        "details": {
            "deposits": 33146.0,
            "earnings": 120818.0,
            "fees": 5000.0,
            "insurance_fees": 800.0,
        },
    }
    warnings = _validate_pension_payload(payload)
    assert warnings == []
