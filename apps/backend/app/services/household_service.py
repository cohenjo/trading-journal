from uuid import UUID
from typing import Optional
from sqlmodel import Session, select

from app.schema.household_models import HouseholdMember


def get_user_household_id(db: Session, user_id: UUID) -> Optional[UUID]:
    """Get the household_id for the given user.
    
    Returns the household_id of the first active membership found.
    If the user is a member of multiple households, returns the first one.
    """
    statement = (
        select(HouseholdMember.household_id)
        .where(HouseholdMember.user_id == user_id)
        .where(HouseholdMember.left_at.is_(None))
        .limit(1)
    )
    result = db.exec(statement).first()
    return result
