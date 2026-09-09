"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.database import check_database_connection, engine
from app.main import app


@pytest.fixture(scope="session")
def client() -> TestClient:
    """HTTP client bound to the app (runs startup/shutdown via context manager)."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def database_available() -> bool:
    """Whether a real PostgreSQL is reachable for this test session."""
    ok, _ = check_database_connection()
    return ok


@pytest.fixture
def requires_database(database_available: bool) -> None:
    """Skip a test when no database is configured, rather than failing it."""
    if not database_available:
        pytest.skip("PostgreSQL is not reachable — skipping integration test")


@pytest.fixture
def db(requires_database: None) -> Generator[Session, None, None]:
    """A session wrapped in a transaction that is always rolled back.

    Each test therefore sees a clean database and leaves nothing behind, without
    the cost of recreating the schema between tests.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, expire_on_commit=False)
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
