from fastapi import APIRouter, HTTPException
from app.data.bonds_mock import get_current_bonds, BondHolding, update_bond_face_value

router = APIRouter()

@router.get("/holdings", response_model=list[BondHolding])
def list_holdings():
    """Return the full current bond holdings portfolio.

    This is backed by the same in-memory store used for the ladder
    views so quantities stay consistent across ladder and holdings.
    """

    return get_current_bonds()


@router.put("/holdings/{bond_id}", response_model=BondHolding)
def update_holding(bond_id: str, payload: dict):
    """Update selected fields of a bond holding (currently face_value only)."""

    face_value = payload.get("face_value")
    if face_value is None:
        raise HTTPException(status_code=400, detail="face_value is required")

    try:
        fv = float(face_value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="face_value must be a number")

    if fv <= 0:
        raise HTTPException(status_code=400, detail="face_value must be positive")

    updated = update_bond_face_value(bond_id, fv)
    if updated is None:
        raise HTTPException(status_code=404, detail="Bond not found")

    return updated


@router.delete("/holdings/{bond_id}")
def delete_holding(bond_id: str):
    """Remove a bond holding from the in-memory portfolio.

    This keeps ladder and income views consistent since they
    read from the same underlying holdings store.
    """

    bonds = get_current_bonds()
    if not any(b.id == bond_id for b in bonds):
        raise HTTPException(status_code=404, detail="Bond not found")

    from app.data.bonds_xlsx import save_bonds_to_xlsx
    # Filter out the bond and persist the new list.
    remaining = [b for b in bonds if b.id != bond_id]

    # Update the in-memory store used elsewhere.
    from app.data import bonds_mock  # type: ignore

    bonds_mock._BONDS = remaining  # type: ignore[attr-defined]
    save_bonds_to_xlsx(remaining)

    return {"status": "deleted", "id": bond_id}
