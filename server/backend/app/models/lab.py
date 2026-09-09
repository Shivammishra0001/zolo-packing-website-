"""Laboratory results and their individual analyte rows."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import LabFlag, pg_enum
from app.models.base import Base, CreatedAtMixin, UUIDMixin, short_code

if TYPE_CHECKING:
    from app.models.patient import Patient
    from app.models.user import User


class LabResult(UUIDMixin, CreatedAtMixin, Base):
    """A released report awaiting or having had clinical review."""

    __tablename__ = "lab_results"
    __table_args__ = (
        Index("ix_lab_results_patient_id", "patient_id"),
        Index("ix_lab_results_reviewed", "reviewed"),
        Index("ix_lab_results_reported_on", "reported_on"),
    )

    #: Human-readable code, e.g. LAB-3301 — shown on the doctor's Labs table.
    lab_number: Mapped[str] = short_code(16)

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    #: The clinician who ordered the test.
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    test: Mapped[str] = mapped_column(String(200), nullable=False)
    reported_on: Mapped[date] = mapped_column(Date, nullable=False)
    flag: Mapped[LabFlag] = mapped_column(pg_enum(LabFlag, "lab_flag"), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)

    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    patient: Mapped["Patient"] = relationship(back_populates="lab_results")
    doctor: Mapped["User | None"] = relationship(foreign_keys=[doctor_id])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])
    values: Mapped[list["LabResultValue"]] = relationship(
        back_populates="result", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<LabResult {self.lab_number} {self.test!r}>"


class LabResultValue(UUIDMixin, Base):
    """One analyte row within a report.

    ``value`` is text, not numeric: results legitimately include non-numeric
    readings such as ``"Negative"`` or ``"< 0.01"``.
    """

    __tablename__ = "lab_result_values"
    __table_args__ = (Index("ix_lab_result_values_result_id", "lab_result_id"),)

    lab_result_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("lab_results.id", ondelete="CASCADE"), nullable=False
    )
    analyte: Mapped[str] = mapped_column(String(160), nullable=False)
    value: Mapped[str] = mapped_column(String(80), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(40))
    reference_range: Mapped[str | None] = mapped_column(String(80))
    is_abnormal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    result: Mapped["LabResult"] = relationship(back_populates="values")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<LabResultValue {self.analyte}={self.value}>"
