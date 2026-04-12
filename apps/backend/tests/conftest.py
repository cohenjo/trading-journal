"""Shared test fixtures for backend tests.

This module provides reusable fixtures for database sessions, FastAPI client,
and common test data factories.
"""

from typing import Generator
import pytest
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

from app.dal.database import get_session
from app.auth.dependencies import get_current_user
from app.schema.user_models import User


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


def _fake_current_user():
    """Return a stub user for tests that bypass real auth."""
    return User(id=1, username="testuser", hashed_password="x", is_active=True)


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
    
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as client:
        yield client
    
    app.dependency_overrides.clear()
