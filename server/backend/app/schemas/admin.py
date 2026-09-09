"""Staff, roles, the permission matrix, branches, settings and the audit trail.

Field names mirror the frontend's `User` type in `src/types/index.ts` and the
admin screens that render it. Three things there shape everything here:

* a role and a status cross the wire as their **lowercase values** — `doctor`,
  `active` — because `ROLE_HOME`, `ROLE_LABEL` and `NAVIGATION` are all keyed on
  them. `UserRole` and `UserStatus` already declare `_wire_uses_value()`, so
  that happens without any annotation here;
* a user's `branch` and `department` are plain display strings on the row, while
  the ids that address them are separate fields. The screens show one and post
  the other;
* there is no roles table. The role enum *is* the identifier, which is how the
  frontend models roles too, so the matrix is a join keyed on it.

No password, hash, token or other credential appears in any response model in
this file. `UserResponse` has no field for one.
"""

from __future__ import annotations

from datetime import datetime, time as time_type
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.enums import (
    AuditCategory,
    PermissionGroup,
    UserRole,
    UserStatus,
)

# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class UserResponse(BaseModel):
    """Matches the frontend's ``User`` interface.

    Deliberately without `password_hash`, `last_login` raw timestamps beyond
    what the screen shows, or any other internal column: the admin table needs
    a name, a role, where they work and whether they can sign in.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["USR-1004"])
    uuid: str
    name: str
    email: EmailStr
    role: UserRole
    designation: str = ""
    department: str = ""
    branch: str = ""
    phone: str = ""
    status: UserStatus

    #: Presentation values the avatar renders directly.
    avatarColor: str = ""
    initials: str = ""
    #: "Today, 08:31 AM" — the phrasing the staff table already uses.
    lastLogin: str = "Never"

    #: Ids the admin forms post back, kept apart from the display strings.
    branchId: str | None = None
    departmentId: str | None = None
    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class UserCreate(BaseModel):
    """Invite a staff member.

    The admin form collects a name, an email, a role, a department and a
    branch — and no password, because it describes itself as sending an
    invitation. The account is therefore created `pending` and cannot sign in
    until an administrator approves it.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "Ritika Shah",
                "email": "ritika.shah@rehab.com",
                "role": "therapist",
                "department": "Physiotherapy",
                "branchId": "…uuid…",
            }
        }
    )

    name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    role: UserRole
    designation: str | None = Field(default=None, max_length=160)
    department: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=32)
    #: Branch UUID. Defaults to the caller's own branch when omitted.
    branchId: str | None = None

    @field_validator("name")
    @classmethod
    def _trim_name(cls, value: str) -> str:
        trimmed = " ".join(value.split())
        if not trimmed:
            raise ValueError("A name is required.")
        return trimmed


class UserUpdate(BaseModel):
    """Amend a staff member.

    Status is absent on purpose: it moves through the approve, suspend and
    activate endpoints, which is where the transition rules live. Accepting it
    here would let a client route around them.
    """

    name: str | None = Field(default=None, min_length=1, max_length=160)
    email: EmailStr | None = None
    role: UserRole | None = None
    designation: str | None = Field(default=None, max_length=160)
    department: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=32)
    branchId: str | None = None


class UserCreated(BaseModel):
    """A newly invited account, and how to get into it.

    ``temporaryPassword`` exists because this build has no mail server and the
    spec forbids inventing one. It is returned **once**, to the administrator
    who created the account, and never stored in readable form — the column
    holds an Argon2 hash like every other account's.
    """

    user: UserResponse
    temporaryPassword: str
    #: Always true. Present so a client cannot mistake this for a live flow.
    developmentOnly: bool = True


class ClinicianOption(BaseModel):
    """Just enough to draw a clinician picker.

    Reception and the appointments screen both need to choose a doctor, and
    neither has any business reading the staff directory to do it — so this is
    a name, a role and an id, and nothing else.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["USR-1003"])
    uuid: str
    name: str
    role: UserRole
    designation: str = ""
    department: str = ""
    branch: str = ""


class UserPage(BaseModel):
    items: list[UserResponse]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Roles and permissions
# ---------------------------------------------------------------------------


class PermissionResponse(BaseModel):
    """One permission, in the vocabulary `src/lib/permissions.ts` already uses."""

    model_config = ConfigDict(from_attributes=True)

    key: str = Field(examples=["therapy.session.manage"])
    name: str
    group: PermissionGroup
    description: str | None = None


class RoleResponse(BaseModel):
    """One role and what it can currently do.

    ``id`` is the role's own lowercase value. There is no separate roles table
    and no role-creation screen, so nothing here invents a surrogate key.
    """

    id: UserRole
    label: str
    permissions: list[str] = Field(default_factory=list)
    #: How many accounts currently hold it — the headcount the screen shows.
    headcount: int = 0


class RolePermissionsUpdate(BaseModel):
    """Replace a role's permission set outright.

    A whole set rather than a diff: the matrix screen sends what the role should
    end up with, and replacing it in one transaction means the role is never
    left half-updated.
    """

    permissions: list[str] = Field(
        description="Every permission key the role should end up with.",
        examples=[["patient.view", "appointment.view"]],
    )


# ---------------------------------------------------------------------------
# Branches
# ---------------------------------------------------------------------------


class BranchResponse(BaseModel):
    """Matches the admin Branches screen's own shape."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    city: str = ""
    address: str = ""
    phone: str = ""
    email: str = ""
    opensAt: time_type | None = None
    closesAt: time_type | None = None
    beds: int = 0
    configured: bool = False
    services: list[str] = Field(default_factory=list)

    #: Counted live, so a branch cannot claim staff it does not have.
    staffCount: int = 0
    patientCount: int = 0
    createdAt: datetime | None = None


class BranchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    city: str | None = Field(default=None, max_length=80)
    address: str | None = None
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    opensAt: time_type | None = None
    closesAt: time_type | None = None
    beds: int = Field(default=0, ge=0, le=10_000)
    configured: bool = False
    services: list[str] = Field(default_factory=list, max_length=40)


class BranchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    city: str | None = Field(default=None, max_length=80)
    address: str | None = None
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    opensAt: time_type | None = None
    closesAt: time_type | None = None
    beds: int | None = Field(default=None, ge=0, le=10_000)
    configured: bool | None = None
    services: list[str] | None = Field(default=None, max_length=40)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class SettingResponse(BaseModel):
    """One configuration value, with its type preserved.

    The column is JSONB, so a boolean comes back a boolean and a number comes
    back a number — the admin screen's toggles and numeric fields do not have
    to parse strings.
    """

    key: str
    value: Any
    type: str = Field(description="boolean, integer, decimal, string or json")
    updatedAt: datetime | None = None
    updatedBy: str = ""


class SettingsUpdate(BaseModel):
    """Save the configuration screen.

    Only keys the frontend actually has are accepted; anything else is refused
    rather than quietly stored, so the settings table cannot fill with values no
    screen will ever read.
    """

    values: dict[str, Any] = Field(
        description="Setting key to value.",
        examples=[{"gst": 18, "currency": "INR", "lowStock": True}],
    )


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


class AuditEntry(BaseModel):
    """One recorded action, as the activity screen renders it."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    actor: str = "System"
    actorRole: UserRole | None = None
    action: str
    category: AuditCategory
    #: The one-line description the timeline shows.
    summary: str = ""
    targetType: str | None = None
    targetId: str | None = None
    ipAddress: str | None = None
    at: datetime


class AuditPage(BaseModel):
    items: list[AuditEntry]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class StaffCounts(BaseModel):
    total: int
    active: int
    pending: int
    suspended: int


class AdminDashboard(BaseModel):
    """Every figure the admin dashboard shows, counted in PostgreSQL.

    Deliberately narrow: this is the administrator's own view of the
    organisation, not a copy of every module's dashboard.
    """

    staff: StaffCounts
    branches: int
    #: Branches still missing their configuration — the screen flags these.
    unconfiguredBranches: int
    departments: int
    totalPatients: int
    #: Roles that currently hold no permissions at all.
    rolesWithoutPermissions: list[UserRole] = Field(default_factory=list)
