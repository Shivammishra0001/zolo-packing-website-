"""Consistent error envelope.

Every failure leaves the API as ``{"detail": "...", "code": "..."}``. Internal
detail (SQL, connection strings, tracebacks) is logged, never serialised.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

# Starlette's router raises the base HTTPException for unmatched routes and
# method mismatches. FastAPI's HTTPException subclasses it, so handling the
# base class covers both.
from starlette.exceptions import HTTPException

# 422 was renamed in newer Starlette releases. Probe with hasattr so the
# deprecated name is never touched on versions that still define it.
HTTP_422: int = (
    status.HTTP_422_UNPROCESSABLE_CONTENT
    if hasattr(status, "HTTP_422_UNPROCESSABLE_CONTENT")
    else 422
)

logger = logging.getLogger(__name__)

GENERIC_500 = "An internal error occurred. Please try again."
GENERIC_DB = "The service is temporarily unavailable. Please try again shortly."


class AppError(Exception):
    """Base class for expected, client-facing failures."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "bad_request"

    def __init__(self, detail: str, *, code: str | None = None, status_code: int | None = None):
        super().__init__(detail)
        self.detail = detail
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ConflictError(AppError):
    """Business-rule collision — duplicate record, overlapping appointment."""

    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class UnauthorizedError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class UnprocessableError(AppError):
    status_code = HTTP_422
    code = "unprocessable"


class ServiceUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "service_unavailable"


def _envelope(detail: str, code: str, extra: dict | None = None) -> dict:
    body = {"detail": detail, "code": code}
    if extra:
        body.update(extra)
    return body


def register_exception_handlers(app: FastAPI) -> None:
    """Attach handlers that normalise every error shape."""

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.detail, exc.code),
        )

    @app.exception_handler(HTTPException)
    async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(detail, f"http_{exc.status_code}"),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=HTTP_422,
            content=_envelope(
                "The submitted data is invalid.",
                "validation_error",
                {"errors": jsonable_encoder(exc.errors())},
            ),
        )

    @app.exception_handler(SQLAlchemyError)
    async def _database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        reference = uuid.uuid4().hex[:12]
        # Full detail to logs only — it can contain the DSN.
        logger.error(
            "Database error [%s] on %s %s: %s",
            reference,
            request.method,
            request.url.path,
            exc,
            exc_info=True,
        )
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=_envelope(GENERIC_DB, "database_error", {"reference": reference}),
        )

    @app.exception_handler(Exception)
    async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        reference = uuid.uuid4().hex[:12]
        logger.error(
            "Unhandled error [%s] on %s %s: %s",
            reference,
            request.method,
            request.url.path,
            exc,
            exc_info=True,
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope(GENERIC_500, "internal_error", {"reference": reference}),
        )
