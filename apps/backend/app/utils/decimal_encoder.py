"""Custom JSON encoding for Decimal types in FastAPI responses.

Converts Decimal values to float so API consumers receive numbers (not strings),
preserving backward compatibility with existing frontend code.
"""
from decimal import Decimal
from typing import Any

from fastapi.encoders import ENCODERS_BY_TYPE


def decimal_default(obj: Any) -> Any:
    """JSON serializer fallback that converts Decimal -> float."""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


# Register Decimal -> float with FastAPI's jsonable_encoder so that
# response models containing Decimal fields are serialized as numbers.
ENCODERS_BY_TYPE[Decimal] = float
