"""Consultations, medical history and vitals.

Field names mirror the existing frontend — `src/types/index.ts` for vitals and
medical history, and the consultation form in `pages/doctor/Consultation.tsx`.
Nothing here is a redesign; where a name looks unusual it is because that is
what the UI already sends.
"""

from __future__ import annotations

from datetime import date as date_type, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.enums import MedicalHistoryType

# ---------------------------------------------------------------------------
# Vitals
# ---------------------------------------------------------------------------


class VitalsOut(BaseModel):
    """Matches the frontend ``Vitals`` interface.

    ``id`` is an addition, not a redesign: the frontend keys its observation
    table on ``recordedAt``, which collides when two readings share a timestamp.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    recordedAt: datetime
    recordedBy: str
    systolic: int | None = None
    diastolic: int | None = None
    heartRate: int | None = None
    temperature: float | None = None
    spo2: int | None = None
    respiratoryRate: int | None = None


class MedicalHistoryOut(BaseModel):
    """Matches the frontend ``MedicalHistoryEntry`` interface."""

    id: str
    date: date_type
    type: MedicalHistoryType
    title: str
    detail: str | None = None
    clinician: str


class VitalsCreate(BaseModel):
    """A new observation.

    Every reading is optional — a clinician may legitimately record only a
    blood pressure — but at least one must be present, or the row says nothing.
    Ranges match the database CHECK constraints so a bad value is rejected with
    422 rather than surfacing as a 503 from the constraint.
    """

    systolic: int | None = Field(default=None, ge=40, le=300)
    diastolic: int | None = Field(default=None, ge=20, le=200)
    heartRate: int | None = Field(default=None, ge=20, le=250)
    temperature: float | None = Field(default=None, ge=25, le=45)
    spo2: int | None = Field(default=None, ge=50, le=100)
    respiratoryRate: int | None = Field(default=None, ge=4, le=80)
    #: Defaults to now. Accepted so a nurse can back-date an observation.
    recordedAt: datetime | None = None

    @field_validator("recordedAt")
    @classmethod
    def _not_in_the_future(cls, value: datetime | None) -> datetime | None:
        if value is not None:
            from datetime import timezone

            now = datetime.now(timezone.utc)
            stamped = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
            if stamped > now:
                raise ValueError("Observations cannot be recorded in the future.")
        return value

    @model_validator(mode="after")
    def _something_was_measured(self) -> "VitalsCreate":
        if not self.readings():
            raise ValueError("Record at least one observation.")
        return self

    def readings(self) -> dict[str, object]:
        """The measured values only, dropping the ones left blank."""
        return self.model_dump(exclude={"recordedAt"}, exclude_none=True)


# ---------------------------------------------------------------------------
# Medical history
# ---------------------------------------------------------------------------


class MedicalHistoryCreate(BaseModel):
    """A new history entry.

    ``clinician`` is not accepted — it is taken from the signed-in user.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "date": "2026-08-24",
                "type": "Diagnosis",
                "title": "Adhesive capsulitis — right shoulder",
                "detail": "Confirmed on examination; range of motion limited in all planes.",
            }
        }
    )

    date: date_type | None = Field(default=None, description="Defaults to today")
    type: MedicalHistoryType
    title: str = Field(min_length=1, max_length=255)
    detail: str | None = Field(default=None, max_length=4000)

    @field_validator("date")
    @classmethod
    def _not_in_the_future(cls, value: date_type | None) -> date_type | None:
        if value is not None and value > date_type.today():
            raise ValueError("A history entry cannot be dated in the future.")
        return value


# ---------------------------------------------------------------------------
# Consultations
# ---------------------------------------------------------------------------


class ConsultationResponse(BaseModel):
    """One encounter.

    The field names are the consultation form's own: `complaint`, `examination`,
    `diagnosis`, `carePlan`, `notes`, `followUpDate`.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    patientId: str = Field(description="Patient code, e.g. PT-10248")
    patientUuid: str
    patientName: str

    doctor: str = ""
    doctorId: str = ""

    #: The appointment this encounter belongs to, when it started from one.
    appointmentId: str | None = None
    appointmentUuid: str | None = None

    complaint: str | None = None
    examination: str | None = None
    diagnosis: str | None = None
    carePlan: str | None = None
    notes: str | None = None
    followUpDate: date_type | None = None

    #: Prescriptions written during this encounter, by code.
    prescriptionIds: list[str] = Field(default_factory=list)

    date: datetime
    createdAt: datetime
    updatedAt: datetime | None = None


class ConsultationCreate(BaseModel):
    """Exactly what the consultation form submits.

    ``doctorId`` is deliberately absent: who performed the encounter is the
    authenticated user, never a value the browser chose.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "patientId": "PT-10248",
                "appointmentId": "APT-2026-00003",
                "complaint": "Stiffness on waking that eases after 20 minutes.",
                "examination": "Flexion 118°, extension full. No effusion.",
                "diagnosis": "Post-operative ACL reconstruction — week 8 review",
                "carePlan": "continue",
                "notes": "Continue closed-chain strengthening.",
                "followUpDate": "2026-09-07",
            }
        }
    )

    patientId: str = Field(description="Patient UUID or PT-##### code")
    appointmentId: str | None = Field(
        default=None, description="Appointment UUID or APT-YYYY-##### code"
    )

    complaint: str | None = Field(default=None, max_length=4000)
    examination: str | None = Field(default=None, max_length=4000)
    diagnosis: str = Field(min_length=1, max_length=2000)
    carePlan: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=4000)
    followUpDate: date_type | None = None


class ConsultationUpdate(BaseModel):
    """Amend an encounter. Patient, appointment and doctor are fixed at creation."""

    complaint: str | None = Field(default=None, max_length=4000)
    examination: str | None = Field(default=None, max_length=4000)
    diagnosis: str | None = Field(default=None, min_length=1, max_length=2000)
    carePlan: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=4000)
    followUpDate: date_type | None = None


class ConsultationPage(BaseModel):
    items: list[ConsultationResponse]
    page: int
    limit: int
    total: int
    total_pages: int
