"""Wards, beds, admissions, nursing tasks and the discharge checklist.

The frontend models a ward as a bare string. Here it is a real relationship —
``Branch -> Ward -> Bed`` — so occupancy can be reported per branch and beds
cannot drift into wards that do not exist.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import (
    AdmissionStatus,
    BedStatus,
    BedType,
    NursingTaskType,
    TaskPriority,
    pg_enum,
)
from app.models.base import Base, CreatedAtMixin, TimestampMixin, UUIDMixin, money

if TYPE_CHECKING:
    from app.models.organisation import Branch
    from app.models.patient import Patient
    from app.models.user import User


class Ward(UUIDMixin, CreatedAtMixin, Base):
    """A named ward within a branch."""

    __tablename__ = "wards"
    __table_args__ = (UniqueConstraint("branch_id", "name", name="uq_wards_branch_name"),)

    branch_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    branch: Mapped["Branch"] = relationship(back_populates="wards")
    beds: Mapped[list["Bed"]] = relationship(
        back_populates="ward", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Ward {self.name!r}>"


class Bed(UUIDMixin, TimestampMixin, Base):
    """A physical bed.

    ``status`` is the housekeeping/occupancy state shown on the bed board.
    Whether a *patient* is in it is the ``admissions`` table's business —
    ``patient_id`` here is a denormalised convenience for the board view and is
    maintained by the admission service.
    """

    __tablename__ = "beds"
    __table_args__ = (
        UniqueConstraint("ward_id", "bed_number", name="uq_beds_ward_bed_number"),
        Index("ix_beds_status", "status"),
        Index("ix_beds_ward_id", "ward_id"),
    )

    ward_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("wards.id", ondelete="CASCADE"), nullable=False
    )
    room: Mapped[str | None] = mapped_column(String(40))
    bed_number: Mapped[str] = mapped_column(String(40), nullable=False)
    type: Mapped[BedType] = mapped_column(pg_enum(BedType, "bed_type"), nullable=False)
    status: Mapped[BedStatus] = mapped_column(
        pg_enum(BedStatus, "bed_status"), nullable=False, default=BedStatus.AVAILABLE
    )
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="SET NULL")
    )
    #: Free-text holder for a reservation made against someone not yet
    #: registered as a patient (the frontend does this today).
    reserved_for: Mapped[str | None] = mapped_column(String(160))
    daily_rate: Mapped[Decimal] = money()

    ward: Mapped["Ward"] = relationship(back_populates="beds")
    patient: Mapped["Patient | None"] = relationship()
    admissions: Mapped[list["Admission"]] = relationship(back_populates="bed")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Bed {self.bed_number} {self.status}>"


#: A stay in Discharge Pending still occupies its bed — the patient has not
#: left, the ward is only working through the checklist. Both partial indexes
#: below therefore have to mean the same thing the service means by "active",
#: or the backstop would stop covering the very window the checklist opens.
_ACTIVE_ADMISSION = text("status IN ('ADMITTED', 'DISCHARGE_PENDING')")


class Admission(UUIDMixin, TimestampMixin, Base):
    """An inpatient stay.

    A bed can hold at most one active admission. That is enforced by a partial
    unique index rather than application logic, so a race between two
    admissions cannot double-book a bed.
    """

    __tablename__ = "admissions"
    __table_args__ = (
        Index("ix_admissions_patient_id", "patient_id"),
        Index("ix_admissions_status", "status"),
        Index(
            "uq_admissions_active_bed",
            "bed_id",
            unique=True,
            postgresql_where=_ACTIVE_ADMISSION,
        ),
        # A patient cannot be admitted to two beds at once either.
        Index(
            "uq_admissions_active_patient",
            "patient_id",
            unique=True,
            postgresql_where=_ACTIVE_ADMISSION,
        ),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    bed_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("beds.id", ondelete="RESTRICT"), nullable=False
    )
    admission_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_discharge: Mapped[date | None] = mapped_column(Date)
    discharge_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[AdmissionStatus] = mapped_column(
        pg_enum(AdmissionStatus, "admission_status"), nullable=False, default=AdmissionStatus.ADMITTED
    )
    admitted_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    attending_doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    patient: Mapped["Patient"] = relationship(back_populates="admissions")
    bed: Mapped["Bed"] = relationship(back_populates="admissions")
    # Two foreign keys point at ``users``, so each relationship has to say which.
    admitting_staff: Mapped["User | None"] = relationship(foreign_keys=[admitted_by])
    attending_doctor: Mapped["User | None"] = relationship(foreign_keys=[attending_doctor_id])
    checklist_items: Mapped[list["DischargeChecklistItem"]] = relationship(
        back_populates="admission",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="DischargeChecklistItem.sort_order",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Admission patient={self.patient_id} {self.status}>"


class NursingTask(UUIDMixin, CreatedAtMixin, Base):
    """Ward work item.

    No public create endpoint is planned: the frontend has no create-task
    screen. Rows are expected to be generated by the system (medication
    schedules, doctor instructions) in a later step.
    """

    __tablename__ = "nursing_tasks"
    __table_args__ = (
        Index("ix_nursing_tasks_patient_id", "patient_id"),
        Index("ix_nursing_tasks_done_priority", "done", "priority"),
        Index("ix_nursing_tasks_assigned_to", "assigned_to"),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    admission_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("admissions.id", ondelete="CASCADE")
    )
    ward_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("wards.id", ondelete="SET NULL")
    )
    bed_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("beds.id", ondelete="SET NULL")
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    type: Mapped[NursingTaskType] = mapped_column(
        pg_enum(NursingTaskType, "nursing_task_type"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Free-text due hint for recurring work, e.g. "Hourly", "As needed".
    due_label: Mapped[str | None] = mapped_column(String(60))
    priority: Mapped[TaskPriority] = mapped_column(
        pg_enum(TaskPriority, "task_priority"), nullable=False, default=TaskPriority.ROUTINE
    )

    done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completed_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    patient: Mapped["Patient"] = relationship()
    bed: Mapped["Bed | None"] = relationship()
    ward: Mapped["Ward | None"] = relationship()
    assignee: Mapped["User | None"] = relationship(foreign_keys=[assigned_to])
    completer: Mapped["User | None"] = relationship(foreign_keys=[completed_by])

    def __repr__(self) -> str:  # pragma: no cover
        return f"<NursingTask {self.label!r} done={self.done}>"


class DischargeChecklistItem(UUIDMixin, CreatedAtMixin, Base):
    """One line of the discharge checklist for an admission."""

    __tablename__ = "discharge_checklist_items"
    __table_args__ = (Index("ix_discharge_checklist_admission_id", "admission_id"),)

    admission_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("admissions.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completed_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    admission: Mapped["Admission"] = relationship(back_populates="checklist_items")
    completer: Mapped["User | None"] = relationship(foreign_keys=[completed_by])

    def __repr__(self) -> str:  # pragma: no cover
        return f"<DischargeChecklistItem {self.label!r}>"
