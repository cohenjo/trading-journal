"""Issuer fingerprint detection from PDF text.

Detection order matters: CalPayBox MUST be checked before Cal because PayBox
statements share the generic Cal layout but carry an extra ``228899999``
identifier in the header.
"""

from __future__ import annotations

from .base import UnknownIssuer


def detect_issuer(text: str) -> str:
    """Return the issuer slug for *text* (extracted from the first page).

    Returns one of: ``'cal_paybox'``, ``'cal'``, ``'max'``, ``'isracard'``.

    Raises :class:`~app.services.expenses.parsers.base.UnknownIssuer` if no
    issuer can be identified.

    Detection is intentionally order-sensitive — CalPayBox is tested FIRST
    because all PayBox statements also contain Cal markers.
    """
    # CalPayBox: unique 9-digit merchant ID or explicit PayBox branding.
    if "228899999" in text or "סקובייפ" in text:
        return "cal_paybox"

    # Cal General: unique 9-digit merchant ID or billing-sheet marker.
    if "335399999" in text or "ישדוח בויח ףד" in text:
        return "cal"

    # Max: English domain present in every Max statement.
    if "max.co.il" in text:
        return "max"

    # Isracard: English domain or Hebrew brand name or card marker.
    if "isracard.co.il" in text or "טרכארשי" in text or "*3557*" in text:
        return "isracard"

    raise UnknownIssuer(
        "Could not identify issuer from PDF text. "
        "Expected one of: 228899999/סקובייפ (CalPayBox), 335399999 (Cal), "
        "max.co.il (Max), isracard.co.il (Isracard)."
    )
