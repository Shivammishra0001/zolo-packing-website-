"""Shared FastAPI dependencies: database session, pagination and auth guards.

Authorisation is enforced here, never in the frontend. A route declares what it
requires; the dependency resolves the caller's real role and permissions from
PostgreSQL on every request.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.enums import UserRole
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.security import TokenError, decode_access_token
from app.models.user import User
from app.repositories import user_repository as users
from app.services import auth_service

# Inject with:  db: DbSession
DbSession = Annotated[Session, Depends(get_db)]

#: auto_error=False so a missing header raises our own 401 envelope rather than
#: FastAPI's default shape.
_bearer = HTTPBearer(auto_error=False, description="Bearer access token from /api/auth/login")


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


class Pagination(BaseModel):
    """``?page=&limit=`` parsed once, with sane bounds."""

    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=100)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.limit


def pagination_params(
    page: Annotated[int, Query(ge=1, description="1-indexed page number")] = 1,
    limit: Annotated[int, Query(ge=1, le=100, description="Rows per page (max 100)")] = 20,
) -> Pagination:
    return Pagination(page=page, limit=limit)


PaginationParams = Annotated[Pagination, Depends(pagination_params)]


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
) -> User:
    """Resolve the authenticated user from the ``Authorization`` header.

    Rejects a missing, malformed, expired or unknown token with 401, and an
    inactive account with 403.
    """
    if credentials is None or not credentials.credentials:
        raise UnauthorizedError("Not authenticated.", code="not_authenticated")

    try:
        claims = decode_access_token(credentials.credentials)
        return auth_service.resolve_token_user(db, claims)
    except TokenError as exc:
        raise UnauthorizedError(
            exc.reason, code="token_expired" if exc.expired else "invalid_token"
        ) from exc


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_permissions(db: DbSession, user: CurrentUser) -> list[str]:
    """The caller's live permission keys."""
    return users.permissions_for_role(db, user.role)


CurrentPermissions = Annotated[list[str], Depends(get_current_permissions)]


# ---------------------------------------------------------------------------
# Authorisation
# ---------------------------------------------------------------------------


def require_role(*roles: UserRole | str) -> Callable[..., User]:
    """Dependency factory restricting a route to specific roles.

    ``Depends(require_role("doctor", "therapist"))``

    The role is read from the database user, never from the request.
    """
    allowed = {UserRole(r) if not isinstance(r, UserRole) else r for r in roles}

    def _guard(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise ForbiddenError(
                "You do not have permission to perform this action.",
                code="insufficient_role",
            )
        return user

    _guard.__name__ = f"require_role_{'_'.join(sorted(r.value for r in allowed))}"
    return _guard


def require_permission(*required: str, require_all: bool = True) -> Callable[..., User]:
    """Dependency factory enforcing permission keys from the live matrix.

    ``Depends(require_permission("patient.clinical.view"))``

    With several keys, all are required by default; pass ``require_all=False``
    to accept any one of them.
    """
    needed = tuple(required)

    def _guard(db: DbSession, user: CurrentUser) -> User:
        granted = set(users.permissions_for_role(db, user.role))
        ok = all(p in granted for p in needed) if require_all else any(p in granted for p in needed)
        if not ok:
            missing = sorted(set(needed) - granted)
            # The user is told they lack permission, not which key is missing —
            # the specifics go to the log.
            _log_denied(user, missing)
            raise ForbiddenError(
                "You do not have permission to perform this action.",
                code="insufficient_permission",
            )
        return user

    _guard.__name__ = f"require_permission_{'_'.join(needed).replace('.', '_')}"
    return _guard


def _log_denied(user: User, missing: Sequence[str]) -> None:
    import logging

    logging.getLogger(__name__).info(
        "Denied %s (role=%s): missing permission(s) %s",
        user.id,
        user.role.value,
        ", ".join(missing),
    )


def client_ip(request: Request) -> str | None:
    """Best-effort caller IP for audit records.

    Returns ``None`` unless the value parses as a real address. ``audit_logs.
    ip_address`` is a PostgreSQL ``inet`` column, so anything else would abort
    the surrounding transaction — and the header is attacker-controlled. An
    audit row with no IP is far better than a failed write.
    """
    import ipaddress

    candidates: list[str] = []
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        candidates.append(forwarded.split(",")[0].strip())
    if request.client:
        candidates.append(request.client.host)

    for candidate in candidates:
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            continue
    return None
