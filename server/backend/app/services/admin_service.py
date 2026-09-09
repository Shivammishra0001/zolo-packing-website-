"""Staff, roles, the permission matrix, branches, settings and the audit trail.

Three rules shape this module.

**The backend is the authority.** A role, a status and a branch assignment are
all read from PostgreSQL on every request — `resolve_token_user` re-reads the
account and `permissions_for_role` re-reads the matrix — so nothing a client
holds in a token or in local storage can grant it anything. Editing the matrix
takes effect on the very next request, with no cache to invalidate and no
restart.

**Status moves through its own endpoints.** `UserUpdate` has no status field, so
approve, suspend and activate are the only ways an account changes state, and
the transition rules live in one place rather than being re-checked wherever a
client might set it.

**Nothing here returns a credential.** No response model in `schemas/admin.py`
has a password, hash or token field. The one exception is the temporary
password handed back once when an account is invited, which exists only because
this build has no mail server.
"""

from __future__ import annotations

import logging
import secrets
import string
import uuid as uuid_lib
from datetime import date as date_type, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings as app_settings
from app.core.enums import AuditCategory, UserRole, UserStatus
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.core.ids import USER
from app.core.security import hash_password
from app.models.audit import AuditLog
from app.models.organisation import Branch, Department, Setting
from app.models.user import User
from app.repositories import admin_repository as repo
from app.repositories import user_repository as users_repo
from app.schemas.admin import (
    AdminDashboard,
    ClinicianOption,
    AuditEntry,
    AuditPage,
    BranchCreate,
    BranchResponse,
    BranchUpdate,
    PermissionResponse,
    RolePermissionsUpdate,
    RoleResponse,
    SettingResponse,
    SettingsUpdate,
    StaffCounts,
    UserCreate,
    UserCreated,
    UserPage,
    UserResponse,
    UserUpdate,
)
from app.services.avatars import AVATAR_COLOURS
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

#: Where a status may go from where it is. The admin screen offers exactly
#: three moves — Approve, Suspend and Reinstate — and these are them.
ALLOWED_TRANSITIONS: dict[UserStatus, set[UserStatus]] = {
    UserStatus.PENDING: {UserStatus.ACTIVE, UserStatus.SUSPENDED},
    UserStatus.ACTIVE: {UserStatus.SUSPENDED},
    UserStatus.SUSPENDED: {UserStatus.ACTIVE},
}

#: The configuration screen's own fields, and nothing else. A key that no
#: screen reads is refused rather than stored, so the table cannot silently
#: accumulate dead configuration.
SETTING_TYPES: dict[str, str] = {
    # Notification toggles
    "sms": "boolean",
    "email": "boolean",
    "therapyReminder": "boolean",
    "lowStock": "boolean",
    "overdue": "boolean",
    # Front-desk toggles
    "walkIn": "boolean",
    "selfCheckIn": "boolean",
    "audit": "boolean",
    # Scheduling and billing
    "currency": "string",
    "gst": "decimal",
    "slotLength": "integer",
    "invoicePrefix": "string",
    "graceDays": "integer",
}

#: What the screen shows before an administrator has saved anything.
SETTING_DEFAULTS: dict[str, Any] = {
    "sms": True,
    "email": True,
    "therapyReminder": True,
    "lowStock": True,
    "overdue": True,
    "walkIn": True,
    "selfCheckIn": False,
    "audit": False,
    "currency": "INR",
    "gst": 18,
    "slotLength": 30,
    "invoicePrefix": "INV-2026-",
    "graceDays": 15,
}

#: A temporary password has to satisfy the same policy as a chosen one.
_PASSWORD_ALPHABET = string.ascii_letters + string.digits
_PASSWORD_SYMBOLS = "!@#$%^&*"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uuid_or_none(value: str | None) -> uuid_lib.UUID | None:
    try:
        return uuid_lib.UUID(value)  # type: ignore[arg-type]
    except (ValueError, AttributeError, TypeError):
        return None


def _visible(branch_ids, branch_id) -> bool:
    return branch_ids is None or branch_id in branch_ids


def _split_name(full: str) -> tuple[str, str]:
    parts = " ".join(full.split()).split(" ", 1)
    return (parts[0], parts[1]) if len(parts) == 2 else (parts[0], "")


def _initials(first: str, last: str) -> str:
    return f"{(first or ' ')[0]}{(last or ' ')[0]}".strip().upper() or "?"


def _avatar_colour(number: str) -> str:
    digits = "".join(ch for ch in number if ch.isdigit())
    return AVATAR_COLOURS[(int(digits) if digits else 0) % len(AVATAR_COLOURS)]


def _last_login(value: datetime | None) -> str:
    """The phrasing the staff table already uses."""
    if value is None:
        return "Never"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    local = value.astimezone(app_settings.clinic_tz)
    today = datetime.now(app_settings.clinic_tz).date()
    stamp = local.strftime("%I:%M %p").lstrip("0")
    if local.date() == today:
        return f"Today, {stamp}"
    if (today - local.date()).days == 1:
        return f"Yesterday, {stamp}"
    return local.strftime("%d %b, ") + stamp


def generate_temporary_password() -> str:
    """A random password that satisfies the same policy as a chosen one.

    Returned to the administrator once and never stored in readable form — the
    column holds an Argon2 hash like every other account's.
    """
    body = "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(12))
    return (
        secrets.choice(string.ascii_uppercase)
        + secrets.choice(string.ascii_lowercase)
        + secrets.choice(string.digits)
        + secrets.choice(_PASSWORD_SYMBOLS)
        + body
    )


def _audit(
    db: Session,
    user: User,
    action: str,
    target_type: str,
    target_id,
    summary: str,
    ip: str | None,
    category: AuditCategory = AuditCategory.STAFF,
) -> None:
    """Record that an administrative action happened.

    Summaries carry names, codes and role names. A password, a token, an
    authorization header or any clinical detail never reaches here — none of
    this module's callers has one to pass.
    """
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=category,
            target_type=target_type,
            target_id=target_id,
            summary=summary,
            ip_address=ip,
        )
    )


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------


def user_out(row: User) -> UserResponse:
    return UserResponse(
        id=row.user_number,
        uuid=str(row.id),
        name=row.full_name,
        email=row.email,
        role=row.role,
        designation=row.designation or "",
        department=row.department.name if row.department else "",
        branch=row.branch.name if row.branch else "All Branches",
        phone=row.phone or "",
        status=row.status,
        avatarColor=row.avatar_color or _avatar_colour(row.user_number),
        initials=row.initials or _initials(row.first_name, row.last_name),
        lastLogin=_last_login(row.last_login),
        branchId=str(row.branch_id) if row.branch_id else None,
        departmentId=str(row.department_id) if row.department_id else None,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def branch_out(row: Branch, staff: int = 0, patients: int = 0) -> BranchResponse:
    return BranchResponse(
        id=str(row.id),
        name=row.name,
        city=row.city or "",
        address=row.address or "",
        phone=row.phone or "",
        email=row.email or "",
        opensAt=row.opens_at,
        closesAt=row.closes_at,
        beds=row.licensed_beds,
        configured=row.is_configured,
        services=list(row.services or []),
        staffCount=staff,
        patientCount=patients,
        createdAt=row.created_at,
    )


def audit_out(row: AuditLog) -> AuditEntry:
    return AuditEntry(
        id=str(row.id),
        actor=row.user.full_name if row.user else "System",
        actorRole=row.user.role if row.user else None,
        action=row.action,
        category=row.category,
        summary=row.summary or "",
        targetType=row.target_type,
        targetId=str(row.target_id) if row.target_id else None,
        ipAddress=str(row.ip_address) if row.ip_address else None,
        at=row.created_at,
    )


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


def _resolve_user(db: Session, identifier: str, branch_ids) -> User:
    row = (
        repo.get_user_by_number(db, identifier)
        if USER.matches(identifier)
        else repo.get_user(db, _uuid_or_none(identifier)) if _uuid_or_none(identifier) else None
    )
    if row is None or not _visible(branch_ids, row.branch_id):
        # 404 rather than 403 — a 403 would confirm the account exists.
        raise NotFoundError("Staff member not found.")
    return row


def _resolve_branch(db: Session, identifier: str, branch_ids) -> Branch:
    parsed = _uuid_or_none(identifier)
    row = repo.get_branch(db, parsed) if parsed else None
    if row is None or not _visible(branch_ids, row.id):
        raise NotFoundError("Branch not found.")
    return row


def _assign_branch(db: Session, branch_id_raw: str | None, user: User, branch_ids) -> uuid_lib.UUID | None:
    """Validate a branch assignment before it is written.

    An arbitrary id from a client is never trusted: the branch has to exist and
    to be one the administrator making the change can already see.
    """
    if branch_id_raw is None:
        return user.branch_id

    parsed = _uuid_or_none(branch_id_raw)
    if parsed is None:
        raise UnprocessableError("That is not a valid branch id.")
    branch = repo.get_branch(db, parsed)
    if branch is None or not _visible(branch_ids, branch.id):
        raise NotFoundError("Branch not found.")
    return branch.id


def _assign_department(
    db: Session, name: str | None, branch_id: uuid_lib.UUID | None
) -> uuid_lib.UUID | None:
    """Match a department by name within the branch, or leave it unset.

    Departments are not created here. The admin form is a free-text field, and
    silently creating a department from a typo would quietly reshape the
    organisation chart.
    """
    if not name or not name.strip():
        return None
    department = repo.find_department(db, branch_id, name)
    if department is None:
        department = repo.find_department(db, None, name)
    return department.id if department else None


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


def list_users(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int = 1,
    limit: int = 50,
    search: str | None = None,
    role: UserRole | None = None,
    status: UserStatus | None = None,
    branch: str | None = None,
) -> UserPage:
    branch_ids = visible_branch_ids(db, user, permissions)
    branch_id = _resolve_branch(db, branch, branch_ids).id if branch else None

    rows, total = repo.list_users(
        db,
        branch_ids=branch_ids,
        search=search,
        role=role,
        status=status,
        branch_id=branch_id,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return UserPage(
        items=[user_out(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def list_clinicians(
    db: Session, *, user: User, permissions: list[str], role: UserRole | None = None
) -> list[ClinicianOption]:
    """Active doctors and therapists a booking can be assigned to.

    Scoped like everything else, so reception at one site cannot book a
    clinician who works at another.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    wanted = [role] if role else [UserRole.DOCTOR, UserRole.THERAPIST]

    options: list[ClinicianOption] = []
    for each in wanted:
        rows, _ = repo.list_users(
            db, branch_ids=branch_ids, role=each, status=UserStatus.ACTIVE, limit=100
        )
        options.extend(
            ClinicianOption(
                id=row.user_number,
                uuid=str(row.id),
                name=row.full_name,
                role=row.role,
                designation=row.designation or "",
                department=row.department.name if row.department else "",
                branch=row.branch.name if row.branch else "",
            )
            for row in rows
        )
    return sorted(options, key=lambda option: option.name)


def get_user(db: Session, *, identifier: str, user: User, permissions: list[str]) -> UserResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    return user_out(_resolve_user(db, identifier, branch_ids))


def create_user(
    db: Session, *, payload: UserCreate, user: User, permissions: list[str], ip: str | None
) -> UserCreated:
    """Invite a staff member.

    The account is created `pending`, which is what the invite dialog already
    says happens, and cannot sign in until an administrator approves it. A
    temporary password is generated and hashed with Argon2 — the plaintext is
    returned once to the administrator and never stored or logged, because this
    build has no mail server and inventing one is out of scope.
    """
    branch_ids = visible_branch_ids(db, user, permissions)

    if repo.get_user_by_email(db, payload.email) is not None:
        raise ConflictError(
            f"{payload.email} already belongs to another account.", code="email_taken"
        )

    branch_id = _assign_branch(db, payload.branchId, user, branch_ids)
    department_id = _assign_department(db, payload.department, branch_id)

    first, last = _split_name(payload.name)
    number = USER.format(repo.next_user_number(db))
    temporary = generate_temporary_password()

    account = User(
        user_number=number,
        first_name=first,
        last_name=last,
        email=payload.email.strip().lower(),
        phone=payload.phone,
        password_hash=hash_password(temporary),
        role=payload.role,
        # Never taken from the request. An invitation produces a pending
        # account, and only an administrator's approval activates it.
        status=UserStatus.PENDING,
        designation=payload.designation or payload.role.display,
        department_id=department_id,
        branch_id=branch_id,
        avatar_color=_avatar_colour(number),
        initials=_initials(first, last),
    )
    db.add(account)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        logger.warning("Staff invitation rejected by a uniqueness constraint")
        raise ConflictError(
            "That email address already belongs to another account.", code="email_taken"
        ) from None

    _audit(
        db,
        user,
        "USER_CREATED",
        "users",
        account.id,
        f"{number}: {account.full_name} invited as {payload.role.value}",
        ip,
    )
    db.commit()
    db.refresh(account)

    # The password itself is never logged, here or anywhere.
    logger.info("Staff account %s invited by %s", number, user.id)
    return UserCreated(user=user_out(account), temporaryPassword=temporary)


def update_user(
    db: Session,
    *,
    identifier: str,
    payload: UserUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> UserResponse:
    """Amend a staff member.

    A role change takes effect on that account's next request, because both the
    role and its permissions are read from the database rather than from
    whatever token the user is holding.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    target = _resolve_user(db, identifier, branch_ids)
    changes: list[str] = []

    if payload.email is not None and payload.email.strip().lower() != target.email:
        clash = repo.get_user_by_email(db, payload.email)
        if clash is not None and clash.id != target.id:
            raise ConflictError(
                f"{payload.email} already belongs to another account.", code="email_taken"
            )
        target.email = payload.email.strip().lower()
        changes.append("email")

    if payload.name is not None:
        first, last = _split_name(payload.name)
        target.first_name, target.last_name = first, last
        target.initials = _initials(first, last)
        changes.append("name")

    if payload.role is not None and payload.role is not target.role:
        # Only an owner may hand out the owner role — an administrator granting
        # it would be promoting someone above themselves.
        if payload.role is UserRole.OWNER and user.role is not UserRole.OWNER:
            raise ForbiddenError(
                "Only an owner can grant the owner role.", code="owner_role_protected"
            )
        if target.role is UserRole.OWNER and user.role is not UserRole.OWNER:
            raise ForbiddenError(
                "Only an owner can change an owner's role.", code="owner_role_protected"
            )
        changes.append(f"role {target.role.value} to {payload.role.value}")
        target.role = payload.role

    if payload.designation is not None:
        target.designation = payload.designation.strip() or None
    if payload.phone is not None:
        target.phone = payload.phone.strip() or None

    if payload.branchId is not None:
        branch_id = _assign_branch(db, payload.branchId, target, branch_ids)
        if branch_id != target.branch_id:
            changes.append("branch")
        target.branch_id = branch_id
        # The department has to follow the branch, or a user ends up filed
        # under a department at a site they no longer work at.
        target.department_id = _assign_department(
            db, payload.department or (target.department.name if target.department else None), branch_id
        )
    elif payload.department is not None:
        target.department_id = _assign_department(db, payload.department, target.branch_id)

    _audit(
        db,
        user,
        "USER_UPDATED",
        "users",
        target.id,
        f"{target.user_number}: {', '.join(changes) if changes else 'details amended'}",
        ip,
    )
    db.commit()
    db.refresh(target)
    return user_out(target)


def set_user_status(
    db: Session,
    *,
    identifier: str,
    status: UserStatus,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> UserResponse:
    """Approve, suspend or reinstate an account.

    A suspension takes effect immediately rather than when the token expires:
    every request re-reads the account's status, so the next call the suspended
    user makes is refused even though their token is still perfectly valid.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    target = _resolve_user(db, identifier, branch_ids)

    if target.id == user.id and status is UserStatus.SUSPENDED:
        # Deliberate rather than incidental: the staff screen offers Suspend on
        # every active row, including the administrator's own.
        raise UnprocessableError(
            "You cannot suspend your own account. Ask another administrator to do it.",
            code="cannot_suspend_self",
        )

    if target.role is UserRole.OWNER and user.role is not UserRole.OWNER:
        raise ForbiddenError(
            "Only an owner can change an owner's account status.", code="owner_protected"
        )

    if target.status is status:
        return user_out(target)

    if status not in ALLOWED_TRANSITIONS.get(target.status, set()):
        raise UnprocessableError(
            f"An account cannot go from {target.status.value} to {status.value}.",
            code="invalid_status_transition",
        )

    was = target.status
    target.status = status

    _audit(
        db,
        user,
        {
            UserStatus.ACTIVE: "USER_ACTIVATED",
            UserStatus.SUSPENDED: "USER_SUSPENDED",
            UserStatus.PENDING: "USER_SET_PENDING",
        }[status],
        "users",
        target.id,
        f"{target.user_number}: {was.value} to {status.value}",
        ip,
    )
    db.commit()
    db.refresh(target)

    logger.info("Account %s moved from %s to %s by %s", target.user_number, was.value, status.value, user.id)
    return user_out(target)


# ---------------------------------------------------------------------------
# Roles and the permission matrix
# ---------------------------------------------------------------------------


def list_permissions(db: Session) -> list[PermissionResponse]:
    return [
        PermissionResponse(
            key=row.key, name=row.name, group=row.group, description=row.description
        )
        for row in repo.list_permissions(db)
    ]


def list_roles(db: Session, *, user: User, permissions: list[str]) -> list[RoleResponse]:
    """Every role, what it can do and how many people hold it."""
    branch_ids = visible_branch_ids(db, user, permissions)
    granted = repo.matrix(db)
    headcount = repo.headcount_by_role(db, branch_ids)
    return [
        RoleResponse(
            id=role,
            label=role.display,
            permissions=granted.get(role, []),
            headcount=headcount.get(role, 0),
        )
        for role in UserRole
    ]


def get_role(db: Session, *, role: UserRole, user: User, permissions: list[str]) -> RoleResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    return RoleResponse(
        id=role,
        label=role.display,
        permissions=repo.matrix(db).get(role, []),
        headcount=repo.headcount_by_role(db, branch_ids).get(role, 0),
    )


def set_role_permissions(
    db: Session,
    *,
    role: UserRole,
    payload: RolePermissionsUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> RoleResponse:
    """Replace a role's permission set, transactionally.

    Every key is resolved before anything is deleted, so an unknown one fails
    the whole request rather than leaving the role stripped of the permissions
    it had. The delete and the inserts share one transaction: the role is never
    observable with a partial set.
    """
    if role is UserRole.OWNER and user.role is not UserRole.OWNER:
        # The Roles screen lets an administrator select any role, owner
        # included. Editing that one is the owner's own to do.
        raise ForbiddenError(
            "Only an owner can change the owner role's permissions.",
            code="owner_role_protected",
        )

    wanted = sorted({key.strip() for key in payload.permissions if key and key.strip()})
    found = repo.permissions_by_key(db, wanted)
    unknown = [key for key in wanted if key not in found]
    if unknown:
        raise UnprocessableError(
            f"Unknown permission key(s): {', '.join(unknown)}.", code="unknown_permission"
        )

    before = set(repo.matrix(db).get(role, []))
    repo.replace_role_permissions(db, role, [found[key] for key in wanted])

    after = set(wanted)
    added = sorted(after - before)
    removed = sorted(before - after)
    summary = f"{role.value}: +{len(added)} -{len(removed)}"
    if added or removed:
        summary += f" ({', '.join(added + ['-' + key for key in removed])})"

    _audit(db, user, "ROLE_PERMISSIONS_UPDATED", "role_permissions", None, summary, ip)
    db.commit()

    logger.info("Permissions for %s changed by %s: +%s -%s", role.value, user.id, len(added), len(removed))
    return get_role(db, role=role, user=user, permissions=permissions)


# ---------------------------------------------------------------------------
# Branches
# ---------------------------------------------------------------------------


def list_branches(db: Session, *, user: User, permissions: list[str]) -> list[BranchResponse]:
    branch_ids = visible_branch_ids(db, user, permissions)
    staff = repo.branch_staff_counts(db)
    patients = repo.branch_patient_counts(db)
    return [
        branch_out(row, staff.get(row.id, 0), patients.get(row.id, 0))
        for row in repo.list_branches(db, branch_ids)
    ]


def get_branch(db: Session, *, identifier: str, user: User, permissions: list[str]) -> BranchResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    row = _resolve_branch(db, identifier, branch_ids)
    return branch_out(
        row,
        repo.branch_staff_counts(db).get(row.id, 0),
        repo.branch_patient_counts(db).get(row.id, 0),
    )


def create_branch(
    db: Session, *, payload: BranchCreate, user: User, permissions: list[str], ip: str | None
) -> BranchResponse:
    if repo.find_branch_by_name(db, payload.name) is not None:
        raise ConflictError(f"A branch called {payload.name} already exists.", code="branch_exists")

    branch = Branch(
        name=payload.name.strip(),
        city=payload.city,
        address=payload.address,
        phone=payload.phone,
        email=str(payload.email) if payload.email else None,
        opens_at=payload.opensAt,
        closes_at=payload.closesAt,
        licensed_beds=payload.beds,
        is_configured=payload.configured,
        services=list(payload.services),
    )
    db.add(branch)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError(
            f"A branch called {payload.name} already exists.", code="branch_exists"
        ) from None

    _audit(
        db, user, "BRANCH_CREATED", "branches", branch.id, branch.name, ip, AuditCategory.SYSTEM
    )
    db.commit()
    db.refresh(branch)
    return branch_out(branch)


def update_branch(
    db: Session,
    *,
    identifier: str,
    payload: BranchUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> BranchResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    branch = _resolve_branch(db, identifier, branch_ids)

    if payload.name is not None and payload.name.strip().lower() != branch.name.lower():
        clash = repo.find_branch_by_name(db, payload.name)
        if clash is not None and clash.id != branch.id:
            raise ConflictError(
                f"A branch called {payload.name} already exists.", code="branch_exists"
            )
        branch.name = payload.name.strip()

    if payload.city is not None:
        branch.city = payload.city.strip() or None
    if payload.address is not None:
        branch.address = payload.address.strip() or None
    if payload.phone is not None:
        branch.phone = payload.phone.strip() or None
    if payload.email is not None:
        branch.email = str(payload.email)
    if payload.opensAt is not None:
        branch.opens_at = payload.opensAt
    if payload.closesAt is not None:
        branch.closes_at = payload.closesAt
    if payload.beds is not None:
        branch.licensed_beds = payload.beds
    if payload.configured is not None:
        branch.is_configured = payload.configured
    if payload.services is not None:
        branch.services = list(payload.services)

    _audit(
        db, user, "BRANCH_UPDATED", "branches", branch.id, branch.name, ip, AuditCategory.SYSTEM
    )
    db.commit()
    db.refresh(branch)
    return branch_out(branch)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


def _coerce(key: str, value: Any) -> Any:
    """Hold a setting to its declared type.

    The column is JSONB, so a boolean stays a boolean and a number stays a
    number — the screen's toggles and numeric fields never have to parse a
    string back out.
    """
    kind = SETTING_TYPES[key]
    try:
        if kind == "boolean":
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.strip().lower() in {"true", "1", "yes", "on"}
            return bool(value)
        if kind == "integer":
            return int(value)
        if kind == "decimal":
            # JSON has one number type; a float here is the transport, not the
            # storage, and no money is computed from these values.
            return float(value)
        if kind == "string":
            text = str(value).strip()
            if not text:
                raise ValueError
            return text
        return value
    except (TypeError, ValueError) as exc:
        raise UnprocessableError(
            f"{key} must be a {kind}.", code="invalid_setting_value"
        ) from exc


def list_settings(db: Session) -> list[SettingResponse]:
    """The configuration screen's values, with defaults for anything unsaved.

    No secret is served here and none can be: the accepted keys are a fixed
    list of clinic configuration, and the JWT secret, the database password and
    every other credential live in the environment, not in this table.
    """
    stored = {row.key: row for row in repo.list_settings(db)}
    out: list[SettingResponse] = []
    for key, kind in SETTING_TYPES.items():
        row = stored.get(key)
        out.append(
            SettingResponse(
                key=key,
                value=row.value.get("value") if row else SETTING_DEFAULTS[key],
                type=kind,
                updatedAt=row.updated_at if row else None,
                updatedBy="",
            )
        )
    return out


def update_settings(
    db: Session, *, payload: SettingsUpdate, user: User, ip: str | None
) -> list[SettingResponse]:
    """Save the configuration screen, in one transaction."""
    unknown = [key for key in payload.values if key not in SETTING_TYPES]
    if unknown:
        raise UnprocessableError(
            f"Unknown setting(s): {', '.join(sorted(unknown))}.", code="unknown_setting"
        )

    # Coerce everything before writing anything, so one bad value cannot leave
    # the configuration half-saved.
    coerced = {key: _coerce(key, value) for key, value in payload.values.items()}

    for key, value in coerced.items():
        row = repo.get_setting(db, key)
        if row is None:
            row = Setting(branch_id=None, key=key, value={"value": value})
            db.add(row)
        else:
            row.value = {"value": value}
        row.updated_by = user.id

    _audit(
        db,
        user,
        "SETTINGS_UPDATED",
        "settings",
        None,
        f"{len(coerced)} setting(s): {', '.join(sorted(coerced))}",
        ip,
        AuditCategory.SYSTEM,
    )
    db.commit()

    logger.info("System settings updated by %s: %s", user.id, ", ".join(sorted(coerced)))
    return list_settings(db)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


def list_audit(
    db: Session,
    *,
    page: int = 1,
    limit: int = 50,
    actor: str | None = None,
    action: str | None = None,
    category: AuditCategory | None = None,
    target_type: str | None = None,
    search: str | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    user: User,
    permissions: list[str],
) -> AuditPage:
    """Read the audit trail.

    There is no write path. The table is append-only by construction — nothing
    in this module updates or deletes an entry, and no endpoint exposes one.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    actor_id = _resolve_user(db, actor, branch_ids).id if actor else None

    rows, total = repo.list_audit(
        db,
        user_id=actor_id,
        action=action,
        category=category,
        target_type=target_type,
        search=search,
        date_from=date_from,
        date_to=date_to,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return AuditPage(
        items=[audit_out(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


def dashboard(db: Session, *, user: User, permissions: list[str]) -> AdminDashboard:
    """The administrator's own view, counted in PostgreSQL.

    Deliberately narrow. Every other module already has a dashboard; copying
    their figures here would mean two places to keep correct.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    counts = repo.staff_counts(db, branch_ids)
    total_branches, unconfigured = repo.count_branches(db, branch_ids)
    granted = repo.matrix(db)

    return AdminDashboard(
        staff=StaffCounts(**counts),
        branches=total_branches,
        unconfiguredBranches=unconfigured,
        departments=repo.count_departments(db, branch_ids),
        totalPatients=repo.count_patients(db, branch_ids),
        # A role nobody can do anything with is a configuration mistake worth
        # surfacing rather than leaving for someone to discover by being locked
        # out of their own screens.
        rolesWithoutPermissions=[role for role in UserRole if not granted.get(role)],
    )
