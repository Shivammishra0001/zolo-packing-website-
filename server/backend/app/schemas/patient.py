"""Patient request and response schemas.

Response shapes mirror the frontend's existing ``Patient`` type in
``src/types/index.ts`` — camelCase keys, display-string enums, ``id`` carrying
the human-readable ``PT-#####`` code — so the existing screens need no reshaping.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.enums import (
    DocumentType,
    Gender,
    PatientStatus,
)
from app.schemas.appointment import AppointmentResponse
from app.schemas.billing import InvoiceResponse
# Defined with the other clinical schemas — Patient 360 is a consumer of
# these shapes, not their owner.
from app.schemas.clinical import ConsultationResponse, MedicalHistoryOut, VitalsOut
from app.schemas.lab import LabResultResponse
from app.schemas.nursing import AdmissionResponse
from app.schemas.rehab import MilestoneOut, ProgressPointOut, RehabPlanResponse
from app.schemas.therapy import TherapySessionResponse
from app.schemas.prescription import PrescriptionResponse

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """Standard paginated envelope."""

    items: list[T]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Nested records
# ---------------------------------------------------------------------------


class EmergencyContact(BaseModel):
    name: str = Field(max_length=160)
    relation: str = Field(max_length=60)
    phone: str = Field(max_length=32)


class Insurance(BaseModel):
    provider: str = Field(max_length=160)
    policyNo: str = Field(max_length=80)
    validTill: date | None = None


class DocumentOut(BaseModel):
    """Matches the frontend ``DocumentRecord`` interface."""

    id: str
    name: str
    type: DocumentType
    size: str
    uploadedOn: date
    uploadedBy: str


# ---------------------------------------------------------------------------
# Patient
# ---------------------------------------------------------------------------


class PatientResponse(BaseModel):
    """One patient, shaped for the existing UI.

    ``id`` is the ``PT-#####`` code the frontend routes on and renders; ``uuid``
    carries the real primary key.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["PT-10248"])
    uuid: str
    name: str
    age: int | None = None
    gender: Gender
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    bloodGroup: str | None = None
    avatarColor: str
    initials: str

    status: PatientStatus
    registeredOn: date
    primaryCondition: str | None = None
    assignedDoctor: str = ""
    assignedTherapist: str = ""
    department: str = ""
    branch: str | None = None

    # Populated once the wards module writes admissions (Step 6+).
    ward: str | None = None
    room: str | None = None
    bed: str | None = None
    admittedOn: date | None = None
    expectedDischarge: date | None = None

    emergencyContact: EmergencyContact | None = None
    insurance: Insurance | None = None
    allergies: list[str] = Field(default_factory=list)
    #: Whether this patient has agreed to be contacted about appointments.
    #: False until somebody records otherwise — holding a phone number is not
    #: permission to use it.
    contactConsent: bool = False

    lastVisit: date
    nextAppointment: str | None = None
    outstandingAmount: Decimal = Decimal("0.00")

    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class PatientSearchResult(BaseModel):
    """Lightweight result for the global search palette."""

    id: str = Field(examples=["PT-10248"])
    uuid: str
    patientNumber: str
    name: str
    age: int | None = None
    gender: Gender
    phone: str | None = None
    status: PatientStatus
    department: str = ""
    primaryCondition: str | None = None
    avatarColor: str
    initials: str


class PatientCreate(BaseModel):
    """Exactly the fields the existing registration form collects.

    ``patient_number`` is deliberately absent — the backend allocates it.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "Nikhil Bharadwaj",
                "dateOfBirth": "1984-03-12",
                "gender": "Male",
                "phone": "+91 98200 00000",
                "email": "nikhil@example.com",
                "address": "Flat 9, Andheri West, Mumbai 400058",
                "bloodGroup": "B+",
                "emergencyContact": {
                    "name": "Asha Bharadwaj",
                    "relation": "Spouse",
                    "phone": "+91 98200 00001",
                },
                "department": "Physiotherapy",
                "assignedDoctor": "Dr. Arjun Sharma",
                "primaryCondition": "Post-operative knee rehabilitation",
            }
        }
    )

    name: str = Field(min_length=2, max_length=160)
    dateOfBirth: date
    gender: Gender
    phone: str = Field(min_length=6, max_length=32)
    email: EmailStr | None = None
    address: str | None = None
    bloodGroup: str | None = Field(default=None, max_length=8)

    emergencyContact: EmergencyContact | None = None
    insurance: Insurance | None = None
    allergies: list[str] = Field(default_factory=list)

    department: str | None = None
    assignedDoctor: str | None = None
    assignedTherapist: str | None = None
    primaryCondition: str | None = None
    status: PatientStatus = PatientStatus.ACTIVE_OPD
    #: Defaults to the creating user's branch.
    branch: str | None = None

    @field_validator("dateOfBirth")
    @classmethod
    def _not_in_the_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Date of birth cannot be in the future.")
        if value.year < 1900:
            raise ValueError("Date of birth is not plausible.")
        return value

    @field_validator("name")
    @classmethod
    def _has_two_parts(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Name is required.")
        return cleaned


class PatientUpdate(BaseModel):
    """Editable fields only.

    ``uuid``, ``patient_number``, ``registeredOn`` and the timestamps are
    intentionally not accepted — they are not the client's to change.
    """

    name: str | None = Field(default=None, min_length=2, max_length=160)
    dateOfBirth: date | None = None
    gender: Gender | None = None
    phone: str | None = Field(default=None, min_length=6, max_length=32)
    email: EmailStr | None = None
    address: str | None = None
    bloodGroup: str | None = Field(default=None, max_length=8)

    emergencyContact: EmergencyContact | None = None
    insurance: Insurance | None = None
    allergies: list[str] | None = None

    department: str | None = None
    assignedDoctor: str | None = None
    assignedTherapist: str | None = None
    primaryCondition: str | None = None
    status: PatientStatus | None = None
    branch: str | None = None


# ---------------------------------------------------------------------------
# Patient 360
# ---------------------------------------------------------------------------


class Patient360Response(BaseModel):
    """Everything the Patient 360 screen shows, in one call.

    Sections belonging to modules that are not built yet come back empty rather
    than fabricated. ``restrictedSections`` names the parts withheld because the
    caller lacks ``patient.clinical.view`` — those are empty for a different
    reason, and the UI says so.
    """

    patient: PatientResponse

    # Real data.
    vitals: list[VitalsOut] = Field(default_factory=list)
    medicalHistory: list[MedicalHistoryOut] = Field(default_factory=list)
    documents: list[DocumentOut] = Field(default_factory=list)

    #: Real clinical data, from the modules built so far.
    appointments: list[AppointmentResponse] = Field(default_factory=list)
    consultations: list[ConsultationResponse] = Field(default_factory=list)
    prescriptions: list[PrescriptionResponse] = Field(default_factory=list)
    labs: list[LabResultResponse] = Field(default_factory=list)

    #: Rehabilitation. ``rehabPlan`` is the active plan the patient record shows;
    #: ``rehabPlans`` is the full history behind it.
    rehabPlan: RehabPlanResponse | None = None
    rehabPlans: list[RehabPlanResponse] = Field(default_factory=list)
    therapySessions: list[TherapySessionResponse] = Field(default_factory=list)
    progress: list[ProgressPointOut] = Field(default_factory=list)
    milestones: list[MilestoneOut] = Field(default_factory=list)

    #: Inpatient stays, newest first, with the discharge checklist on each.
    admissions: list[AdmissionResponse] = Field(default_factory=list)
    #: The stay that still holds a bed, if there is one.
    currentAdmission: AdmissionResponse | None = None

    #: Bills raised against this patient, newest first. Withheld unless the
    #: caller holds `billing.view` — a clinician reading a record has no
    #: business reading its finances.
    invoices: list[InvoiceResponse] = Field(default_factory=list)

    #: Sections the caller may not see, e.g. ["vitals", "medicalHistory"].
    restrictedSections: list[str] = Field(default_factory=list)
    #: Sections whose module is not implemented yet.
    pendingModules: list[str] = Field(default_factory=list)
