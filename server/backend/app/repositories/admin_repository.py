"""Data access for staff, the permission matrix, branches, settings and audit.

Filtering happens in PostgreSQL, not in Python. A staff directory is small
today and will not stay small, and an audit table only ever grows — loading
either one to filter it in the application is a bug waiting for the clinic to
succeed.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import date as date_type, datetime

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.enums import AuditCategory, UserRole, UserStatus
from app.models.audit import AuditLog
from app.models.organisation import Branch, Department, Setting
from app.models.patient import Patient
from app.models.user import Permission, RolePermission, User

_USER_RELATIONS = (joinedload(User.branch), joinedload(User.department))


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


def get_user(db: Session, user_id: uuid_lib.UUID) -> User | None:
    return (
        db.execute(select(User).options(*_USER_RELATIONS).where(User.id == user_id))
        .unique()
        .scalar_one_or_none()
    )


def get_user_by_number(db: Session, number: str) -> User | None:
    return (
        db.execute(
            select(User)
            .options(*_USER_RELATIONS)
            .where(func.upper(User.user_number) == number.strip().upper())
        )
        .unique()
        .scalar_one_or_none()
    )


def get_user_by_email(db: Session, email: str) -> User | None:
    """Case-insensitive, because that is how people type their own address."""
    return db.execute(
        select(User).where(func.lower(User.email) == email.strip().lower())
    ).scalar_one_or_none()


def next_user_number(db: Session) -> int:
    """Next ``USR-####`` suffix, serialised so two invitations cannot collide."""
    from sqlalchemy import Integer, text

    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": "code:USR"})
    current = db.execute(
        select(
            func.coalesce(
                func.max(func.cast(func.split_part(User.user_number, "-", 2), Integer)), 1000
            )
        ).where(User.user_number.like("USR-%"))
    ).scalar_one()
    return int(current) + 1


def _user_visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    if branch_ids is None:
        return stmt
    if not branch_ids:
        return stmt.where(func.false())
    # Staff with no branch are organisation-wide; a branch-bound administrator
    # is not shown them, because none of them report to their site.
    return stmt.where(User.branch_id.in_(branch_ids))


def list_users(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    search: str | None = None,
    role: UserRole | None = None,
    status: UserStatus | None = None,
    branch_id: uuid_lib.UUID | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[User], int]:
    stmt = _user_visible(select(User), branch_ids)

    if role is not None:
        stmt = stmt.where(User.role == role)
    if status is not None:
        stmt = stmt.where(User.status == status)
    if branch_id is not None:
        stmt = stmt.where(User.branch_id == branch_id)
    if search:
        term = f"%{search.strip().lower()}%"
        stmt = stmt.outerjoin(Department, User.department_id == Department.id).where(
            or_(
                func.lower(User.first_name + " " + User.last_name).like(term),
                func.lower(User.email).like(term),
                func.lower(User.user_number).like(term),
                func.lower(func.coalesce(Department.name, "")).like(term),
                func.lower(func.coalesce(User.designation, "")).like(term),
            )
        )

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(User.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(
            stmt.options(*_USER_RELATIONS)
            .order_by(User.first_name, User.last_name)
            .offset(offset)
            .limit(limit)
        )
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


def staff_counts(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> dict[str, int]:
    """Headcount by status, in one grouped query rather than four."""
    stmt = _user_visible(select(User.status, func.count(User.id)), branch_ids).group_by(User.status)
    by_status = {status: int(count) for status, count in db.execute(stmt).all()}
    return {
        "total": sum(by_status.values()),
        "active": by_status.get(UserStatus.ACTIVE, 0),
        "pending": by_status.get(UserStatus.PENDING, 0),
        "suspended": by_status.get(UserStatus.SUSPENDED, 0),
    }


def headcount_by_role(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> dict[UserRole, int]:
    stmt = _user_visible(select(User.role, func.count(User.id)), branch_ids).group_by(User.role)
    return {role: int(count) for role, count in db.execute(stmt).all()}


# ---------------------------------------------------------------------------
# Permissions and the matrix
# ---------------------------------------------------------------------------


def list_permissions(db: Session) -> list[Permission]:
    return list(
        db.execute(select(Permission).order_by(Permission.group, Permission.key)).scalars().all()
    )


def permissions_by_key(db: Session, keys: list[str]) -> dict[str, Permission]:
    if not keys:
        return {}
    rows = db.execute(select(Permission).where(Permission.key.in_(keys))).scalars().all()
    return {row.key: row for row in rows}


def matrix(db: Session) -> dict[UserRole, list[str]]:
    """The whole role→permission matrix, in one query.

    The Roles screen renders every role against every permission, so fetching
    them one role at a time would be eight round trips to draw one table.
    """
    stmt = (
        select(RolePermission.role, Permission.key)
        .join(Permission, RolePermission.permission_id == Permission.id)
        .order_by(RolePermission.role, Permission.key)
    )
    grouped: dict[UserRole, list[str]] = {role: [] for role in UserRole}
    for role, key in db.execute(stmt).all():
        grouped[role].append(key)
    return grouped


def replace_role_permissions(db: Session, role: UserRole, permissions: list[Permission]) -> None:
    """Swap a role's whole permission set.

    Delete-then-insert inside the caller's transaction: the role is never
    visible with a partial set, because nothing commits until both halves are
    done. A diff would be fewer statements and far more ways to go wrong.
    """
    db.execute(
        RolePermission.__table__.delete().where(RolePermission.role == role)
    )
    db.flush()
    for permission in permissions:
        db.add(RolePermission(role=role, permission_id=permission.id))
    db.flush()


# ---------------------------------------------------------------------------
# Branches and departments
# ---------------------------------------------------------------------------


def get_branch(db: Session, branch_id: uuid_lib.UUID) -> Branch | None:
    return db.execute(select(Branch).where(Branch.id == branch_id)).scalar_one_or_none()


def find_branch_by_name(db: Session, name: str) -> Branch | None:
    return db.execute(
        select(Branch).where(func.lower(Branch.name) == name.strip().lower())
    ).scalar_one_or_none()


def list_branches(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> list[Branch]:
    stmt = select(Branch).order_by(Branch.name)
    if branch_ids is not None:
        if not branch_ids:
            return []
        stmt = stmt.where(Branch.id.in_(branch_ids))
    return list(db.execute(stmt).scalars().all())


def branch_staff_counts(db: Session) -> dict[uuid_lib.UUID, int]:
    stmt = (
        select(User.branch_id, func.count(User.id))
        .where(User.branch_id.is_not(None))
        .group_by(User.branch_id)
    )
    return {branch_id: int(count) for branch_id, count in db.execute(stmt).all()}


def branch_patient_counts(db: Session) -> dict[uuid_lib.UUID, int]:
    stmt = (
        select(Patient.branch_id, func.count(Patient.id))
        .where(Patient.branch_id.is_not(None))
        .group_by(Patient.branch_id)
    )
    return {branch_id: int(count) for branch_id, count in db.execute(stmt).all()}


def find_department(db: Session, branch_id: uuid_lib.UUID | None, name: str) -> Department | None:
    stmt = select(Department).where(func.lower(Department.name) == name.strip().lower())
    if branch_id is not None:
        stmt = stmt.where(Department.branch_id == branch_id)
    return db.execute(stmt).scalars().first()


def count_departments(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> int:
    stmt = select(func.count(Department.id))
    if branch_ids is not None:
        if not branch_ids:
            return 0
        stmt = stmt.where(Department.branch_id.in_(branch_ids))
    return int(db.execute(stmt).scalar_one())


def count_patients(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> int:
    stmt = select(func.count(Patient.id))
    if branch_ids is not None:
        if not branch_ids:
            return 0
        stmt = stmt.where(Patient.branch_id.in_(branch_ids))
    return int(db.execute(stmt).scalar_one())


def count_branches(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> tuple[int, int]:
    """Total branches, and how many are still unconfigured."""
    stmt = select(func.count(Branch.id), func.count(Branch.id).filter(~Branch.is_configured))
    if branch_ids is not None:
        if not branch_ids:
            return 0, 0
        stmt = stmt.where(Branch.id.in_(branch_ids))
    total, unconfigured = db.execute(stmt).one()
    return int(total), int(unconfigured)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


def list_settings(db: Session) -> list[Setting]:
    """Organisation-wide settings. Branch overrides are not exposed yet.

    The configuration screen says its changes "apply to every branch
    immediately", so it edits the organisation-wide row and nothing else.
    """
    return list(
        db.execute(select(Setting).where(Setting.branch_id.is_(None)).order_by(Setting.key))
        .scalars()
        .all()
    )


def get_setting(db: Session, key: str) -> Setting | None:
    return db.execute(
        select(Setting).where(Setting.branch_id.is_(None), Setting.key == key)
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


def list_audit(
    db: Session,
    *,
    user_id: uuid_lib.UUID | None = None,
    action: str | None = None,
    category: AuditCategory | None = None,
    target_type: str | None = None,
    search: str | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[AuditLog], int]:
    stmt = select(AuditLog)

    if user_id is not None:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if action:
        stmt = stmt.where(func.upper(AuditLog.action) == action.strip().upper())
    if category is not None:
        stmt = stmt.where(AuditLog.category == category)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type.strip())
    if date_from is not None:
        stmt = stmt.where(func.date(AuditLog.created_at) >= date_from)
    if date_to is not None:
        stmt = stmt.where(func.date(AuditLog.created_at) <= date_to)
    if search:
        term = f"%{search.strip().lower()}%"
        stmt = stmt.outerjoin(User, AuditLog.user_id == User.id).where(
            or_(
                func.lower(AuditLog.action).like(term),
                func.lower(func.coalesce(AuditLog.summary, "")).like(term),
                func.lower(func.coalesce(User.first_name + " " + User.last_name, "")).like(term),
            )
        )

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(AuditLog.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(
            stmt.options(joinedload(AuditLog.user))
            .order_by(AuditLog.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total
