"""Test fixtures for CC pipeline tests.

Provides the ``seeded_session`` fixture that seeds the minimum set of
``ExpenseCategory`` rows the categorization engine needs, plus helpers for
building synthetic parsed transactions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session

from app.schema.expenses import ExpenseCategory
from app.services.expenses.categorize import _invalidate_category_cache


# ---------------------------------------------------------------------------
# Synthetic ParsedTransaction (no CC-2 dependency)
# ---------------------------------------------------------------------------


@dataclass
class _SyntheticTxn:
    """Minimal stand-in for CC-2's ParsedTransaction.

    Satisfies the ParsedTransaction protocol used by CategoryResolver.
    Tests build these directly so they have no dependency on pdfplumber or
    the CC-2 parsers that are still in-flight.
    """

    merchant_normalized: str
    merchant_raw: str = ""
    sector_raw: Optional[str] = None


# ---------------------------------------------------------------------------
# Category seed data
# ---------------------------------------------------------------------------

# (slug, parent_slug_or_None, is_transfer) triples for all categories the
# categorization tests need.  Keep in sync with category_rules.yaml slugs.
_CATEGORY_SEED = [
    # Top-level
    ("groceries", None, False),
    ("restaurants", None, False),
    ("health", None, False),
    ("utilities", None, False),
    ("travel", None, False),
    ("shopping", None, False),
    ("kids-education", None, False),
    ("financial", None, False),
    # MIGRATED: fuel → transportation-fuel (2026-05-30)
    ("transportation", None, False),
    ("transfers", None, True),
    ("other", None, False),
    # health subcategories
    ("health-pharmacy", "health", False),
    ("health-medical", "health", False),
    ("health-fitness", "health", False),
    # utilities subcategories
    ("utilities-internet-tv", "utilities", False),
    ("utilities-phone", "utilities", False),
    ("utilities-streaming", "utilities", False),
    # restaurants subcategories
    ("restaurants-delivery", "restaurants", False),
    ("restaurants-fast-food", "restaurants", False),
    ("restaurants-dine-in", "restaurants", False),
    # financial subcategories
    ("financial-insurance", "financial", False),
    ("financial-government", "financial", False),
    ("financial-fees", "financial", False),
    # travel subcategories
    ("travel-flights", "travel", False),
    ("travel-hotels", "travel", False),
    ("travel-parking", "travel", False),
    # transportation subcategories
    ("transportation-fuel", "transportation", False),
    ("transportation-public-transit", "transportation", False),
    ("transportation-insurance", "transportation", False),
    ("transportation-maintenance", "transportation", False),
    ("transportation-registration", "transportation", False),
    # shopping subcategories
    ("shopping-clothing", "shopping", False),
    ("shopping-electronics", "shopping", False),
    ("shopping-online", "shopping", False),
    ("shopping-beauty", "shopping", False),
    # kids-education subcategories
    ("kids-online-learning", "kids-education", False),
    ("kids-activities", "kids-education", False),
    # transfers subcategories
    ("transfers-paybox", "transfers", True),
    ("transfers-family", "transfers", True),
    # groceries has no subcategories
]


def seed_expense_categories(session: Session) -> dict[str, UUID]:
    """Insert ExpenseCategory rows and return slug → UUID mapping."""
    slug_to_id: dict[str, UUID] = {}

    # First pass: insert top-level categories (parent_id=None)
    for slug, parent_slug, is_transfer in _CATEGORY_SEED:
        if parent_slug is None:
            cat_id = uuid4()
            slug_to_id[slug] = cat_id
            session.add(
                ExpenseCategory(
                    id=cat_id,
                    slug=slug,
                    name=slug.replace("-", " ").title(),
                    name_he=slug,  # placeholder Hebrew — not needed for unit tests
                    is_transfer=is_transfer,
                )
            )
    session.flush()

    # Second pass: insert subcategories (parent_id now known)
    for slug, parent_slug, is_transfer in _CATEGORY_SEED:
        if parent_slug is not None:
            cat_id = uuid4()
            slug_to_id[slug] = cat_id
            session.add(
                ExpenseCategory(
                    id=cat_id,
                    parent_id=slug_to_id[parent_slug],
                    slug=slug,
                    name=slug.replace("-", " ").title(),
                    name_he=slug,
                    is_transfer=is_transfer,
                )
            )
    session.commit()
    return slug_to_id


# ---------------------------------------------------------------------------
# Pytest fixture
# ---------------------------------------------------------------------------


@pytest.fixture()
def seeded_session(session: Session) -> tuple[Session, dict[str, UUID]]:
    """Return (session, slug_map) with ExpenseCategory rows pre-seeded.

    Also invalidates the module-level category cache so the resolver queries
    the freshly seeded in-memory SQLite DB rather than any stale cached data.
    """
    _invalidate_category_cache()
    slug_map = seed_expense_categories(session)
    return session, slug_map
