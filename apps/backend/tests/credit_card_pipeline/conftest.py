"""Pytest fixtures for the CC pipeline test suite.

Imports shared helpers from ``helpers.py`` so test modules can import them
directly while pytest fixtures are also available.
"""

from __future__ import annotations

from typing import Tuple

import pytest
from sqlmodel import Session

from .helpers import (  # relative import — works because __init__.py exists
    seed_expense_categories,
)
from app.services.expenses.categorize import _invalidate_category_cache


@pytest.fixture()
def seeded_session(session: Session) -> Tuple[Session, dict]:
    """Return (session, slug_map) with ExpenseCategory rows pre-seeded.

    Also invalidates the module-level category cache so CategoryResolver
    queries the freshly seeded in-memory SQLite DB.
    """
    _invalidate_category_cache()
    slug_map = seed_expense_categories(session)
    yield session, slug_map
    # Cleanup: invalidate cache after test to prevent leaking between tests
    _invalidate_category_cache()
