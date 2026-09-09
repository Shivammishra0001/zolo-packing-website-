"""Audit trail.

Append-only. ``user_id`` is ``SET NULL`` on delete so the record of what
happened survives the removal of the account that did it.

Writing entries automatically is a later step; this is the storage only.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import INET, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import AuditCategory, pg_enum
from app.models.base import Base, CreatedAtMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.user import User


class AuditLog(UUIDMixin, CreatedAtMixin, Base):
    """One recorded action."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_user_id", "user_id"),
        Index("ix_audit_logs_created_at", "created_at"),
        Index("ix_audit_logs_target", "target_type", "target_id"),
        Index("ix_audit_logs_action", "action"),
        Index("ix_audit_logs_category", "category"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    #: Verb constant, e.g. LOGIN, PATIENT_CREATED, MEDICINE_DISPENSED.
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    category: Mapped[AuditCategory] = mapped_column(
        pg_enum(AuditCategory, "audit_category"), nullable=False
    )
    #: Table or entity name the action applied to.
    target_type: Mapped[str | None] = mapped_column(String(80))
    target_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    #: Human-readable one-line description for the audit screen.
    summary: Mapped[str | None] = mapped_column(Text)

    ip_address: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(255))

    user: Mapped["User | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AuditLog {self.action} at {self.created_at}>"
