from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from typing import Optional
from datetime import date, timedelta
from app.dal.database import get_session
from app.data.bonds_mock import get_current_bonds, add_bond, BondHolding
from app.schema.ladder_models import (
    LadderBond,
    LadderRung,
    DistributionRow,
    IncomePoint,
    rung_date_range,
    rung_id_for_year,
    rung_base_for_year,
)
from app.utils.bond_cashflows import generate_all_cashflows

router = APIRouter()

# Simple in-memory store for ladder rung targets (per server process).
_RUNG_TARGETS: dict[str, float] = {}

@router.get("/ladder/overview")
def get_ladder_overview(session: Session = Depends(get_session)):
    """Return mock ladder overview: rungs and bonds based on mock bond holdings."""

    bonds_raw = get_current_bonds()

    if not bonds_raw:
        return {"rungs": [], "bonds": []}

    min_year = min(b.maturity_date.year for b in bonds_raw)
    max_year = max(b.maturity_date.year for b in bonds_raw)

    # Anchor the ladder at 2034 so we have a common starting point
    # regardless of current holdings. We only create 1-year rungs now,
    # and frontend zoom levels aggregate these atomic rungs into 3- and
    # 5-year views.
    BASE_YEAR = 2034
    start_year = min(BASE_YEAR, min_year)
    # Extend the ladder with shoulder rungs beyond the last maturity so
    # multi-year aggregates (e.g. 5-year blocks) always have future
    # rungs to distribute targets into.
    SHOULDER_YEARS = 4
    end_year = max_year + SHOULDER_YEARS

    rungs: dict[str, LadderRung] = {}
    DEFAULT_TARGET = 20_000.0
    for year in range(start_year, end_year + 1):
        base_year = rung_base_for_year(year)
        start, end = rung_date_range(base_year)
        key = str(base_year)
        if key not in rungs:
            target_amount = _RUNG_TARGETS.get(key, DEFAULT_TARGET)
            rungs[key] = LadderRung(
                id=key,
                year=base_year,
                start_date=start,
                end_date=end,
                target_amount=target_amount,
                current_amount=0.0,
            )

    ladder_bonds: list[LadderBond] = []
    for b in bonds_raw:
        # Each calendar year is its own rung; cashflow helpers use the same
        # rung_id_for_year so income endpoints stay consistent.
        rung_id = rung_id_for_year(b.maturity_date.year)
        if rung_id not in rungs:
            base_year = int(rung_id)
            start, end = rung_date_range(base_year)
            target_amount = _RUNG_TARGETS.get(rung_id, DEFAULT_TARGET)
            rungs[rung_id] = LadderRung(
                id=rung_id,
                year=base_year,
                start_date=start,
                end_date=end,
                target_amount=target_amount,
                current_amount=0.0,
            )

        rungs[rung_id].current_amount += b.face_value

        ladder_bonds.append(
            LadderBond(
                id=b.id,
                ticker=b.ticker,
                issuer=b.issuer,
                currency=b.currency,
                face_value=b.face_value,
                coupon_rate=b.coupon_rate,
                coupon_frequency=b.coupon_frequency,
                maturity_date=b.maturity_date,
                rung_id=rung_id,
            )
        )

    rungs_list = sorted(rungs.values(), key=lambda r: r.year)

    return {"rungs": rungs_list, "bonds": ladder_bonds}


@router.put("/ladder/rungs/{rung_id}")
def update_ladder_rung_target(rung_id: str, payload: dict):
    """Update the target amount for a given rung.

    This is a simple in-memory update for now, keyed by rung_id.
    """

    target_amount = payload.get("target_amount")
    if target_amount is None:
        raise HTTPException(status_code=400, detail="target_amount is required")

    try:
        target_val = float(target_amount)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="target_amount must be a number")

    _RUNG_TARGETS[rung_id] = target_val
    return {"rung_id": rung_id, "target_amount": target_val}


@router.get("/ladder/income")
def get_ladder_income(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    session: Session = Depends(get_session),
):
    """Return mock expected income series and distributions from bond cashflows."""

    today = date.today()

    if from_date is None:
        start = today
    else:
        start = date.fromisoformat(from_date)

    if to_date is None:
        end = start + timedelta(days=365 * 30)
    else:
        end = date.fromisoformat(to_date)

    bonds = get_current_bonds()
    bond_by_id = {b.id: b for b in bonds}

    cashflows = [
        cf
        for cf in generate_all_cashflows(bonds)
        if start <= cf.date <= end and cf.currency == "USD"
    ]

    distributions: list[DistributionRow] = []
    for cf in cashflows:
        bond = bond_by_id.get(cf.bond_id)
        distributions.append(
            DistributionRow(
                id=cf.id,
                date=cf.date,
                amount=cf.amount,
                currency=cf.currency,
                type=cf.type,
                bond_id=cf.bond_id,
                ticker=bond.ticker if bond is not None else None,
                issuer=bond.issuer if bond is not None else "",
                maturity_date=bond.maturity_date if bond is not None else cf.date,
                rung_id=cf.rung_id,
            )
        )

    # Sort distributions by date ascending for a chronological table on the frontend
    distributions.sort(key=lambda d: d.date)

    # Aggregate raw cashflows by calendar year so the expected income
    # chart can show a lower-resolution, yearly view.
    by_year: dict[int, float] = {}
    for cf in cashflows:
        year = cf.date.year
        by_year.setdefault(year, 0.0)
        by_year[year] += cf.amount

    income_series: list[IncomePoint] = [
        IncomePoint(date=date(year, 1, 1), value=amount)
        for year, amount in sorted(by_year.items())
    ]

    return {"income_series": income_series, "distributions": distributions}


@router.post("/ladder/bonds", response_model=BondHolding)
def create_ladder_bond(payload: dict):
    """Add a new bond holding to the in-memory ladder store.

    This is a mock endpoint for now; validation is intentionally light
    but ensures we have sane core fields so ladder and income views stay
    consistent.
    """

    try:
        bond = BondHolding(**payload)
    except Exception as exc:  # pydantic validation error
        raise HTTPException(status_code=400, detail=f"Invalid bond payload: {exc}")

    if bond.currency != "USD":
        raise HTTPException(status_code=400, detail="Only USD bonds are supported in this mock")

    if bond.maturity_date <= bond.issue_date:
        raise HTTPException(status_code=400, detail="maturity_date must be after issue_date")

    if bond.face_value <= 0:
        raise HTTPException(status_code=400, detail="face_value must be positive")

    # If id not provided or empty, synthesize a simple one from issuer and maturity.
    if not bond.id:
        bond.id = f"bond-{bond.maturity_date.year}-{bond.issuer.lower().replace(' ', '-')}"

    added = add_bond(bond)
    return added
