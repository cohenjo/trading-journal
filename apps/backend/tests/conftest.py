"""Shared test fixtures for backend tests.

This module provides reusable fixtures for database sessions, FastAPI client,
and common test data factories.
"""

import sys
import pathlib
from typing import Generator
from uuid import UUID
import pytest
from sqlalchemy import Column, String, Table, event
from sqlalchemy.engine import Engine
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

# Add parent directory to Python path so 'main' module is importable
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.dal.database import get_session
from app.dependencies import get_current_user
from app.supabase_auth import SupabaseClaims
from app.schema import (  # noqa: F401
    backtest_models,
    bond_models,
    dividend_models,
    finance_models,
    insurance_models,
    ladder_models,
    models,
    options_models,
    plan_models,
    trading_models,
)
from app.schema.household_models import Household, HouseholdMember


TEST_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
TEST_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000101")


Table(
    "users",
    SQLModel.metadata,
    Column("id", String, primary_key=True),
    schema="auth",
    extend_existing=True,
)


@event.listens_for(Engine, "connect")
def _attach_auth_schema(dbapi_connection, _connection_record) -> None:
    """Attach an in-memory auth schema for Supabase FK targets in SQLite tests."""
    if dbapi_connection.__class__.__module__ != "sqlite3":
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("ATTACH DATABASE ':memory:' AS auth")
    except Exception:
        pass
    finally:
        cursor.close()


@pytest.fixture(name="engine")
def engine_fixture():
    """Create an in-memory SQLite engine for testing.

    Uses StaticPool to ensure the same in-memory database is used across
    multiple connections within a test.

    Returns:
        Engine: SQLAlchemy engine configured for testing
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        _seed_household(session)
    return engine


@pytest.fixture(name="session")
def session_fixture(engine) -> Generator[Session, None, None]:
    """Create a database session for testing.

    This fixture creates a new session for each test and automatically
    rolls back changes after the test completes.

    Args:
        engine: The test database engine fixture

    Yields:
        Session: SQLModel session for database operations
    """
    with Session(engine) as session:
        yield session


def _seed_household(session: Session) -> None:
    """Seed the Supabase household membership expected by protected routes."""
    session.add(
        Household(
            id=TEST_HOUSEHOLD_ID,
            name="Test Household",
            created_by=TEST_USER_ID,
        )
    )
    session.add(
        HouseholdMember(
            household_id=TEST_HOUSEHOLD_ID,
            user_id=TEST_USER_ID,
            role="owner",
            invited_by=TEST_USER_ID,
        )
    )
    session.commit()


def _fake_current_user():
    """Return stub Supabase claims for tests that bypass real auth."""
    return SupabaseClaims(
        sub=TEST_USER_ID,
        email="testuser@example.com",
        role="authenticated",
        aud="authenticated",
        exp=4_102_444_800,
    )


@pytest.fixture(name="client")
def client_fixture(session: Session) -> Generator[TestClient, None, None]:
    """Create a FastAPI TestClient with dependency overrides.

    Provides an authenticated test client by default — all protected
    endpoints are accessible without a real JWT.
    """
    from main import app

    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override
    app.dependency_overrides[get_current_user] = _fake_current_user

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


@pytest.fixture(name="unauth_client")
def unauth_client_fixture(session: Session) -> Generator[TestClient, None, None]:
    """Create a FastAPI TestClient WITHOUT auth override.

    Useful for testing that endpoints properly reject unauthenticated requests.
    """
    from main import app

    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override
    # Do NOT override get_current_user — real auth is enforced

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


@pytest.fixture(name="async_client")
async def async_client_fixture(session: Session) -> Generator[AsyncClient, None, None]:
    """Create an async HTTPX client for testing async API endpoints.

    Provides an authenticated async client by default.
    """
    from main import app

    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override
    app.dependency_overrides[get_current_user] = _fake_current_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()
