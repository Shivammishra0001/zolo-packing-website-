"""Branches, departments, settings and the consultation fee schedule."""

from __future__ import annotations

import uuid
from datetime import datetime, time
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import (
    AppointmentType,
    DepartmentType,
    pg_enum,
)
from app.models.base import Base, TimestampMixin, UUIDMixin, money, percentage

if TYPE_CHECKING:
    from app.models.billing import Expense
    from app.models.patient import Patient
    from app.models.user import User
    from app.models.ward import Ward


class Branch(UUIDMixin, TimestampMixin, Base):
    """A physical site. Users, departments, wards and expenses hang off it."""

    __tablename__ = "branches"

    name: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    city: Mapped[str | None] = mapped_column(String(80))
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(255))
    opens_at: Mapped[time | None] = mapped_column(Time)
    closes_at: Mapped[time | None] = mapped_column(Time)
    licensed_beds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_configured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Service toggles shown on the admin Branches screen, e.g. ["OPD", "Pharmacy"].
    services: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    departments: Mapped[list["Department"]] = relationship(
        back_populates="branch", cascade="all, delete-orphan", passive_deletes=True
    )
    users: Mapped[list["User"]] = relationship(back_populates="branch")
    wards: Mapped[list["Ward"]] = relationship(
        back_populates="branch", cascade="all, delete-orphan", passive_deletes=True
    )
    expenses: Mapped[list["Expense"]] = relationship(back_populates="branch")
    patients: Mapped[list["Patient"]] = relationship(back_populates="branch")
    settings: Mapped[list["Setting"]] = relationship(
        back_populates="branch", cascade="all, delete-orphan", passive_deletes=True
    )
    consultation_fees: Mapped[list["ConsultationFee"]] = relationship(
        back_populates="branch", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Branch {self.name!r}>"


class Department(UUIDMixin, TimestampMixin, Base):
    """Clinical, therapy or support unit within a branch."""

    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("branch_id", "name", name="uq_departments_branch_name"),)

    branch_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[DepartmentType] = mapped_column(
        pg_enum(DepartmentType, "department_type"), nullable=False
    )
    # departments.head_user_id and users.department_id reference each other, so
    # one side must be added after both tables exist. use_alter makes Alembic
    # emit it as a separate ALTER TABLE instead of an unsatisfiable inline FK.
    head_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_departments_head_user_id_users",
        ),
    )
    rooms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # --- Derived values -----------------------------------------------------
    # staff_count, monthly_revenue and utilisation are shown on the admin
    # Departments screen. They are DERIVED: staff_count from users, revenue from
    # invoices, utilisation from appointments. The columns exist as a cache the
    # reporting service may refresh; they are NOT the source of truth and must
    # never be written from a client request.
    staff_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    monthly_revenue: Mapped[Decimal] = money()
    utilisation: Mapped[Decimal | None] = percentage()

    branch: Mapped["Branch"] = relationship(back_populates="departments")
    head: Mapped["User | None"] = relationship(foreign_keys=[head_user_id])
    members: Mapped[list["User"]] = relationship(
        back_populates="department", foreign_keys="User.department_id"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Department {self.name!r}>"


class Setting(UUIDMixin, Base):
    """Key/value configuration, optionally scoped to a branch.

    A NULL ``branch_id`` means an organisation-wide default.
    """

    __tablename__ = "settings"
    __table_args__ = (UniqueConstraint("branch_id", "key", name="uq_settings_branch_key"),)

    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    branch: Mapped["Branch | None"] = relationship(back_populates="settings")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Setting {self.key!r}>"


class ConsultationFee(UUIDMixin, TimestampMixin, Base):
    """Fee per appointment type, used by the receptionist registration flow."""

    __tablename__ = "consultation_fees"
    __table_args__ = (
        UniqueConstraint("branch_id", "appointment_type", name="uq_consultation_fees_branch_type"),
    )

    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), index=True
    )
    appointment_type: Mapped[AppointmentType] = mapped_column(
        pg_enum(AppointmentType, "appointment_type"), nullable=False
    )
    fee: Mapped[Decimal] = money()
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    branch: Mapped["Branch | None"] = relationship(back_populates="consultation_fees")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ConsultationFee {self.appointment_type} {self.fee}>"
