"""Therapy sessions and the exercise library.

Mirrors the frontend's `TherapySession` type and the session form in
`pages/therapist/SessionEntry.tsx`. The measurement scales come from that
form's sliders and match the database CHECK constraints: pain 0-10 in steps of
0.5, mobility and strength 0-100.
"""

from __future__ import annotations

from datetime import date as date_type, datetime, time as time_type

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.enums import AttendanceStatus, TherapySessionStatus, TherapyType

# ---------------------------------------------------------------------------
# Exercise library
# ---------------------------------------------------------------------------


class ExerciseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    category: TherapyType
    description: str | None = None
    instructions: str | None = None
    defaultDuration: int | None = None
    isActive: bool = True


class ExerciseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: TherapyType
    description: str | None = Field(default=None, max_length=2000)
    instructions: str | None = Field(default=None, max_length=4000)
    defaultDuration: int | None = Field(default=None, ge=1, le=240)


class ExerciseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: TherapyType | None = None
    description: str | None = Field(default=None, max_length=2000)
    instructions: str | None = Field(default=None, max_length=4000)
    defaultDuration: int | None = Field(default=None, ge=1, le=240)
    #: Retiring an exercise keeps it on historical sessions but removes it from
    #: the picker — the library is never deleted from.
    isActive: bool | None = None


# ---------------------------------------------------------------------------
# Session exercises
# ---------------------------------------------------------------------------


class SessionExerciseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    exerciseId: str | None = None
    name: str
    sets: int | None = None
    repetitions: int | None = None
    duration: int | None = None
    notes: str | None = None


class SessionExerciseCreate(BaseModel):
    """One exercise performed.

    The session form submits names only, so ``name`` alone is enough; the
    backend resolves it to a library entry and refuses an unknown or retired
    one. ``exerciseId`` is accepted for callers that already have it.
    """

    exerciseId: str | None = None
    name: str | None = Field(default=None, max_length=200)
    sets: int | None = Field(default=None, ge=0, le=99)
    repetitions: int | None = Field(default=None, ge=0, le=999)
    duration: int | None = Field(default=None, ge=0, le=240)
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _identified(self) -> "SessionExerciseCreate":
        if not self.exerciseId and not (self.name and self.name.strip()):
            raise ValueError("Each exercise needs a name or an exerciseId.")
        return self


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


class TherapySessionResponse(BaseModel):
    """Matches the frontend's ``TherapySession`` interface."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["TS-5501"])
    uuid: str

    patientId: str
    patientUuid: str
    patientName: str
    #: Avatar details, so a list row renders without a second lookup per patient.
    patientInitials: str = ""
    patientAvatarColor: str = ""

    date: date_type
    time: str = Field(default="", description="Start time as HH:MM")
    durationMinutes: int | None = None
    type: TherapyType
    therapist: str = ""
    therapistId: str = ""
    status: TherapySessionStatus
    #: Exercise names, which is what the form's checkbox list binds to.
    exercises: list[str] = Field(default_factory=list)
    #: The same exercises with their prescribed dose.
    exerciseDetail: list[SessionExerciseOut] = Field(default_factory=list)

    painBefore: float | None = None
    painAfter: float | None = None
    mobilityScore: int | None = None
    strengthScore: int | None = None
    notes: str | None = None
    room: str = ""

    #: The plan this session belongs to.
    planId: str | None = None
    planTitle: str | None = None
    #: How the patient tolerated it, recorded alongside the notes.
    tolerance: str | None = None
    attendance: AttendanceStatus | None = None
    nextSessionDate: date_type | None = None

    #: Position within its plan, e.g. session 7 of 24.
    sequence: int | None = None

    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class TherapySessionCreate(BaseModel):
    """Book or log a session.

    ``therapistId`` is deliberately absent — who delivered the session is the
    authenticated user, never a value the browser chose.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "planId": "…",
                "date": "2026-08-26",
                "time": "09:00",
                "durationMinutes": 45,
                "type": "Physiotherapy",
                "room": "Gym 1",
                "exercises": [{"name": "Terminal knee extension", "sets": 3, "repetitions": 12}],
            }
        }
    )

    #: Plan UUID. A session belongs to a plan — the therapist's whole workflow
    #: is a programme, and the plan's progress is counted from these rows.
    planId: str

    date: date_type
    time: time_type | None = None
    durationMinutes: int | None = Field(default=None, ge=1, le=240)
    type: TherapyType | None = Field(
        default=None, description="Defaults to the plan's therapy discipline"
    )
    room: str | None = Field(default=None, max_length=120)

    painBefore: float | None = Field(default=None, ge=0, le=10)
    painAfter: float | None = Field(default=None, ge=0, le=10)
    mobilityScore: int | None = Field(default=None, ge=0, le=100)
    strengthScore: int | None = Field(default=None, ge=0, le=100)

    notes: str | None = Field(default=None, max_length=4000)
    tolerance: str | None = Field(default=None, max_length=120)
    nextSessionDate: date_type | None = None

    exercises: list[SessionExerciseCreate] = Field(default_factory=list, max_length=40)


class TherapySessionUpdate(BaseModel):
    """Amend a session. Status moves only through the workflow endpoints."""

    date: date_type | None = None
    time: time_type | None = None
    durationMinutes: int | None = Field(default=None, ge=1, le=240)
    type: TherapyType | None = None
    room: str | None = Field(default=None, max_length=120)

    painBefore: float | None = Field(default=None, ge=0, le=10)
    painAfter: float | None = Field(default=None, ge=0, le=10)
    mobilityScore: int | None = Field(default=None, ge=0, le=100)
    strengthScore: int | None = Field(default=None, ge=0, le=100)

    notes: str | None = Field(default=None, max_length=4000)
    tolerance: str | None = Field(default=None, max_length=120)
    nextSessionDate: date_type | None = None

    #: Replaces the session's exercise list wholesale when supplied.
    exercises: list[SessionExerciseCreate] | None = Field(default=None, max_length=40)


class SessionCompleteRequest(BaseModel):
    """Final measurements, submitted when the session is signed off.

    Everything is optional so a session recorded during the visit can simply be
    completed; anything supplied here overwrites what was logged earlier.
    """

    durationMinutes: int | None = Field(default=None, ge=1, le=240)
    painBefore: float | None = Field(default=None, ge=0, le=10)
    painAfter: float | None = Field(default=None, ge=0, le=10)
    mobilityScore: int | None = Field(default=None, ge=0, le=100)
    strengthScore: int | None = Field(default=None, ge=0, le=100)
    notes: str | None = Field(default=None, max_length=4000)
    tolerance: str | None = Field(default=None, max_length=120)
    nextSessionDate: date_type | None = None
    exercises: list[SessionExerciseCreate] | None = Field(default=None, max_length=40)
    #: Defaults to Attended — completing a session the patient did not attend is
    #: done through the no-show endpoint instead.
    attendance: AttendanceStatus | None = None


class TherapySessionPage(BaseModel):
    items: list[TherapySessionResponse]
    page: int
    limit: int
    total: int
    total_pages: int
