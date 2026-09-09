"""Wards, beds, admissions, nursing tasks and the discharge checklist.

Field names mirror the frontend's `Bed` and `NursingTask` types in
`src/types/index.ts`. Two things there shape everything here:

* the frontend's `Bed` is flat — `ward` and `bed` are strings, with the
  occupying patient denormalised onto the row. The API produces that shape from
  the real `Branch -> Ward -> Bed` relationship, so no screen has to know about
  it;
* a nursing task carries `done: boolean`, not a status enum. That is preserved
  rather than replaced with PENDING/COMPLETED, which no screen would understand.
"""

from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.enums import (
    AdmissionStatus,
    BedStatus,
    BedType,
    NursingTaskType,
    TaskPriority,
)

# ---------------------------------------------------------------------------
# Wards
# ---------------------------------------------------------------------------


class WardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    branch: str = ""
    branchId: str | None = None

    #: Counted from the ward's beds, never stored.
    totalBeds: int = 0
    occupied: int = 0
    available: int = 0
    reserved: int = 0
    cleaning: int = 0
    occupancyRate: int = 0


class WardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    #: Branch UUID. Defaults to the caller's own branch when omitted.
    branchId: str | None = None


class WardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)


# ---------------------------------------------------------------------------
# Beds
# ---------------------------------------------------------------------------


class BedResponse(BaseModel):
    """Matches the frontend's ``Bed`` interface."""

    model_config = ConfigDict(from_attributes=True)

    #: The bed's UUID. The frontend uses it only as a key and as the value it
    #: posts back, so there is no second synthetic code to keep in step.
    id: str
    ward: str
    wardId: str
    room: str = ""
    bed: str
    type: BedType
    status: BedStatus

    #: Present while the bed is occupied — denormalised for the board view.
    patientId: str | None = Field(default=None, description="Patient code, e.g. PT-10248")
    patientUuid: str | None = None
    patientName: str | None = None
    #: Admission date, which the board shows as "since".
    since: date_type | None = None
    dailyRate: Decimal

    #: The active admission, when there is one.
    admissionId: str | None = None


class BedCreate(BaseModel):
    """Add a bed to a ward.

    A new bed is Available: there is nobody in it yet, and Occupied is not a
    state this API lets anyone assert directly.
    """

    wardId: str
    bedNumber: str = Field(min_length=1, max_length=40, examples=["A-109"])
    room: str | None = Field(default=None, max_length=40)
    type: BedType
    dailyRate: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class BedUpdate(BaseModel):
    """Amend a bed's description.

    Status is not here — housekeeping goes through ``BedStatusUpdate`` and
    occupancy through the admission workflow.
    """

    bedNumber: str | None = Field(default=None, min_length=1, max_length=40)
    room: str | None = Field(default=None, max_length=40)
    type: BedType | None = None
    dailyRate: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)


class BedStatusUpdate(BaseModel):
    """Move a bed through housekeeping.

    Occupancy is not settable here: a bed becomes Occupied by admitting someone
    and Available by discharging them. Allowing a direct write would let the
    board disagree with the admissions behind it.
    """

    status: BedStatus
    #: Only meaningful for Reserved — the frontend reserves against a name
    #: rather than a registered patient.
    reservedFor: str | None = Field(default=None, max_length=160)


class BedSummary(BaseModel):
    total: int
    occupied: int
    available: int
    reserved: int
    cleaning: int
    #: `occupied / total × 100`, computed from real beds.
    occupancyRate: int


# ---------------------------------------------------------------------------
# Admissions
# ---------------------------------------------------------------------------


class ChecklistItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    detail: str | None = None
    #: The frontend's own field name for a checklist line.
    done: bool
    completedBy: str | None = None
    completedAt: datetime | None = None
    sortOrder: int = 0


class ChecklistItemUpdate(BaseModel):
    """Tick or untick a line. Who ticked it is the authenticated user."""

    done: bool


class AdmissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patientId: str = Field(description="Patient code, e.g. PT-10248")
    patientUuid: str
    patientName: str
    patientInitials: str = ""
    patientAvatarColor: str = ""
    age: int | None = None
    primaryCondition: str | None = None

    ward: str = ""
    wardId: str | None = None
    room: str = ""
    bed: str = ""
    bedId: str
    bedType: BedType | None = None
    dailyRate: Decimal | None = None

    admissionDate: date_type
    expectedDischarge: date_type | None = None
    dischargeDate: date_type | None = None
    status: AdmissionStatus

    attendingDoctor: str = ""
    admittedBy: str = ""

    #: The discharge checklist, and how much of it is done.
    checklist: list[ChecklistItemOut] = Field(default_factory=list)
    checklistComplete: bool = False
    checklistProgress: int = 0

    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class AdmissionCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "patientId": "PT-10248",
                "bedId": "A-101",
                "admissionDate": "2026-08-24",
                "expectedDischarge": "2026-08-30",
                "attendingDoctorId": "USR-1003",
            }
        }
    )

    patientId: str = Field(description="Patient UUID or PT-##### code")
    bedId: str = Field(description="Bed UUID, or a bed number such as A-101")
    admissionDate: date_type | None = Field(default=None, description="Defaults to today")
    expectedDischarge: date_type | None = None
    attendingDoctorId: str | None = None

    @model_validator(mode="after")
    def _discharge_after_admission(self) -> "AdmissionCreate":
        if self.admissionDate and self.expectedDischarge:
            if self.expectedDischarge < self.admissionDate:
                raise ValueError("The expected discharge cannot be before the admission date.")
        return self


class AdmissionUpdate(BaseModel):
    """Amend a stay.

    Patient and bed are fixed at admission — a bed change is a transfer, which
    the frontend has no workflow for. Status moves only through the discharge
    endpoint, so it is not accepted here.
    """

    expectedDischarge: date_type | None = None
    attendingDoctorId: str | None = None


class DischargeRequest(BaseModel):
    """Complete a stay.

    ``dischargeDate`` defaults to today. The bed's next state is Cleaning by
    default — the bed board has a cleaning column, and a bed a patient has just
    left is not immediately re-lettable.
    """

    dischargeDate: date_type | None = None
    bedStatus: BedStatus = BedStatus.CLEANING


class AdmissionPage(BaseModel):
    items: list[AdmissionResponse]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Nursing tasks
# ---------------------------------------------------------------------------


class NursingTaskResponse(BaseModel):
    """Matches the frontend's ``NursingTask`` interface."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    patientId: str
    patientUuid: str
    patientName: str
    ward: str = ""
    bed: str = ""
    type: NursingTaskType
    label: str
    #: The frontend shows a bare time or a phrase like "Hourly".
    due: str = ""
    priority: TaskPriority
    done: bool

    assignedTo: str | None = None
    completedBy: str | None = None
    completedAt: datetime | None = None
    #: True when a timed task is past due and still outstanding.
    overdue: bool = False


class NursingTaskUpdate(BaseModel):
    """Amend a task. Completion goes through its own endpoint.

    ``done`` is accepted here only to *reopen* a task ticked by mistake;
    completing one is a workflow step that stamps who did it and when.
    """

    label: str | None = Field(default=None, min_length=1, max_length=255)
    priority: TaskPriority | None = None
    dueLabel: str | None = Field(default=None, max_length=60)
    dueAt: datetime | None = None
    done: bool | None = None


class NursingDashboard(BaseModel):
    """Every figure the nurse dashboard shows, counted in PostgreSQL."""

    admittedPatients: int
    dischargePending: int

    pendingTasks: int
    overdueTasks: int
    completedTasksToday: int
    vitalsPending: int
    medicationsDue: int

    vitalsRecordedToday: int

    beds: BedSummary
    #: Wards with at least one bed, for the ward grouping the dashboard shows.
    wards: list[WardResponse] = Field(default_factory=list)
