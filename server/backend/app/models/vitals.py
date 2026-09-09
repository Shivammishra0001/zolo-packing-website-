"""Vitals observations.

Indexed on ``(patient_id, recorded_at DESC)`` because Patient 360 and the nurse
screens always read the latest-first history for one patient.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin

if TYPE_CHECKING:
    from app.models.patient import Patient
    from app.models.user import User
    from app.models.ward import Admission


class Vitals(UUIDMixin, Base):
    """One set of observations at a point in time."""

    __tablename__ = "vitals"
    __table_args__ = (
        Index("ix_vitals_patient_recorded_at", "patient_id", "recorded_at"),
        CheckConstraint("systolic IS NULL OR systolic BETWEEN 40 AND 300", name="systolic_range"),
        CheckConstraint("diastolic IS NULL OR diastolic BETWEEN 20 AND 200", name="diastolic_range"),
        CheckConstraint("heart_rate IS NULL OR heart_rate BETWEEN 20 AND 250", name="heart_rate_range"),
        CheckConstraint("spo2 IS NULL OR spo2 BETWEEN 50 AND 100", name="spo2_range"),
        CheckConstraint(
            "respiratory_rate IS NULL OR respiratory_rate BETWEEN 4 AND 80",
            name="respiratory_rate_range",
        ),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    admission_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("admissions.id", ondelete="SET NULL")
    )
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    systolic: Mapped[int | None] = mapped_column(Integer)
    diastolic: Mapped[int | None] = mapped_column(Integer)
    heart_rate: Mapped[int | None] = mapped_column(Integer)
    #: Degrees Celsius, e.g. 36.80
    temperature: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    spo2: Mapped[int | None] = mapped_column(Integer)
    respiratory_rate: Mapped[int | None] = mapped_column(Integer)

    patient: Mapped["Patient"] = relationship(back_populates="vitals")
    nurse: Mapped["User | None"] = relationship()
    admission: Mapped["Admission | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Vitals {self.systolic}/{self.diastolic} at {self.recorded_at}>"
