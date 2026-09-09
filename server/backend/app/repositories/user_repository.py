"""Data access for users and their effective permissions.

Pure queries — no business rules, no transaction management.
"""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.enums import UserRole, UserStatus
from app.models.organisation import Branch, Department
from app.models.user import Permission, RolePermission, User


def get_by_email(db: Session, email: str) -> User | None:
    """Case-insensitive lookup — email is stored as entered but matched loosely."""
    stmt = (
        select(User)
        .options(joinedload(User.branch), joinedload(User.department))
        .where(User.email.ilike(email.strip()))
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def get_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    stmt = (
        select(User)
        .options(joinedload(User.branch), joinedload(User.department))
        .where(User.id == user_id)
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def active_by_roles(
    db: Session, roles: tuple[UserRole, ...], branch_id: uuid.UUID | None
) -> list[User]:
    """Who should hear about an event at one site.

    Active accounts only — a suspended or pending user cannot act on an alert,
    so sending them one just inflates a badge nobody will clear. Staff with no
    branch are organisation-wide and are included alongside the site's own.
    """
    stmt = select(User).where(User.role.in_(roles), User.status == UserStatus.ACTIVE)
    if branch_id is not None:
        stmt = stmt.where(or_(User.branch_id == branch_id, User.branch_id.is_(None)))
    return list(db.execute(stmt.order_by(User.first_name)).unique().scalars().all())


def permissions_for_role(db: Session, role: UserRole) -> list[str]:
    """Effective permission keys for a role, read live from the matrix.

    Resolved per request rather than cached in the token, so an administrator
    editing the matrix takes effect immediately.
    """
    stmt = (
        select(Permission.key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role == role)
        .order_by(Permission.key)
    )
    return list(db.execute(stmt).scalars().all())


def touch_last_login(db: Session, user: User) -> None:
    """Record the sign-in time. The caller owns the transaction."""
    from datetime import datetime, timezone

    user.last_login = datetime.now(timezone.utc)
    db.add(user)


def branch_name(user: User) -> str | None:
    branch: Branch | None = user.branch
    return branch.name if branch else None


def department_name(user: User) -> str | None:
    department: Department | None = user.department
    return department.name if department else None
