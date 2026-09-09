"""Database engine, declarative base and per-request session management."""

from __future__ import annotations

import logging
import os
import sys
import time
from collections.abc import Generator
from pathlib import Path
from typing import Any

from sqlalchemy import MetaData, NullPool, create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)


def _register_libpq_directory() -> None:
    """Windows-only: make ``libpq.dll`` importable for the pure-Python driver.

    ``psycopg[binary]`` bundles its own libpq, but that wheel has no build for
    Python 3.14 yet, so the plain driver is used and must find a system libpq.
    Setting ``PGBIN`` to a PostgreSQL ``bin`` directory avoids having to modify
    PATH for every shell. No-op on other platforms, or when PGBIN is unset.
    """
    if sys.platform != "win32":
        return

    pgbin = (settings.PGBIN or os.environ.get("PGBIN", "")).strip()
    if not pgbin:
        return

    directory = Path(pgbin)
    if not directory.is_dir():
        logger.warning("PGBIN is set to %s but that directory does not exist", pgbin)
        return

    resolved = str(directory.resolve())

    # The pure-Python driver resolves libpq through ctypes.util.find_library,
    # which searches PATH — so PATH is what actually has to change.
    current_path = os.environ.get("PATH", "")
    if resolved.lower() not in current_path.lower():
        os.environ["PATH"] = resolved + os.pathsep + current_path

    # Also register it for any extension module that is loaded later.
    try:
        os.add_dll_directory(resolved)
    except OSError as exc:  # pragma: no cover - platform specific
        logger.debug("Could not register PGBIN as a DLL directory: %s", exc)


_register_libpq_directory()

# Predictable constraint names keep Alembic autogenerate diffs stable, which
# matters once we start adding models incrementally.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base shared by every model. Alembic targets this metadata."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


engine = create_engine(
    settings.database_url,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
    pool_pre_ping=True,  # transparently drops stale connections
    echo=settings.DB_ECHO,
    future=True,
    connect_args={
        # Without this, a dead database leaves callers waiting on TCP retries —
        # /api/health would hang instead of promptly reporting 503.
        "connect_timeout": settings.DB_CONNECT_TIMEOUT_SECONDS,
        "application_name": "rehab-hms-api",
    },
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    class_=Session,
)


def get_db() -> Generator[Session, None, Any]:
    """FastAPI dependency yielding one session per request.

    Commits are the caller's responsibility (services own transactions); the
    session is always closed, and rolled back if the request raised.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# Health probes use their own pool-free engine with a short timeout. Sharing
# the request pool made a down database take tens of seconds to report, because
# pre-ping invalidates and retries; this keeps /api/health predictably fast.
_probe_engine = create_engine(
    settings.database_url,
    poolclass=NullPool,
    echo=False,
    future=True,
    connect_args={
        "connect_timeout": settings.DB_HEALTHCHECK_TIMEOUT_SECONDS,
        "application_name": "rehab-hms-healthcheck",
    },
)


def check_database_connection() -> tuple[bool, str | None]:
    """Run a real ``SELECT 1``.

    Returns ``(ok, error_message)``. The error message is for logging only and
    is never returned to API clients, because it can contain connection detail.
    """
    try:
        with _probe_engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, None
    except SQLAlchemyError as exc:
        return False, str(exc)
    except Exception as exc:  # pragma: no cover - defensive
        return False, repr(exc)


def wait_for_database() -> bool:
    """Retry the connection at startup so the API tolerates a slow Postgres.

    Relevant under Docker Compose, where the API container frequently starts
    before Postgres finishes its first-run initialisation.
    """
    attempts = max(1, settings.DB_CONNECT_RETRIES)
    for attempt in range(1, attempts + 1):
        ok, error = check_database_connection()
        if ok:
            if attempt > 1:
                logger.info("Database became available after %s attempt(s)", attempt)
            return True
        logger.warning(
            "Database not ready (attempt %s/%s): %s", attempt, attempts, error
        )
        if attempt < attempts:
            time.sleep(settings.DB_CONNECT_RETRY_DELAY_SECONDS)
    return False
