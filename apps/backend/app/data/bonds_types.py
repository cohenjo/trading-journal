from datetime import date

from pydantic import BaseModel


class BondHolding(BaseModel):
    id: str
    ticker: str | None = None
    issuer: str
    currency: str
    face_value: float
    coupon_rate: float
    coupon_frequency: str  # "ANNUAL", "SEMI_ANNUAL", "QUARTERLY"
    issue_date: date
    maturity_date: date
