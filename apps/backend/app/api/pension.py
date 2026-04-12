import copy
import logging
import re
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

import dateutil.relativedelta
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import Session, select

from app.dal.database import get_session
from app.schema.finance_models import FinanceSnapshot
from app.schema.plan_models import Plan
from app.utils.copilot_analyzer import analyze_report

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pension", tags=["pension"])

EMPTY_SNAPSHOT_DATA = {
    "items": [],
    "total_savings": 0.0,
    "total_investments": 0.0,
    "total_assets": 0.0,
    "total_liabilities": 0.0,
}
PENSION_PRODUCT_HINTS = (
    ("פנסיה מקיפה", ("פנסיה מקיפה", "makif", "מקיפה", "comprehensive")),
    ("פנסיה משלימה", ("פנסיה משלימה", "mashlima", "משלימה", "comp")),
    ("קופת גמל", ("קופת גמל", "gemel", "גמל", "תגמולים")),
)
SPOUSE_OWNER_ALIASES = {"spouse", "rita"}
PENSION_ID_PREFIX = "pension::"


def _safe_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, str):
        try:
            return float(value.replace(",", "").strip())
        except ValueError:
            return 0.0
    return float(value)


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _slugify_pension_part(value: str) -> str:
    normalized = re.sub(r"[^\w\s-]", "", _safe_text(value).casefold(), flags=re.UNICODE)
    normalized = re.sub(r"[\s/]+", "-", normalized, flags=re.UNICODE)
    return normalized.strip("-") or "unknown"


def _infer_pension_product(value: str) -> Optional[str]:
    lowered_value = value.casefold()
    for canonical_name, hints in PENSION_PRODUCT_HINTS:
        if any(hint.casefold() in lowered_value for hint in hints):
            return canonical_name
    return None


def resolve_pension_product(
    result: dict[str, Any],
    filename: Optional[str] = None,
) -> str:
    product_candidates = [
        _safe_text(result.get("Pension Product")),
        _safe_text(result.get("Product Name")),
        _safe_text(result.get("Product Type")),
        _safe_text(result.get("Fund Type")),
    ]
    fallback_candidates = [
        _safe_text(result.get("Pension Fund Name")),
        _safe_text(filename),
    ]

    for candidate in product_candidates + fallback_candidates:
        if not candidate:
            continue
        canonical_name = _infer_pension_product(candidate)
        if canonical_name:
            return canonical_name

    for candidate in product_candidates:
        if candidate:
            return candidate

    return "Unknown Product"


def resolve_pension_fund_name(result: dict[str, Any]) -> str:
    return (
        _safe_text(result.get("Pension Fund Name"))
        or _safe_text(result.get("Fund Name"))
        or _safe_text(result.get("Provider"))
        or "Unknown Pension Fund"
    )


def resolve_pension_account_number(result: dict[str, Any]) -> Optional[str]:
    for key in ("Account Number", "Policy Number", "Product Number", "Fund Number"):
        digits = re.sub(r"\D+", "", _safe_text(result.get(key)))
        if digits:
            return digits
    return None


def build_pension_identity(
    owner: str,
    product_name: str,
    fund_name: str,
    account_number: Optional[str] = None,
) -> str:
    identity_parts = [
        PENSION_ID_PREFIX.rstrip(":"),
        _slugify_pension_part(owner),
        _slugify_pension_part(product_name),
    ]
    identity_parts.append(account_number or _slugify_pension_part(fund_name))
    return "::".join(identity_parts)


def build_pension_display_name(product_name: str, fund_name: str) -> str:
    if not fund_name or fund_name == product_name:
        return product_name
    return f"{product_name} — {fund_name}"


def parse_report_date(report_date_str: Optional[str]) -> date:
    if report_date_str:
        try:
            return datetime.strptime(report_date_str, "%Y-%m-%d").date()
        except ValueError:
            pass
    return date.today()


def extract_pension_payload(
    owner: str,
    result: dict[str, Any],
    filename: Optional[str],
    target_date: date,
) -> dict[str, Any]:
    product_name = resolve_pension_product(result, filename)
    fund_name = resolve_pension_fund_name(result)
    account_number = resolve_pension_account_number(result)
    display_name = build_pension_display_name(product_name, fund_name)
    pension_id = build_pension_identity(owner, product_name, fund_name, account_number)
    deposits = _safe_float(result.get("Monthly Deposits") or result.get("Deposits"))

    return {
        "id": pension_id,
        "category": "Investments",
        "name": display_name,
        "value": _safe_float(result.get("Total Amount")),
        "type": "Pension",
        "owner": owner,
        "inflow_priority": 100,
        "withdrawal_priority": 100,
        "currency": "ILS",
        "details": {
            "pension_identity": pension_id,
            "pension_product": product_name,
            "pension_fund_name": fund_name,
            "pension_display_name": display_name,
            "account_number": account_number,
            "report_date": target_date.isoformat(),
            "deposits": deposits,
            "monthly_contribution": deposits,
            "fees": _safe_float(result.get("Fees")),
            "earnings": _safe_float(result.get("Earnings")),
            "insurance_fees": _safe_float(result.get("Insurance Fees")),
        },
    }


def _validate_pension_payload(payload: dict[str, Any]) -> list[str]:
    """Return warnings for suspicious pension data (e.g. 0 total with non-zero sub-fields)."""
    warnings: list[str] = []
    value = payload.get("value", 0.0)
    details = payload.get("details", {})
    deposits = _safe_float(details.get("deposits"))
    earnings = _safe_float(details.get("earnings"))
    fees = _safe_float(details.get("fees"))
    insurance_fees = _safe_float(details.get("insurance_fees"))

    has_nonzero_sub = any(v != 0.0 for v in (deposits, earnings, fees, insurance_fees))
    if value == 0.0 and has_nonzero_sub:
        msg = (
            f"Total Amount is 0 but sub-fields are non-zero "
            f"(deposits={deposits}, earnings={earnings}, fees={fees}, "
            f"insurance_fees={insurance_fees}). "
            f"The PDF analyzer may have failed to extract the balance."
        )
        warnings.append(msg)
        logger.warning("Suspicious pension payload for %s: %s", payload.get("id"), msg)
    elif value == 0.0 and not has_nonzero_sub:
        msg = "All financial fields are 0. The PDF analyzer may have failed to read this report."
        warnings.append(msg)
        logger.warning("Empty pension payload for %s: %s", payload.get("id"), msg)
    return warnings


def get_pension_identity(item: dict[str, Any]) -> Optional[str]:
    details = item.get("details") or {}
    account_settings = item.get("account_settings") or {}
    raw_id = _safe_text(item.get("id"))
    if raw_id.startswith(PENSION_ID_PREFIX):
        return raw_id

    stored_identity = _safe_text(details.get("pension_identity"))
    if not stored_identity:
        stored_identity = _safe_text(account_settings.get("pension_identity"))
    if stored_identity:
        return stored_identity

    owner = _safe_text(item.get("owner"))
    product_name = _safe_text(details.get("pension_product"))
    fund_name = _safe_text(details.get("pension_fund_name")) or _safe_text(item.get("name"))
    account_number = _safe_text(details.get("account_number")) or None
    if not owner or not product_name:
        return None

    return build_pension_identity(owner, product_name, fund_name, account_number)


def _matches_pension_identity(item: dict[str, Any], pension_id: str) -> bool:
    return get_pension_identity(item) == pension_id


def _matches_pension_record(item: dict[str, Any], payload: dict[str, Any]) -> bool:
    if _matches_pension_identity(item, payload["id"]):
        return True

    details = item.get("details") or {}
    legacy_names = {
        _safe_text(item.get("name")),
        _safe_text(details.get("pension_fund_name")),
        _safe_text(details.get("pension_display_name")),
    }
    payload_fund_name = payload["details"]["pension_fund_name"]
    payload_display_name = payload["details"]["pension_display_name"]
    payload_product_name = payload["details"]["pension_product"]
    payload_account_number = payload["details"].get("account_number")
    item_account_number = _safe_text(details.get("account_number")) or None

    if _safe_text(item.get("owner")) != payload["owner"]:
        return False

    if payload_account_number or item_account_number:
        return bool(payload_account_number) and item_account_number == payload_account_number

    return (
        _safe_text(details.get("pension_product")) in {"", payload_product_name}
        and (
            payload_fund_name in legacy_names
            or payload_display_name in legacy_names
        )
    )


def _apply_pension_metadata(item: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    item["id"] = payload["id"]
    item["owner"] = payload["owner"]
    item["name"] = payload["name"]
    details = item.setdefault("details", {})
    details.update(payload["details"])
    return item


def _recalculate_snapshot(snapshot: FinanceSnapshot) -> None:
    items = snapshot.data.get("items", [])
    total_savings = sum(
        _safe_float(item.get("value"))
        for item in items
        if item.get("category") == "Savings"
    )
    total_investments = sum(
        _safe_float(item.get("value"))
        for item in items
        if item.get("category") == "Investments"
    )
    assets_category_total = sum(
        _safe_float(item.get("value"))
        for item in items
        if item.get("category") == "Assets"
    )
    total_liabilities = sum(
        _safe_float(item.get("value"))
        for item in items
        if item.get("category") == "Liabilities"
    )

    calculated_total_assets = total_savings + total_investments + assets_category_total
    snapshot.data["items"] = items
    snapshot.data["total_savings"] = total_savings
    snapshot.data["total_investments"] = total_investments
    snapshot.data["total_assets"] = calculated_total_assets
    snapshot.data["total_liabilities"] = total_liabilities
    snapshot.net_worth = calculated_total_assets - total_liabilities
    snapshot.total_assets = calculated_total_assets
    snapshot.total_liabilities = total_liabilities


def upsert_snapshot_pension(snapshot: FinanceSnapshot, payload: dict[str, Any]) -> None:
    items = snapshot.data.get("items", [])
    existing_item = next(
        (
            item
            for item in items
            if item.get("type") == "Pension" and _matches_pension_record(item, payload)
        ),
        None,
    )

    if existing_item:
        existing_item["value"] = payload["value"]
        _apply_pension_metadata(existing_item, payload)
    else:
        items.append(copy.deepcopy(payload))

    snapshot.data["items"] = items
    _recalculate_snapshot(snapshot)


def upsert_plan_pension(plan: Plan, payload: dict[str, Any]) -> None:
    plan_items = plan.data.get("items", [])
    existing_item = next(
        (
            item
            for item in plan_items
            if (item.get("account_settings") or {}).get("type") == "Pension"
            and _matches_pension_record(item, payload)
        ),
        None,
    )

    if existing_item:
        existing_item["id"] = payload["id"]
        existing_item["owner"] = payload["owner"]
        existing_item["name"] = payload["name"]
        existing_item["value"] = payload["value"]
        existing_item.setdefault("details", {}).update(payload["details"])
        existing_item.setdefault("account_settings", {}).update(
            {
                "type": "Pension",
                "pension_identity": payload["id"],
                "product_name": payload["details"]["pension_product"],
                "fund_name": payload["details"]["pension_fund_name"],
                "account_number": payload["details"].get("account_number"),
            }
        )
    else:
        plan_items.append(
            {
                "id": payload["id"],
                "name": payload["name"],
                "category": "Asset",
                "sub_category": "Pension",
                "owner": payload["owner"],
                "currency": payload["currency"],
                "value": payload["value"],
                "growth_rate": 0.05,
                "frequency": "Yearly",
                "account_settings": {
                    "type": "Pension",
                    "pension_identity": payload["id"],
                    "product_name": payload["details"]["pension_product"],
                    "fund_name": payload["details"]["pension_fund_name"],
                    "account_number": payload["details"].get("account_number"),
                },
                "details": copy.deepcopy(payload["details"]),
            }
        )

    plan.data["items"] = plan_items


def _is_spouse_owner(owner: str) -> bool:
    return _safe_text(owner).casefold() in SPOUSE_OWNER_ALIASES


def _owner_birth_year(settings: dict[str, Any], owner: str) -> int:
    primary_birth_year = int(
        settings.get("birthYear")
        or settings.get("primaryUser", {}).get("birthYear", 1980)
    )
    if _is_spouse_owner(owner):
        return int(settings.get("spouse", {}).get("birthYear", primary_birth_year))
    return primary_birth_year


def _latest_active_pensions(
    snapshots: list[FinanceSnapshot],
    plan: Optional[Plan],
) -> dict[str, dict[str, Any]]:
    if not snapshots:
        return {}

    plan_by_identity = {}
    if plan:
        for item in plan.data.get("items", []):
            if (item.get("account_settings") or {}).get("type") != "Pension":
                continue
            identity = get_pension_identity(item)
            if identity:
                plan_by_identity[identity] = item

    current_accounts = {}
    latest_snapshot = snapshots[-1]
    for pension_item in latest_snapshot.data.get("items", []):
        if pension_item.get("type") != "Pension":
            continue

        identity = get_pension_identity(pension_item)
        if not identity:
            continue

        details = dict(pension_item.get("details") or {})
        plan_item = plan_by_identity.get(identity)
        if plan_item:
            account_settings = plan_item.get("account_settings") or {}
            for field in ("starting_age", "draw_income", "divide_rate"):
                if field in account_settings and field not in details:
                    details[field] = account_settings[field]

        current_accounts[identity] = {
            "id": identity,
            "series_id": identity,
            "owner": _safe_text(pension_item.get("owner")) or "Unknown",
            "name": _safe_text(details.get("pension_display_name"))
            or _safe_text(pension_item.get("name"))
            or "Unknown Pension",
            "product_name": _safe_text(details.get("pension_product")) or "Unknown Product",
            "fund_name": _safe_text(details.get("pension_fund_name")) or "Unknown Pension Fund",
            "display_name": _safe_text(details.get("pension_display_name"))
            or _safe_text(pension_item.get("name"))
            or "Unknown Pension",
            "value": _safe_float(pension_item.get("value")),
            "details": details,
        }

    return current_accounts


def build_pension_dashboard_payload(
    snapshots: list[FinanceSnapshot],
    plan: Optional[Plan],
) -> dict[str, Any]:
    current_accounts = _latest_active_pensions(snapshots, plan)
    active_series_ids = list(current_accounts.keys())
    history_points: list[dict[str, Any]] = []
    historical_accounts: dict[str, float] = {}

    for snapshot in snapshots:
        point = {"date": snapshot.date.strftime("%Y-%m-%d")}
        for pension_item in snapshot.data.get("items", []):
            if pension_item.get("type") != "Pension":
                continue
            series_id = get_pension_identity(pension_item)
            if series_id not in current_accounts:
                continue
            value = _safe_float(pension_item.get("value"))
            point[series_id] = value
            historical_accounts[series_id] = value

        for series_id, value in historical_accounts.items():
            if series_id in current_accounts and series_id not in point:
                point[series_id] = value

        history_points.append(point)

    projections = []
    milestones = []
    retirement_years = {"You": 2045, "Rita": 2045, "Spouse": 2045}
    user_settings = plan.data.get("settings", {}) if plan else {}

    if plan:
        for milestone in plan.data.get("milestones", []):
            if milestone.get("type") == "Retirement" or "Retirement" in milestone.get(
                "name", ""
            ):
                owner = milestone.get("owner", "You")
                milestone_date = milestone.get("date")
                if milestone_date:
                    try:
                        milestone_year = datetime.strptime(
                            milestone_date[:10], "%Y-%m-%d"
                        ).year
                    except ValueError:
                        continue
                    retirement_years[owner] = milestone_year
                    milestones.append(
                        {
                            "owner": owner,
                            "name": milestone.get("name"),
                            "date": milestone_date,
                            "year": milestone_year,
                        }
                    )
                elif milestone.get("details", {}).get("age") is not None:
                    target_age = int(milestone["details"]["age"])
                    milestone_year = _owner_birth_year(user_settings, owner) + target_age
                    retirement_years[owner] = milestone_year
                    milestones.append(
                        {
                            "owner": owner,
                            "name": milestone.get("name"),
                            "date": f"{milestone_year}-01-01",
                            "year": milestone_year,
                        }
                    )

    if history_points and active_series_ids:
        last_date = datetime.strptime(history_points[-1]["date"], "%Y-%m-%d").date()
        current_date = last_date + dateutil.relativedelta.relativedelta(months=1)
        max_year = max(retirement_years.values()) if retirement_years else last_date.year + 20
        monthly_rate = 0.0386 / 12
        current_projection_values = {
            series_id: _safe_float(history_points[-1].get(series_id, current_accounts[series_id]["value"]))
            for series_id in active_series_ids
        }

        while current_date.year <= max_year:
            point = {"date": current_date.strftime("%Y-%m-%d")}
            for series_id in active_series_ids:
                account = current_accounts[series_id]
                owner = account.get("owner", "You")
                starting_age = int(account.get("details", {}).get("starting_age", 67))
                retirement_year = max(
                    _owner_birth_year(user_settings, owner) + starting_age,
                    retirement_years.get(owner, retirement_years.get("You", 2045)),
                )
                if current_date.year <= retirement_year:
                    deposits = _safe_float(
                        account.get("details", {}).get("deposits")
                        or account.get("details", {}).get("monthly_contribution")
                    )
                    current_projection_values[series_id] = (
                        current_projection_values[series_id] * (1 + monthly_rate)
                        + deposits
                    )
                point[series_id] = current_projection_values[series_id]
            projections.append(point)
            current_date += dateutil.relativedelta.relativedelta(months=1)

    return {
        "status": "success",
        "history": history_points,
        "projections": projections,
        "accounts": list(current_accounts.values()),
        "milestones": milestones,
    }


def remove_pension_identity(
    items: list[dict[str, Any]],
    pension_id: str,
) -> list[dict[str, Any]]:
    return [item for item in items if not _matches_pension_identity(item, pension_id)]


@router.post("/upload")
async def upload_pension_report(
    owner: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
):
    """Upload and analyze a pension report PDF, updating snapshots and plans."""
    try:
        root_dir = Path(__file__).parent.parent.parent.parent.parent
        reports_dir = root_dir / "reports" / owner
        reports_dir.mkdir(parents=True, exist_ok=True)

        file_path = reports_dir / file.filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        result = await analyze_report(str(file_path))
        target_date = parse_report_date(result.get("Report Date"))
        payload = extract_pension_payload(owner, result, file.filename, target_date)

        upload_warnings = _validate_pension_payload(payload)

        snapshot = db.exec(
            select(FinanceSnapshot).where(FinanceSnapshot.date == target_date)
        ).first()
        snapshot_updated = False

        if not snapshot:
            closest_past = db.exec(
                select(FinanceSnapshot)
                .where(FinanceSnapshot.date < target_date)
                .order_by(FinanceSnapshot.date.desc())
                .limit(1)
            ).first()

            if closest_past:
                new_data = copy.deepcopy(closest_past.data) if closest_past.data else copy.deepcopy(EMPTY_SNAPSHOT_DATA)
                snapshot = FinanceSnapshot(
                    date=target_date,
                    data=new_data,
                    net_worth=closest_past.net_worth,
                    total_assets=closest_past.total_assets,
                    total_liabilities=closest_past.total_liabilities,
                )
            else:
                snapshot = FinanceSnapshot(
                    date=target_date,
                    data=copy.deepcopy(EMPTY_SNAPSHOT_DATA),
                    net_worth=0.0,
                    total_assets=0.0,
                    total_liabilities=0.0,
                )

        if snapshot:
            upsert_snapshot_pension(snapshot, payload)
            flag_modified(snapshot, "data")
            db.add(snapshot)
            snapshot_updated = True

        # Bug fix: also propagate to the latest snapshot so the pension
        # appears on the dashboard immediately, even when later snapshots exist.
        latest_snapshot = db.exec(
            select(FinanceSnapshot)
            .order_by(FinanceSnapshot.date.desc())
            .limit(1)
        ).first()
        latest_snapshot_updated = False
        if latest_snapshot and latest_snapshot.date != target_date:
            upsert_snapshot_pension(latest_snapshot, payload)
            flag_modified(latest_snapshot, "data")
            db.add(latest_snapshot)
            latest_snapshot_updated = True

        plan = db.exec(select(Plan).limit(1)).first()
        plan_updated = False
        if plan:
            upsert_plan_pension(plan, payload)
            flag_modified(plan, "data")
            db.add(plan)
            plan_updated = True

        if snapshot_updated or plan_updated or latest_snapshot_updated:
            db.commit()
            if snapshot_updated:
                db.refresh(snapshot)
            if latest_snapshot_updated:
                db.refresh(latest_snapshot)
            if plan_updated:
                db.refresh(plan)

        result["Pension Product"] = payload["details"]["pension_product"]
        result["Pension Fund Name"] = payload["details"]["pension_fund_name"]
        result["Pension Display Name"] = payload["details"]["pension_display_name"]
        result["Account Number"] = payload["details"].get("account_number")

        response = {
            "status": "success",
            "result": result,
            "snapshot_updated": snapshot_updated,
            "latest_snapshot_updated": latest_snapshot_updated,
            "plan_updated": plan_updated,
        }
        if upload_warnings:
            response["warnings"] = upload_warnings
        return response
    except Exception as exc:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/dashboard")
def get_pension_dashboard(db: Session = Depends(get_session)):
    """Return aggregated pension dashboard with history and plan data."""
    try:
        snapshots = db.exec(select(FinanceSnapshot).order_by(FinanceSnapshot.date.asc())).all()
        plan = db.exec(select(Plan).order_by(Plan.updated_at.desc()).limit(1)).first()
        return build_pension_dashboard_payload(snapshots, plan)
    except Exception as exc:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/{pension_id}")
def delete_pension(pension_id: str, db: Session = Depends(get_session)):
    """Remove a pension from all snapshots and the active plan."""
    try:
        snapshots = db.exec(select(FinanceSnapshot).order_by(FinanceSnapshot.date.asc())).all()
        for snapshot in snapshots:
            items = snapshot.data.get("items", [])
            filtered_items = remove_pension_identity(items, pension_id)
            if len(filtered_items) != len(items):
                snapshot.data["items"] = filtered_items
                _recalculate_snapshot(snapshot)
                flag_modified(snapshot, "data")
                db.add(snapshot)

        plan = db.exec(select(Plan).limit(1)).first()
        if plan:
            plan_items = plan.data.get("items", [])
            filtered_plan_items = remove_pension_identity(plan_items, pension_id)
            if len(filtered_plan_items) != len(plan_items):
                plan.data["items"] = filtered_plan_items
                flag_modified(plan, "data")
                db.add(plan)

        db.commit()
        return {"status": "success"}
    except Exception as exc:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
