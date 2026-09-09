"""Doctor consultations."""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.appointment import Appointment
    from app.models.patient import Patient
    from app.models.pharmacy import Prescription
    from app.models.user import User


class Consultation(UUIDMixin, TimestampMixin, Base):
    """One clinical encounter, optionally tied to the appointment that created it."""

    __tablename__ = "consultations"
    __table_args__ = (
        Index("ix_consultations_patient_id", "patient_id"),
        Index("ix_consultations_doctor_id", "doctor_id"),
        Index("ix_consultations_patient_created", "patient_id", "created_at"),
        # One consultation per appointment; a follow-up gets its own appointment.
        # Partial, so the many consultations with no appointment do not collide.
        Index(
            "uq_consultations_appointment_id",
            "appointment_id",
            unique=True,
            postgresql_where=text("appointment_id IS NOT NULL"),
        ),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL")
    )

    #: Chief complaint as reported by the patient.
    symptoms: Mapped[str | None] = mapped_column(Text)
    examination_notes: Mapped[str | None] = mapped_column(Text)
    diagnosis: Mapped[str | None] = mapped_column(Text)
    care_plan: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    follow_up_date: Mapped[date | None] = mapped_column(Date)

    patient: Mapped["Patient"] = relationship(back_populates="consultations")
    doctor: Mapped["User | None"] = relationship()
    appointment: Mapped["Appointment | None"] = relationship(back_populates="consultation")
    prescriptions: Mapped[list["Prescription"]] = relationship(back_populates="consultation")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Consultation patient={self.patient_id} on {self.created_at}>"
