"""Authentication request and response schemas.

The user shape mirrors the frontend's existing ``User`` type in
``src/types/index.ts`` exactly — including camelCase keys and the lowercase
role vocabulary — so ``AuthContext`` needs no reshaping.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.enums import UserRole, UserStatus


class LoginRequest(BaseModel):
    """Exactly what the existing login form submits."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "email": "doctor@rehab.com",
                "password": "Rehab@123",
                "remember": True,
            }
        }
    )

    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    #: Kept because the form sends it. Token lifetime is server-controlled; this
    #: only tells the client whether to persist the session across restarts.
    remember: bool = False


class UserOut(BaseModel):
    """The user object the frontend already renders.

    ``id`` is the human-readable code (``USR-1004``) rather than the UUID,
    because the UI displays it. ``uuid`` carries the real primary key for any
    caller that needs it.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["USR-1004"])
    uuid: str = Field(examples=["3f1c9d2e-7a41-4b8e-9c02-5d6f1a2b3c4d"])
    name: str = Field(examples=["Meera Iyer"])
    email: EmailStr
    #: Lowercase — ROLE_HOME, ROLE_LABEL and NAVIGATION key off these.
    role: UserRole = Field(examples=["therapist"])
    designation: str | None = Field(default=None, examples=["Senior Physiotherapist"])
    department: str | None = Field(default=None, examples=["Physiotherapy"])
    avatarColor: str | None = Field(default=None, examples=["bg-accent/15 text-accent"])
    initials: str | None = Field(default=None, examples=["MI"])
    branch: str | None = Field(default=None, examples=["Andheri West — Main Campus"])
    phone: str | None = Field(default=None, examples=["+91 98195 77341"])
    status: UserStatus = Field(examples=["active"])
    lastLogin: datetime | None = None


class SessionOut(BaseModel):
    """Shared by ``/auth/me`` — the user plus their live permissions."""

    user: UserOut
    permissions: list[str] = Field(
        description="Permission keys resolved from role_permissions, not from the token.",
        examples=[["patient.view", "therapy.session.manage"]],
    )


class LoginResponse(SessionOut):
    """Login result. Extends the session payload with the bearer token."""

    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    expires_in: int = Field(description="Seconds until the access token expires.")


class LogoutResponse(BaseModel):
    detail: str = "Signed out."
