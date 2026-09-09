"""Per-user notifications.

The frontend targets notifications by *role*; here they belong to a specific
user, which is what allows read state to be tracked per person. Fan-out from a
role to its users happens in the notification service in a later step.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import NotificationIcon, NotificationSeverity, pg_enum
from app.models.base import Base, CreatedAtMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.user import User


class Notification(UUIDMixin, CreatedAtMixin, Base):
    """One alert for one user."""

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_id", "user_id"),
        Index("ix_notifications_read", "read"),
        # Serves the bell menu directly: this user's unread, newest first.
        Index("ix_notifications_user_read_created", "user_id", "read", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[NotificationIcon] = mapped_column(
        pg_enum(NotificationIcon, "notification_icon"), nullable=False
    )
    severity: Mapped[NotificationSeverity] = mapped_column(
        pg_enum(NotificationSeverity, "notification_severity"),
        nullable=False,
        default=NotificationSeverity.INFO,
    )
    read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Frontend route the notification deep-links to, e.g. /pharmacy/alerts.
    href: Mapped[str | None] = mapped_column(String(255))

    user: Mapped["User"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Notification {self.title!r} read={self.read}>"
