"""Rehabilitation plans, milestones and progress points.

Field names mirror the frontend's `RehabPlan` and `ProgressPoint` types in
`src/types/index.ts`. Two things there are worth stating plainly, because they
look like omissions and are not:

* the UI shows ``trend`` (On Track / Ahead of Plan / …), which is *derived* from
  attendance and measured progress — it is never accepted from a request;
* the UI has no notion of a plan ``status``. That lifecycle (Active / On Hold /
  Completed / Cancelled) exists on the API and drives what may be done to a
  plan, but no screen sets it today.
"""

from __future__ import annotations

from datetime import date as date_type, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.enums import MilestoneStatus, RehabPlanStatus, RehabTrend

# ---------------------------------------------------------------------------
# Milestones
# ---------------------------------------------------------------------------


class MilestoneOut(BaseModel):
    """One checkpoint.

    ``label`` and ``done`` are the frontend's own names; ``title``, ``status``
    and ``completedAt`` carry the fuller record behind them.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    done: bool
    #: Target date, which is what the plan card shows next to the label.
    date: date_type | None = None

    description: str | None = None
    status: MilestoneStatus
    completedAt: datetime | None = None
    sortOrder: int = 0


class MilestoneCreate(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    date: date_type | None = Field(default=None, description="Target date")
    sortOrder: int | None = Field(default=None, ge=0)


class MilestoneUpdate(BaseModel):
    """Amend a milestone. Completion goes through its own endpoint."""

    label: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    date: date_type | None = None
    sortOrder: int | None = Field(default=None, ge=0)
    #: Only ``Pending`` or ``Missed`` — achieving a milestone is a workflow step.
    status: MilestoneStatus | None = None


# ---------------------------------------------------------------------------
# Progress points
# ---------------------------------------------------------------------------


class ProgressPointOut(BaseModel):
    """Exactly the frontend's ``ProgressPoint`` — what the charts plot."""

    model_config = ConfigDict(from_attributes=True)

    week: str
    #: 0-10, lower is better.
    pain: float
    #: 0-100, higher is better.
    mobility: int
    strength: int
    adherence: int


class ProgressPointCreate(BaseModel):
    """A weekly review.

    Ranges match the database CHECK constraints and the session form's sliders,
    so an impossible value is a 422 rather than a 503 from the constraint.
    """

    #: Any date in the review week; the service normalises it to the Monday.
    weekStart: date_type | None = None
    week: str | None = Field(default=None, max_length=16, description="Chart label, e.g. 'Wk 3'")
    pain: float = Field(ge=0, le=10)
    mobility: int = Field(ge=0, le=100)
    strength: int = Field(ge=0, le=100)
    adherence: int = Field(ge=0, le=100)


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------


class RehabPlanResponse(BaseModel):
    """One plan, shaped for the existing UI.

    ``title``, ``goal``, ``targetEndDate``, ``primaryTherapist`` and ``trend``
    are the frontend's names; the rest carry the record behind them.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    patientId: str = Field(description="Patient code, e.g. PT-10248")
    patientUuid: str
    patientName: str
    #: Avatar details, so a plan row renders without a lookup per patient.
    patientInitials: str = ""
    patientAvatarColor: str = ""

    title: str
    goal: str | None = None
    startDate: date_type | None = None
    targetEndDate: date_type | None = None

    totalSessions: int
    #: Counted from therapy sessions, never taken from a request.
    completedSessions: int
    #: `completedSessions / totalSessions`, rounded — computed, never stored.
    progressPercentage: int

    frequencyPerWeek: int | None = None
    primaryTherapist: str = ""
    therapistId: str = ""
    modalities: list[str] = Field(default_factory=list)

    #: Derived from attendance and measured progress.
    trend: RehabTrend
    attendanceRate: float | None = None
    adherenceRate: float | None = None

    #: Lifecycle, distinct from `trend`. No screen sets this today.
    status: RehabPlanStatus

    milestones: list[MilestoneOut] = Field(default_factory=list)

    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class RehabPlanCreate(BaseModel):
    """A new plan.

    ``completedSessions``, ``attendanceRate``, ``adherenceRate`` and ``trend``
    are deliberately absent: all four are derived from therapy sessions, so
    accepting them would let a client assert progress that never happened.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "patientId": "PT-10248",
                "therapistId": "USR-1004",
                "title": "ACL Reconstruction Rehabilitation — Phase 3",
                "goal": "Restore full knee extension and 90% quadriceps symmetry.",
                "startDate": "2026-09-01",
                "targetEndDate": "2026-11-20",
                "totalSessions": 24,
                "frequencyPerWeek": 3,
                "modalities": ["Closed-chain strengthening", "Gait training"],
            }
        }
    )

    patientId: str = Field(description="Patient UUID or PT-##### code")
    therapistId: str = Field(description="Therapist UUID or USR-#### code")

    title: str = Field(min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=4000)
    startDate: date_type | None = None
    targetEndDate: date_type | None = None
    totalSessions: int = Field(gt=0, le=500)
    frequencyPerWeek: int | None = Field(default=None, ge=1, le=14)
    modalities: list[str] = Field(default_factory=list, max_length=20)

    milestones: list[MilestoneCreate] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _end_after_start(self) -> "RehabPlanCreate":
        if self.startDate and self.targetEndDate and self.targetEndDate < self.startDate:
            raise ValueError("The target end date cannot be before the start date.")
        return self


class RehabPlanUpdate(BaseModel):
    """Amend a plan.

    Patient is fixed at creation. Status moves only through the workflow
    endpoints, so it is not accepted here.
    """

    therapistId: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=4000)
    startDate: date_type | None = None
    targetEndDate: date_type | None = None
    totalSessions: int | None = Field(default=None, gt=0, le=500)
    frequencyPerWeek: int | None = Field(default=None, ge=1, le=14)
    modalities: list[str] | None = Field(default=None, max_length=20)


class RehabPlanPage(BaseModel):
    items: list[RehabPlanResponse]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------


class SessionProgressPoint(BaseModel):
    """One delivered session, as the progress endpoint reports it."""

    sessionId: str
    sessionNumber: str
    sequence: int
    date: date_type
    painBefore: float | None = None
    painAfter: float | None = None
    mobility: int | None = None
    strength: int | None = None
    attendance: str | None = None


class ProgressSummary(BaseModel):
    completedSessions: int
    totalSessions: int
    completionPercentage: float
    attendedSessions: int
    missedSessions: int
    attendanceRate: float | None = None
    adherenceRate: float | None = None
    trend: RehabTrend


class RehabProgressResponse(BaseModel):
    """Chart-ready progress for one plan.

    Two series, deliberately not merged:

    * ``progress`` is the weekly review the charts plot — the frontend's
      ``ProgressPoint`` shape, straight from ``rehab_progress_points``;
    * ``sessions`` is the per-session clinical record behind it.
    """

    planId: str
    patientId: str
    progress: list[ProgressPointOut] = Field(default_factory=list)
    sessions: list[SessionProgressPoint] = Field(default_factory=list)
    summary: ProgressSummary


# ---------------------------------------------------------------------------
# Caseload
# ---------------------------------------------------------------------------


class CaseloadEntry(BaseModel):
    """One patient on a therapist's caseload, with the plan that puts them there."""

    patientId: str
    patientUuid: str
    patientName: str
    initials: str
    avatarColor: str
    age: int | None = None
    primaryCondition: str | None = None

    planId: str
    planTitle: str
    totalSessions: int
    completedSessions: int
    progressPercentage: int
    trend: RehabTrend
    attendanceRate: float | None = None
    adherenceRate: float | None = None
    nextSessionDate: date_type | None = None
