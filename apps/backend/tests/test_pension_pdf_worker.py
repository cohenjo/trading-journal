"""Unit tests for the pension PDF worker handler."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine, select

from app.schema.finance_models import FinanceSnapshot
from app.schema.plan_models import Plan
from app.worker.pension_pdf_parse import handle_pension_pdf_parse

HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000123")


def test_pension_pdf_parse_handler_updates_snapshots_and_plan() -> None:
    """The worker parses a Storage PDF and persists the existing pension rows."""

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with engine.begin() as connection:
        connection.execute(
            text("""
                create table finance_snapshots (
                  household_id char(32) not null,
                  date date not null,
                  data json not null,
                  net_worth numeric(18, 6),
                  total_assets numeric(18, 6),
                  total_liabilities numeric(18, 6),
                  primary key (household_id, date)
                )
                """)
        )
        connection.execute(
            text("""
                create table plans (
                  id integer primary key autoincrement,
                  household_id char(32),
                  name varchar not null,
                  description varchar,
                  data json not null,
                  created_at datetime,
                  updated_at datetime
                )
                """)
        )

    with Session(engine) as session:
        session.add(
            FinanceSnapshot(
                household_id=HOUSEHOLD_ID,
                date=datetime(2026, 1, 31).date(),
                data={
                    "items": [],
                    "total_savings": 0,
                    "total_investments": 0,
                    "total_assets": 0,
                    "total_liabilities": 0,
                },
                net_worth=0,
                total_assets=0,
                total_liabilities=0,
            )
        )
        session.add(
            Plan(household_id=HOUSEHOLD_ID, name="Household plan", data={"items": [], "milestones": [], "settings": {}})
        )
        session.commit()

    def session_factory() -> Session:
        return Session(engine)

    def downloader(storage_path: str, household_id: UUID) -> Path:
        assert storage_path == f"{HOUSEHOLD_ID}/upload.pdf"
        assert household_id == HOUSEHOLD_ID
        return Path("reports/test-fixture.pdf")

    def analyzer(_file_path: str) -> dict[str, object]:
        return {
            "Report Date": "2026-01-31",
            "Name": "Rita",
            "Total Amount": "123,456.78",
            "Monthly Deposits": "1500",
            "Earnings": "2500",
            "Fees": "42",
            "Insurance Fees": "12",
            "Pension Fund Name": "Clal Pension",
            "Pension Product": "פנסיה מקיפה",
            "Account Number": "987654",
        }

    result = handle_pension_pdf_parse(
        {
            "household_id": str(HOUSEHOLD_ID),
            "storage_path": f"{HOUSEHOLD_ID}/upload.pdf",
            "owner": "Rita",
            "filename": "upload.pdf",
        },
        session_factory=session_factory,
        downloader=downloader,
        analyzer=analyzer,
    )

    assert result["status"] == "success"
    assert result["inserted_rows"] == 2
    assert result["snapshot_dates"] == ["2026-01-31"]

    with Session(engine) as session:
        snapshot = session.exec(select(FinanceSnapshot)).one()
        pension_item = snapshot.data["items"][0]
        assert pension_item["owner"] == "Rita"
        assert pension_item["value"] == 123456.78
        assert snapshot.total_assets == Decimal("123456.780000")

        plan = session.exec(select(Plan)).one()
        plan_item = plan.data["items"][0]
        assert plan_item["account_settings"]["type"] == "Pension"
        assert plan_item["account_settings"]["account_number"] == "987654"
