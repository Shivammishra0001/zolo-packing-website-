"""Logging setup.

Deliberately plain: a single stream handler with a consistent format. The only
opinionated part is the redaction filter, which stops credentials reaching the
log even if a DSN or token is interpolated into a message by accident.
"""

from __future__ import annotations

import logging
import re
import sys

from app.core.config import settings

# postgresql+psycopg://user:secret@host/db  ->  postgresql+psycopg://user:***@host/db
_DSN_PASSWORD = re.compile(r"(?P<scheme>[a-z+]+://)(?P<user>[^:/\s]+):(?P<pw>[^@/\s]+)@")
_SENSITIVE_KEY = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|token|authorization|api[_-]?key)\b\s*[:=]\s*\S+"
)


class RedactingFilter(logging.Filter):
    """Scrub credentials from formatted log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - never break logging
            return True

        redacted = _DSN_PASSWORD.sub(r"\g<scheme>\g<user>:***@", message)
        redacted = _SENSITIVE_KEY.sub(lambda m: f"{m.group(1)}=***", redacted)

        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def configure_logging() -> None:
    """Idempotent root logger configuration."""
    level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    handler.addFilter(RedactingFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Uvicorn ships its own handlers; route them through ours instead.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True

    # SQL echo is controlled by DB_ECHO, not by the global level.
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.DB_ECHO else logging.WARNING
    )
