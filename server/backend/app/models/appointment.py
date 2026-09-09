"""Appointments, with database-enforced double-booking protection."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    literal_column,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import AppointmentStatus, AppointmentType, pg_enum
from app.models.base import Base, TimestampMixin, UUIDMixin, short_code

if TYPE_CHECKING:
    from app.models.consultation import Consultation
    from app.models.organisation import Department
    from app.models.patient import Patient
    from app.models.user import User

# Statuses that no longer occupy a slot, so they are excluded from the overlap
# check — a cancelled appointment must not block rebooking the same time.
_ACTIVE_SLOT = "status NOT IN ('CANCELLED', 'NO_SHOW')"

# date + time -> timestamp is immutable in PostgreSQL, so it is usable inside a
# GiST exclusion constraint.
_SLOT_RANGE = "tsrange((appointment_date + start_time), (appointment_date + end_time))"


class Appointment(UUIDMixin, TimestampMixin, Base):
    """A booked slot with a doctor and/or therapist.

    Overlap protection lives in the database, not in application code: two
    ``EXCLUDE USING gist`` constraints make a double-booking physically
    impossible, whatever the API or a direct SQL client tries to do.

    Requires the ``btree_gist`` extension for equality on ``uuid`` inside a GiST
    index; the migration creates it.
    """

    __tablename__ = "appointments"
    __table_args__ = (
        Index("ix_appointments_patient_id", "patient_id"),
        Index("ix_appointments_doctor_id", "doctor_id"),
        Index("ix_appointments_therapist_id", "therapist_id"),
        Index("ix_appointments_appointment_date", "appointment_date"),
        Index("ix_appointments_status", "status"),
        Index("ix_appointments_doctor_date", "doctor_id", "appointment_date"),
        CheckConstraint("end_time > start_time", name="end_after_start"),
        CheckConstraint(
            "doctor_id IS NOT NULL OR therapist_id IS NOT NULL",
            name="clinician_required",
        ),
        ExcludeConstraint(
            (literal_column("doctor_id"), "="),
            (literal_column(_SLOT_RANGE), "&&"),
            name="ex_appointments_doctor_no_overlap",
            using="gist",
            where=text(f"{_ACTIVE_SLOT} AND doctor_id IS NOT NULL"),
        ),
        ExcludeConstraint(
            (literal_column("therapist_id"), "="),
            (literal_column(_SLOT_RANGE), "&&"),
            name="ex_appointments_therapist_no_overlap",
            using="gist",
            where=text(f"{_ACTIVE_SLOT} AND therapist_id IS NOT NULL"),
        ),
    )

    #: Human-readable code, e.g. APT-8801.
    appointment_number: Mapped[str] = short_code(16)

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    therapist_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL")
    )

    appointment_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    appointment_type: Mapped[AppointmentType] = mapped_column(
        pg_enum(AppointmentType, "appointment_type"), nullable=False
    )
    status: Mapped[AppointmentStatus] = mapped_column(
        pg_enum(AppointmentStatus, "appointment_status"),
        nullable=False,
        default=AppointmentStatus.SCHEDULED,
    )

    #: Queue position shown on the reception board.
    token_number: Mapped[int | None] = mapped_column(Integer)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    room: Mapped[str | None] = mapped_column(String(120))

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    patient: Mapped["Patient"] = relationship(back_populates="appointments")
    doctor: Mapped["User | None"] = relationship(foreign_keys=[doctor_id])
    therapist: Mapped["User | None"] = relationship(foreign_keys=[therapist_id])
    department: Mapped["Department | None"] = relationship()
    consultation: Mapped["Consultation | None"] = relationship(
        back_populates="appointment", uselist=False
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Appointment {self.appointment_number} {self.appointment_date} {self.start_time}>"
