"""Staff, roles, the permission matrix, branches, settings and the audit trail.

Five routers, because they are five resources with five different audiences:
anyone administering staff is not necessarily the person who edits the
permission matrix, and neither is necessarily the person reading the audit log.

There is no DELETE anywhere in this module, and none of these is exposed:

* `PUT`/`DELETE /api/audit-logs/{id}` — the trail is append-only. Nothing in the
  service writes to an existing entry, so there is no handler to guard;
* `POST`/`PUT /api/roles` — the frontend has no role-creation screen. The eight
  roles are an enum, which is how the frontend models them too;
* branch deletion — a branch owns patients, staff, wards and expenses, and
  removing one would orphan history that has to stay intact.

Permission keys are the ones the frontend already defines: `staff.manage`,
`roles.manage`, `branches.manage`, `settings.manage` and `audit.view`.
"""

from __future__ import annotations

from datetime import date as date_type
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.dependencies import (
    CurrentPermissions,
    DbSession,
    client_ip,
    require_permission,
)
from app.core.enums import AuditCategory, UserRole, UserStatus
from app.models.user import User
from app.schemas.admin import (
    AdminDashboard,
    ClinicianOption,
    AuditPage,
    BranchCreate,
    BranchResponse,
    BranchUpdate,
    PermissionResponse,
    RolePermissionsUpdate,
    RoleResponse,
    SettingResponse,
    SettingsUpdate,
    UserCreate,
    UserCreated,
    UserPage,
    UserResponse,
    UserUpdate,
)
from app.services import admin_service as service

#: The administrator's own dashboard.
router = APIRouter(tags=["Administration"])
users = APIRouter(tags=["Staff"])
roles = APIRouter(tags=["Roles & Permissions"])
branches = APIRouter(tags=["Branches"])
settings_router = APIRouter(tags=["Settings"])
audit = APIRouter(tags=["Audit"])

_FORBIDDEN = {
    "description": "The caller lacks the required administrative permission",
    "content": {
        "application/json": {
            "example": {
                "detail": "You do not have permission to perform this action.",
                "code": "insufficient_permission",
            }
        }
    },
}
_NOT_FOUND = {
    "description": "No such account, branch or role — or it belongs to another branch",
    "content": {
        "application/json": {
            "example": {"detail": "Staff member not found.", "code": "not_found"}
        }
    },
}
_EMAIL_TAKEN = {
    "description": "That email address already belongs to another account",
    "content": {
        "application/json": {
            "example": {
                "detail": "ritika.shah@rehab.com already belongs to another account.",
                "code": "email_taken",
            }
        }
    },
}


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------


@users.get(
    "",
    response_model=UserPage,
    summary="Staff directory",
    description=(
        "Filtered in PostgreSQL, not in Python — `?search=` matches name, "
        "email, staff number, designation and department.\n\n"
        "No password, hash or token appears in the response; `UserResponse` has "
        "no field for one."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def list_users(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("staff.manage"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    search: Annotated[str | None, Query(max_length=120)] = None,
    role: UserRole | None = None,
    status_filter: Annotated[UserStatus | None, Query(alias="status")] = None,
    branch: Annotated[str | None, Query(description="Branch UUID")] = None,
) -> UserPage:
    return service.list_users(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        search=search,
        role=role,
        status=status_filter,
        branch=branch,
    )


@users.post(
    "",
    response_model=UserCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Invite a staff member",
    description=(
        "Creates a **pending** account, which is what the invite dialog already "
        "describes, and which cannot sign in until an administrator approves "
        "it.\n\n"
        "A temporary password is generated server-side and hashed with Argon2. "
        "It is returned **once**, to the administrator making the request, and "
        "is never stored in readable form or written to a log. This stands in "
        "for an invitation email because the build has no mail server — the "
        "response is flagged `developmentOnly`."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _EMAIL_TAKEN},
)
def create_user(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: UserCreate,
    user: Annotated[User, Depends(require_permission("staff.manage"))],
) -> UserCreated:
    return service.create_user(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )


@users.get(
    "/clinicians",
    response_model=list[ClinicianOption],
    summary="Clinicians a booking can be assigned to",
    description=(
        "Active doctors and therapists, as a name and an id — the minimum a "
        "picker needs.\n\n"
        "Gated on `appointment.view` rather than `staff.manage`: reception has "
        "to choose a doctor to book one, and that is not a reason to hand them "
        "the staff directory."
    ),
    responses={403: _FORBIDDEN},
)
def list_clinicians(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("appointment.view"))],
    role: UserRole | None = None,
) -> list[ClinicianOption]:
    return service.list_clinicians(db, user=user, permissions=permissions, role=role)


@users.get(
    "/{identifier}",
    response_model=UserResponse,
    summary="One staff member",
    description="Accepts a UUID or a `USR-####` code.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_user(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("staff.manage"))],
) -> UserResponse:
    return service.get_user(db, identifier=identifier, user=user, permissions=permissions)


@users.put(
    "/{identifier}",
    response_model=UserResponse,
    summary="Amend a staff member",
    description=(
        "Name, email, role, designation, phone, department and branch.\n\n"
        "**Status is not settable here.** It moves through the approve, suspend "
        "and activate endpoints, where the transition rules live — accepting it "
        "on this route would let a client route around them.\n\n"
        "A role change takes effect on that account's next request: both the "
        "role and its permissions are read from PostgreSQL rather than from the "
        "token the user is holding. Granting or changing the owner role "
        "requires being an owner."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _EMAIL_TAKEN},
)
def update_user(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: UserUpdate,
    user: Annotated[User, Depends(require_permission("staff.manage"))],
) -> UserResponse:
    return service.update_user(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@users.post(
    "/{identifier}/approve",
    response_model=UserResponse,
    summary="Approve a pending account",
    description="The staff screen's Approve button. Moves `pending` to `active`.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def approve_user(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("staff.manage"))],
) -> UserResponse:
    return service.set_user_status(
        db,
        identifier=identifier,
        status=UserStatus.ACTIVE,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@users.post(
    "/{identifier}/activate",
    response_model=UserResponse,
    summary="Reinstate a suspended account",
    description="The staff screen's Reinstate button. The user can sign in again immediately.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def activate_user(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("staff.manage"))],
) -> UserResponse:
    return service.set_user_status(
        db,
        identifier=identifier,
        status=UserStatus.ACTIVE,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@users.post(
    "/{identifier}/suspend",
    response_model=UserResponse,
    summary="Suspend an account",
    description=(
        "Takes effect immediately, not when the token expires: every request "
        "re-reads the account's status, so the suspended user's next call is "
        "refused with a 403 even though their token is still valid.\n\n"
        "An administrator cannot suspend their own account — the staff screen "
        "offers Suspend on every active row, including theirs."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def suspend_user(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("staff.manage"))],
) -> UserResponse:
    return service.set_user_status(
        db,
        identifier=identifier,
        status=UserStatus.SUSPENDED,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


# ---------------------------------------------------------------------------
# Roles and permissions
# ---------------------------------------------------------------------------


@roles.get(
    "",
    response_model=list[RoleResponse],
    summary="Roles and what they can do",
    description=(
        "The eight roles, each with its current permission keys and how many "
        "people hold it. `id` is the role's own lowercase value — there is no "
        "separate roles table, because the frontend models roles the same way."
    ),
    responses={403: _FORBIDDEN},
)
def list_roles(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("roles.manage"))],
) -> list[RoleResponse]:
    return service.list_roles(db, user=user, permissions=permissions)


@roles.get(
    "/permissions",
    response_model=list[PermissionResponse],
    summary="Every permission",
    description=(
        "The catalogue the matrix is drawn from, grouped as the Roles screen "
        "groups it. Same keys as `src/lib/permissions.ts` — there is no second "
        "vocabulary."
    ),
    responses={403: _FORBIDDEN},
)
def list_permissions(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("roles.manage"))],
) -> list[PermissionResponse]:
    return service.list_permissions(db)


@roles.get(
    "/{role}",
    response_model=RoleResponse,
    summary="One role",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_role(
    db: DbSession,
    permissions: CurrentPermissions,
    role: UserRole,
    user: Annotated[User, Depends(require_permission("roles.manage"))],
) -> RoleResponse:
    return service.get_role(db, role=role, user=user, permissions=permissions)


@roles.put(
    "/{role}/permissions",
    response_model=RoleResponse,
    summary="Replace a role's permissions",
    description=(
        "Send the whole set the role should end up with, not a diff.\n\n"
        "Every key is resolved before anything is deleted, so an unknown one "
        "fails the request rather than leaving the role stripped. The delete "
        "and the inserts share one transaction: the role is never observable "
        "with a partial set.\n\n"
        "The change takes effect on the next request from anyone holding that "
        "role — permissions are read live from the matrix, so there is nothing "
        "to invalidate and no restart.\n\n"
        "**The owner role is the owner's to edit.** The screen lets an "
        "administrator select it, so the guard is here rather than in the UI."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def set_role_permissions(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    role: UserRole,
    payload: RolePermissionsUpdate,
    user: Annotated[User, Depends(require_permission("roles.manage"))],
) -> RoleResponse:
    return service.set_role_permissions(
        db,
        role=role,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


# ---------------------------------------------------------------------------
# Branches
# ---------------------------------------------------------------------------


@branches.get(
    "",
    response_model=list[BranchResponse],
    summary="Branches",
    description="With live staff and patient counts, so a branch cannot claim people it does not have.",
    responses={403: _FORBIDDEN},
)
def list_branches(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("branches.manage"))],
) -> list[BranchResponse]:
    return service.list_branches(db, user=user, permissions=permissions)


@branches.post(
    "",
    response_model=BranchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a branch",
    responses={403: _FORBIDDEN, 409: _EMAIL_TAKEN},
)
def create_branch(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: BranchCreate,
    user: Annotated[User, Depends(require_permission("branches.manage"))],
) -> BranchResponse:
    return service.create_branch(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )


@branches.get(
    "/{identifier}",
    response_model=BranchResponse,
    summary="One branch",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_branch(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("branches.manage"))],
) -> BranchResponse:
    return service.get_branch(db, identifier=identifier, user=user, permissions=permissions)


@branches.put(
    "/{identifier}",
    response_model=BranchResponse,
    summary="Amend a branch",
    description=(
        "There is no delete. A branch owns patients, staff, wards and expenses; "
        "removing one would orphan history that has to stay intact."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def update_branch(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: BranchUpdate,
    user: Annotated[User, Depends(require_permission("branches.manage"))],
) -> BranchResponse:
    return service.update_branch(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


@settings_router.get(
    "",
    response_model=list[SettingResponse],
    summary="System configuration",
    description=(
        "The configuration screen's values, with each one's type preserved — a "
        "toggle comes back a boolean, a rate comes back a number.\n\n"
        "**No secret is served here and none can be.** The accepted keys are a "
        "fixed list of clinic configuration; the JWT secret, the database "
        "password and every other credential live in the environment and have "
        "no row in this table."
    ),
    responses={403: _FORBIDDEN},
)
def get_settings(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("settings.manage"))],
) -> list[SettingResponse]:
    return service.list_settings(db)


@settings_router.put(
    "",
    response_model=list[SettingResponse],
    summary="Save system configuration",
    description=(
        "Every value is validated against its declared type before anything is "
        "written, so one bad field cannot leave the configuration half-saved. "
        "A key no screen reads is refused rather than stored."
    ),
    responses={403: _FORBIDDEN},
)
def update_settings(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: SettingsUpdate,
    user: Annotated[User, Depends(require_permission("settings.manage"))],
) -> list[SettingResponse]:
    return service.update_settings(db, payload=payload, user=user, ip=client_ip(request))


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


@audit.get(
    "",
    response_model=AuditPage,
    summary="Audit trail",
    description=(
        "Newest first — `?actor=` `?action=` `?category=` `?target_type=` "
        "`?search=` `?date_from=` `?date_to=`.\n\n"
        "**Read-only by construction.** There is no update or delete handler "
        "anywhere in this module, so an administrator cannot quietly rewrite "
        "history. Entries carry names, codes and one-line summaries; no "
        "password, token, authorization header or clinical detail is recorded."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def list_audit(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("audit.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    actor: Annotated[str | None, Query(description="User UUID or USR-#### code")] = None,
    action: Annotated[str | None, Query(max_length=80)] = None,
    category: AuditCategory | None = None,
    target_type: Annotated[str | None, Query(max_length=80)] = None,
    search: Annotated[str | None, Query(max_length=120)] = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
) -> AuditPage:
    return service.list_audit(
        db,
        page=page,
        limit=limit,
        actor=actor,
        action=action,
        category=category,
        target_type=target_type,
        search=search,
        date_from=date_from,
        date_to=date_to,
        user=user,
        permissions=permissions,
    )


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


@router.get(
    "/dashboard",
    response_model=AdminDashboard,
    summary="Admin dashboard",
    description=(
        "Headcount by status, branches, departments and patients, counted in "
        "PostgreSQL.\n\n"
        "Deliberately narrow: every other module already has a dashboard, and "
        "copying their figures here would mean two places to keep correct."
    ),
    responses={403: _FORBIDDEN},
)
def dashboard(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("staff.manage"))],
) -> AdminDashboard:
    return service.dashboard(db, user=user, permissions=permissions)
