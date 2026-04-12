import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.dal.database import get_session
from app.schema.insurance_models import InsurancePolicy

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/insurance", tags=["insurance"])


class InsurancePolicyCreate(BaseModel):
    owner: str
    type: str
    provider: str
    policy_number: Optional[str] = None
    sum_insured: str
    monthly_premium: Optional[float] = None
    beneficiaries: Optional[str] = None
    expiry_date: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None


class InsurancePolicyUpdate(BaseModel):
    owner: Optional[str] = None
    type: Optional[str] = None
    provider: Optional[str] = None
    policy_number: Optional[str] = None
    sum_insured: Optional[str] = None
    monthly_premium: Optional[float] = None
    beneficiaries: Optional[str] = None
    expiry_date: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None


VALID_TYPES = {"life", "mortgage", "health", "disability", "other"}
VALID_OWNERS = {"You", "Partner"}


def _validate_policy_fields(data: dict) -> None:
    if "type" in data and data["type"] is not None:
        if data["type"] not in VALID_TYPES:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid type '{data['type']}'. Must be one of: {', '.join(sorted(VALID_TYPES))}",
            )
    if "owner" in data and data["owner"] is not None:
        if data["owner"] not in VALID_OWNERS:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid owner '{data['owner']}'. Must be one of: {', '.join(sorted(VALID_OWNERS))}",
            )


@router.get("")
def list_policies(
    owner: Optional[str] = None,
    db: Session = Depends(get_session),
):
    """List all insurance policies, optionally filtered by owner."""
    statement = select(InsurancePolicy)
    if owner:
        statement = statement.where(InsurancePolicy.owner == owner)
    statement = statement.order_by(InsurancePolicy.created_at.desc())
    policies = db.exec(statement).all()
    return {"status": "success", "data": [p.model_dump() for p in policies]}


@router.post("", status_code=201)
def create_policy(
    body: InsurancePolicyCreate,
    db: Session = Depends(get_session),
):
    """Create a new insurance policy."""
    _validate_policy_fields(body.model_dump())
    policy = InsurancePolicy(**body.model_dump())
    db.add(policy)
    db.commit()
    db.refresh(policy)
    logger.info("Created insurance policy %s (%s / %s)", policy.id, policy.owner, policy.type)
    return {"status": "success", "data": policy.model_dump()}


@router.put("/{policy_id}")
def update_policy(
    policy_id: str,
    body: InsurancePolicyUpdate,
    db: Session = Depends(get_session),
):
    """Update fields of an existing insurance policy."""
    policy = db.get(InsurancePolicy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    update_data = body.model_dump(exclude_unset=True)
    _validate_policy_fields(update_data)

    for key, value in update_data.items():
        setattr(policy, key, value)
    policy.updated_at = datetime.utcnow()

    db.add(policy)
    db.commit()
    db.refresh(policy)
    logger.info("Updated insurance policy %s", policy.id)
    return {"status": "success", "data": policy.model_dump()}


@router.delete("/{policy_id}")
def delete_policy(
    policy_id: str,
    db: Session = Depends(get_session),
):
    """Delete an insurance policy by ID."""
    policy = db.get(InsurancePolicy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    db.delete(policy)
    db.commit()
    logger.info("Deleted insurance policy %s", policy_id)
    return {"status": "success", "data": {"id": policy_id}}
