"""Authentication endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, status

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbSession
from app.schemas.auth import LoginRequest, LoginResponse, LogoutResponse, SessionOut
from app.services import auth_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Authentication"])

_UNAUTHORIZED = {
    "description": "Invalid credentials, or a missing/expired token",
    "content": {
        "application/json": {
            "example": {"detail": "Invalid email or password.", "code": "invalid_credentials"}
        }
    },
}
_FORBIDDEN = {
    "description": "The account exists but may not sign in",
    "content": {
        "application/json": {
            "example": {
                "detail": "Your account has been suspended. Contact your administrator.",
                "code": "account_suspended",
            }
        }
    },
}


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Sign in",
    description=(
        "Verifies credentials against PostgreSQL and returns a signed JWT, the "
        "user record and that user's **live** permission keys.\n\n"
        "Permissions are read from `role_permissions` on every call — they are "
        "not embedded in the token — so an administrator's change to the matrix "
        "applies immediately.\n\n"
        "`401` is returned identically for an unknown email and a wrong "
        "password, so the endpoint cannot be used to discover which addresses "
        "are registered. A suspended or unapproved account returns `403`."
    ),
    responses={401: _UNAUTHORIZED, 403: _FORBIDDEN},
)
def login(payload: LoginRequest, db: DbSession) -> LoginResponse:
    # `remember` is accepted because the existing login form sends it; the
    # client uses it to choose localStorage vs sessionStorage. Token lifetime
    # stays server-controlled either way.
    return auth_service.login(db, email=payload.email, password=payload.password)


@router.get(
    "/me",
    response_model=SessionOut,
    summary="Current user and permissions",
    description=(
        "Re-validates the bearer token, reloads the user from PostgreSQL and "
        "returns their current permissions. Role and account status are read "
        "fresh, so a suspension or role change takes effect on the next request."
    ),
    responses={401: _UNAUTHORIZED, 403: _FORBIDDEN},
)
def me(db: DbSession, user: CurrentUser) -> SessionOut:
    return auth_service.build_session(db, user)


@router.post(
    "/logout",
    response_model=LogoutResponse,
    status_code=status.HTTP_200_OK,
    summary="Sign out",
    description=(
        "Records the sign-out and instructs the client to discard its token.\n\n"
        "**Limitation:** access tokens are stateless JWTs, so this does not "
        "revoke the token server-side — a copy of it remains valid until it "
        "expires (`ACCESS_TOKEN_EXPIRE_MINUTES`, currently "
        f"{settings.ACCESS_TOKEN_EXPIRE_MINUTES} minutes). Real revocation "
        "needs a denylist or short-lived tokens with refresh, which is not "
        "built yet. The client must clear the token, user and permissions."
    ),
    responses={401: _UNAUTHORIZED},
)
def logout(user: CurrentUser) -> LogoutResponse:
    logger.info("User %s signed out", user.id)
    return LogoutResponse(detail="Signed out.")
