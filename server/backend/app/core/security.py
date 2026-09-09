"""Password hashing and JWT issuing/verification.

Nothing here logs a password, a hash or a token.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Final

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from jwt import ExpiredSignatureError, InvalidTokenError

from app.core.config import settings

logger = logging.getLogger(__name__)

# Argon2id with the argon2-cffi defaults, which follow the RFC 9106
# recommendations. Tuning belongs in config if a deployment needs it.
_hasher: Final[PasswordHasher] = PasswordHasher()

#: Token type carried in the JWT so an access token can never be replayed as
#: some other kind of token later (refresh, password reset, …).
ACCESS_TOKEN_TYPE: Final = "access"


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    """Hash a plaintext password with Argon2id.

    The returned string embeds the algorithm, parameters and salt, so verifying
    needs nothing else stored alongside it.
    """
    if not password:
        raise ValueError("password must not be empty")
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Check a password against a stored hash.

    Returns ``False`` rather than raising for any mismatch or malformed hash, so
    callers cannot accidentally distinguish "wrong password" from "corrupt row"
    through an exception type.
    """
    if not password or not password_hash:
        return False
    try:
        _hasher.verify(password_hash, password)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    except Exception:  # pragma: no cover - defensive; never leak hash detail
        logger.exception("Unexpected error while verifying a password hash")
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when a stored hash uses outdated Argon2 parameters."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        # A hash from another algorithm (e.g. a legacy bcrypt row) should be
        # upgraded on the next successful sign-in.
        return True


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------


def create_access_token(
    *,
    subject: str | uuid.UUID,
    role: str,
    expires_delta: timedelta | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> tuple[str, datetime]:
    """Sign an access token.

    The payload deliberately carries only an identifier, the role and the
    standard registered claims. No patient data, and no permission list —
    permissions are resolved from the database on every request so an
    administrator's change to the matrix takes effect immediately rather than
    when the token happens to expire.

    Returns ``(token, expires_at)``.
    """
    now = datetime.now(timezone.utc)
    expires_at = now + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    payload: dict[str, Any] = {
        "sub": str(subject),
        "role": role,
        "type": ACCESS_TOKEN_TYPE,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    if extra_claims:
        payload.update(extra_claims)

    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, expires_at


class TokenError(Exception):
    """Raised when a token cannot be trusted. Carries no token material."""

    def __init__(self, reason: str, *, expired: bool = False):
        super().__init__(reason)
        self.reason = reason
        self.expired = expired


def decode_access_token(token: str) -> dict[str, Any]:
    """Verify a token's signature, expiry and type, returning its claims.

    Raises :class:`TokenError` for anything untrustworthy. The exception message
    is safe to surface; the token itself is never logged.
    """
    try:
        claims = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
    except ExpiredSignatureError as exc:
        raise TokenError("Your session has expired. Please sign in again.", expired=True) from exc
    except InvalidTokenError as exc:
        raise TokenError("Could not validate credentials.") from exc

    if claims.get("type") != ACCESS_TOKEN_TYPE:
        raise TokenError("Could not validate credentials.")

    return claims
