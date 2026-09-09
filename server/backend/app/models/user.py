"""Staff accounts, the permission catalogue and the role→permission matrix."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import PermissionGroup, UserRole, UserStatus, pg_enum
from app.models.base import Base, CreatedAtMixin, TimestampMixin, UUIDMixin, short_code

if TYPE_CHECKING:
    from app.models.organisation import Branch, Department


class User(UUIDMixin, TimestampMixin, Base):
    """A staff member. ``role`` drives navigation and permissions."""

    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_role", "role"),
        Index("ix_users_branch_id", "branch_id"),
        Index("ix_users_status", "status"),
    )

    #: Human-readable code shown in the UI, e.g. USR-1004.
    user_number: Mapped[str] = short_code(16)

    first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    last_name: Mapped[str] = mapped_column(String(80), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32))

    #: bcrypt hash. The plaintext password is never stored or logged.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        pg_enum(UserStatus, "user_status"), nullable=False, default=UserStatus.PENDING
    )

    designation: Mapped[str | None] = mapped_column(String(160))
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL")
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("branches.id", ondelete="SET NULL")
    )

    #: Presentation values the frontend renders directly on avatars.
    avatar_color: Mapped[str | None] = mapped_column(String(80))
    initials: Mapped[str | None] = mapped_column(String(4))

    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    branch: Mapped["Branch | None"] = relationship(back_populates="users")
    department: Mapped["Department | None"] = relationship(
        back_populates="members", foreign_keys=[department_id]
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.email!r} role={self.role.value}>"


class Permission(UUIDMixin, Base):
    """One of the 33 permission codes the frontend already checks against."""

    __tablename__ = "permissions"

    #: Dotted code, e.g. ``therapy.session.manage``. Matches the frontend exactly.
    key: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    group: Mapped[PermissionGroup] = mapped_column(
        pg_enum(PermissionGroup, "permission_group"), nullable=False
    )
    description: Mapped[str | None] = mapped_column(Text)

    role_links: Mapped[list["RolePermission"]] = relationship(
        back_populates="permission", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Permission {self.key!r}>"


class RolePermission(UUIDMixin, CreatedAtMixin, Base):
    """Editable role→permission matrix backing the admin Roles screen.

    There is no separate ``roles`` table: the role enum is the identifier, which
    keeps the matrix a simple join and matches how the frontend models roles.
    """

    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role", "permission_id", name="uq_role_permissions_role_permission"),
        Index("ix_role_permissions_role", "role"),
    )

    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"), nullable=False)
    permission_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False
    )

    permission: Mapped["Permission"] = relationship(back_populates="role_links")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<RolePermission {self.role.value}>"
