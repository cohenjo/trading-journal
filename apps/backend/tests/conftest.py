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


@pytest.fixture(name="client")
def client_fixture(session: Session) -> Generator[TestClient, None, None]:
    """Create a FastAPI TestClient with dependency overrides.
    
    This fixture creates a synchronous test client that uses the test
    database session instead of the production database.
    
    Args:
        session: The test database session fixture
        
    Yields:
        TestClient: FastAPI test client for API endpoint testing
    """
    # Import app here to avoid circular imports and instrumentation issues
    from main import app
    
    def get_session_override():
        return session
    
    app.dependency_overrides[get_session] = get_session_override
    
    with TestClient(app) as client:
        yield client
    
    app.dependency_overrides.clear()


@pytest.fixture(name="async_client")
async def async_client_fixture(session: Session) -> Generator[AsyncClient, None, None]:
    """Create an async HTTPX client for testing async API endpoints.
    
    This fixture creates an asynchronous test client that uses the test
    database session and can handle async operations.
    
    Args:
        session: The test database session fixture
        
    Yields:
        AsyncClient: HTTPX async client for testing
    """
    # Import app here to avoid circular imports and instrumentation issues
    from main import app
    
    def get_session_override():
        return session
    
    app.dependency_overrides[get_session] = get_session_override
    
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as client:
        yield client
    
    app.dependency_overrides.clear()
