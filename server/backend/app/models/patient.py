"""Patients, their medical history and their documents.

Deletion policy: nothing here cascades from ``patients``. Clinical history must
survive an accidental delete, and the frontend has no destructive patient
action, so every child FK is ``RESTRICT``.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import DocumentType, Gender, MedicalHistoryType, PatientStatus, pg_enum
from app.models.base import Base, CreatedAtMixin, TimestampMixin, UUIDMixin, short_code

if TYPE_CHECKING:
    from app.models.appointment import Appointment
    from app.models.billing import Invoice
    from app.models.consultation import Consultation
    from app.models.lab import LabResult
    from app.models.organisation import Branch, Department
    from app.models.pharmacy import Prescription
    from app.models.rehab import RehabPlan
    from app.models.user import User
    from app.models.vitals import Vitals
    from app.models.ward import Admission


# passive_deletes="all" stops SQLAlchemy from "helpfully" nulling these FKs when
# a patient is deleted. Nothing should quietly detach clinical history: the
# database's RESTRICT is allowed to refuse the delete outright.
_CLINICAL_REL = {"back_populates": "patient", "passive_deletes": "all"}


class Patient(UUIDMixin, TimestampMixin, Base):
    """The central clinical entity."""

    __tablename__ = "patients"
    __table_args__ = (
        Index("ix_patients_phone", "phone"),
        Index("ix_patients_branch_id", "branch_id"),
        Index("ix_patients_status", "status"),
        Index("ix_patients_assigned_doctor_id", "assigned_doctor_id"),
        Index("ix_patients_assigned_therapist_id", "assigned_therapist_id"),
        # A trigram index on the full name is added in the migration when the
        # pg_trgm extension is available. See the migration for details.
    )

    #: Human-readable code shown and routed on by the frontend, e.g. PT-10248.
    patient_number: Mapped[str] = short_code(16)

    first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    last_name: Mapped[str] = mapped_column(String(80), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[Gender] = mapped_column(pg_enum(Gender, "gender"), nullable=False)

    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    blood_group: Mapped[str | None] = mapped_column(String(8))

    status: Mapped[PatientStatus] = mapped_column(
        pg_enum(PatientStatus, "patient_status"), nullable=False, default=PatientStatus.ACTIVE_OPD
    )
    primary_condition: Mapped[str | None] = mapped_column(Text)
    registration_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_visit_at: Mapped[date | None] = mapped_column(Date)

    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("branches.id", ondelete="SET NULL")
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL")
    )
    assigned_doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    assigned_therapist_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    # --- Structured detail ---------------------------------------------------
    # The frontend models these as nested objects and a string list, so JSONB
    # keeps the shape without three extra tables. Promote to real tables if
    # they ever need to be queried or joined on.
    #: {"name": ..., "relation": ..., "phone": ...}
    emergency_contact: Mapped[dict | None] = mapped_column(JSONB)
    #: {"provider": ..., "policyNo": ..., "validTill": ...}
    insurance: Mapped[dict | None] = mapped_column(JSONB)
    #: ["Penicillin", "Latex"]
    allergies: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    #: Whether this patient has agreed to be contacted about appointments.
    #: Defaults to false, and that default is the whole point: holding somebody's
    #: phone number is not the same as being allowed to message them, so the
    #: reminder queue treats an unset value as "no" rather than as "probably".
    contact_consent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    #: Presentation value rendered directly on the avatar.
    avatar_color: Mapped[str | None] = mapped_column(String(80))

    branch: Mapped["Branch | None"] = relationship(back_populates="patients")
    department: Mapped["Department | None"] = relationship(foreign_keys=[department_id])
    assigned_doctor: Mapped["User | None"] = relationship(foreign_keys=[assigned_doctor_id])
    assigned_therapist: Mapped["User | None"] = relationship(foreign_keys=[assigned_therapist_id])

    appointments: Mapped[list["Appointment"]] = relationship(**_CLINICAL_REL)
    consultations: Mapped[list["Consultation"]] = relationship(**_CLINICAL_REL)
    history_entries: Mapped[list["MedicalHistoryEntry"]] = relationship(**_CLINICAL_REL)
    vitals: Mapped[list["Vitals"]] = relationship(**_CLINICAL_REL)
    rehab_plans: Mapped[list["RehabPlan"]] = relationship(**_CLINICAL_REL)
    prescriptions: Mapped[list["Prescription"]] = relationship(**_CLINICAL_REL)
    lab_results: Mapped[list["LabResult"]] = relationship(**_CLINICAL_REL)
    admissions: Mapped[list["Admission"]] = relationship(**_CLINICAL_REL)
    documents: Mapped[list["PatientDocument"]] = relationship(**_CLINICAL_REL)
    invoices: Mapped[list["Invoice"]] = relationship(**_CLINICAL_REL)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Patient {self.patient_number} {self.full_name!r}>"


class MedicalHistoryEntry(UUIDMixin, CreatedAtMixin, Base):
    """Diagnoses, surgeries, injuries and chronic conditions."""

    __tablename__ = "medical_history_entries"
    __table_args__ = (Index("ix_medical_history_patient_date", "patient_id", "entry_date"),)

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[MedicalHistoryType] = mapped_column(
        pg_enum(MedicalHistoryType, "medical_history_type"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    clinician_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    patient: Mapped["Patient"] = relationship(back_populates="history_entries")
    clinician: Mapped["User | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<MedicalHistoryEntry {self.title!r}>"


class PatientDocument(UUIDMixin, CreatedAtMixin, Base):
    """Metadata only.

    File storage is not implemented — the frontend Documents tab currently only
    lists and downloads. ``storage_key`` is where an object-store reference will
    go when upload is built.
    """

    __tablename__ = "patient_documents"
    __table_args__ = (Index("ix_patient_documents_patient_id", "patient_id"),)

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[DocumentType] = mapped_column(pg_enum(DocumentType, "document_type"), nullable=False)
    size_bytes: Mapped[int | None] = mapped_column()
    storage_key: Mapped[str | None] = mapped_column(String(512))
    uploaded_on: Mapped[date] = mapped_column(Date, nullable=False)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    patient: Mapped["Patient"] = relationship(back_populates="documents")
    uploader: Mapped["User | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<PatientDocument {self.name!r}>"
