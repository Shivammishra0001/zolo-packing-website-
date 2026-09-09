"""Authentication business rules.

Owns the transaction for sign-in and is the single place that decides whether a
set of credentials is acceptable.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.enums import UserStatus
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.security import (
    TokenError,
    create_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.models.user import User
from app.repositories import user_repository as users
from app.schemas.auth import LoginResponse, SessionOut, UserOut

logger = logging.getLogger(__name__)

#: Deliberately identical for "no such account" and "wrong password", so the
#: API cannot be used to enumerate which email addresses are registered.
INVALID_CREDENTIALS = "Invalid email or password."

STATUS_REJECTION = {
    UserStatus.SUSPENDED: "Your account has been suspended. Contact your administrator.",
    UserStatus.PENDING: "Your account is awaiting administrator approval.",
}


def _to_user_out(db: Session, user: User) -> UserOut:
    """Shape a user row into exactly what the frontend already consumes."""
    return UserOut(
        id=user.user_number,
        uuid=str(user.id),
        name=user.full_name,
        email=user.email,
        role=user.role,
        designation=user.designation,
        department=users.department_name(user),
        avatarColor=user.avatar_color,
        initials=user.initials,
        branch=users.branch_name(user),
        phone=user.phone,
        status=user.status,
        lastLogin=user.last_login,
    )


def build_session(db: Session, user: User) -> SessionOut:
    """User plus live permissions — shared by login and /auth/me."""
    return SessionOut(
        user=_to_user_out(db, user),
        permissions=users.permissions_for_role(db, user.role),
    )


def authenticate(db: Session, email: str, password: str) -> User:
    """Verify credentials and account state.

    Raises :class:`UnauthorizedError` for bad credentials and
    :class:`ForbiddenError` for an account that exists but may not sign in.
    """
    user = users.get_by_email(db, email)

    if user is None:
        # Still spend time hashing, so a missing account is not detectably
        # faster than a wrong password.
        verify_password(password, _DUMMY_HASH)
        logger.info("Failed sign-in attempt for an unknown email address")
        raise UnauthorizedError(INVALID_CREDENTIALS, code="invalid_credentials")

    if not verify_password(password, user.password_hash):
        logger.info("Failed sign-in attempt for user %s (bad password)", user.id)
        raise UnauthorizedError(INVALID_CREDENTIALS, code="invalid_credentials")

    if user.status is not UserStatus.ACTIVE:
        logger.info("Blocked sign-in for %s account %s", user.status.value, user.id)
        raise ForbiddenError(
            STATUS_REJECTION.get(user.status, "This account cannot sign in."),
            code=f"account_{user.status.value}",
        )

    # Transparently upgrade a hash whose parameters are now out of date.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        db.add(user)

    return user


def login(db: Session, email: str, password: str) -> LoginResponse:
    """Authenticate and issue an access token. Commits on success."""
    user = authenticate(db, email, password)

    token, expires_at = create_access_token(subject=user.id, role=user.role.value)

    users.touch_last_login(db, user)
    db.commit()
    db.refresh(user)

    session = build_session(db, user)
    logger.info("User %s signed in as %s", user.id, user.role.value)

    return LoginResponse(
        user=session.user,
        permissions=session.permissions,
        access_token=token,
        token_type="bearer",
        expires_at=expires_at,
        expires_in=int((expires_at - datetime.now(timezone.utc)).total_seconds()),
    )


def resolve_token_user(db: Session, claims: dict) -> User:
    """Load and re-validate the user behind a token's claims.

    The token is only an assertion of identity. Role and account status are read
    from the database every time, so a suspension or role change takes effect on
    the next request rather than when the token expires.
    """
    raw_subject = claims.get("sub")
    try:
        user_id = uuid.UUID(str(raw_subject))
    except (TypeError, ValueError) as exc:
        raise TokenError("Could not validate credentials.") from exc

    user = users.get_by_id(db, user_id)
    if user is None:
        raise UnauthorizedError("Could not validate credentials.", code="invalid_token")

    if user.status is not UserStatus.ACTIVE:
        raise ForbiddenError(
            STATUS_REJECTION.get(user.status, "This account cannot sign in."),
            code=f"account_{user.status.value}",
        )

    return user


#: A real Argon2 hash of a throwaway value, used to equalise timing when an
#: email is not found. Computed once at import.
_DUMMY_HASH = hash_password("not-a-real-password-timing-equaliser")
