"""Appointment request and response schemas.

Mirrors the frontend's ``Appointment`` type in ``src/types/index.ts`` — camelCase
keys and display-label statuses — so the existing screens need no reshaping.
"""

from __future__ import annotations

# Aliased: the schemas have fields literally named ``date`` and ``time``,
# which would otherwise shadow the types inside the class body.
from datetime import date as date_type, datetime, time as time_type

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.enums import AppointmentStatus, AppointmentType, Gender


class AppointmentResponse(BaseModel):
    """One appointment, shaped for the existing UI.

    ``id`` carries the ``APT-YYYY-#####`` code (the UI uses it only as a React
    key); ``uuid`` is the real primary key that the action endpoints take.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["APT-2026-00152"])
    uuid: str

    patientId: str = Field(description="Patient code, e.g. PT-10248")
    patientUuid: str
    patientName: str
    patientAge: int | None = None
    patientGender: Gender
    #: Presentation values so the timeline can render an avatar without a
    #: second request per row.
    patientInitials: str
    patientAvatarColor: str

    doctor: str = ""
    doctorId: str = ""
    therapist: str = ""
    therapistId: str = ""

    date: date_type
    time: str = Field(description="Start time as HH:MM", examples=["09:30"])
    endTime: str = Field(description="End time as HH:MM", examples=["10:00"])

    type: AppointmentType
    department: str = ""
    status: AppointmentStatus
    tokenNumber: int | None = None
    #: HH:MM, or null when the patient has not arrived.
    checkedInAt: str | None = None
    notes: str | None = None
    room: str | None = None

    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class AppointmentCreate(BaseModel):
    """Exactly what the existing booking form submits."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "patientId": "PT-10248",
                "doctorId": "USR-1003",
                "date": "2026-08-26",
                "time": "10:00",
                "type": "Follow-up",
                "notes": "Week 8 post-op review",
            }
        }
    )

    patientId: str = Field(description="Patient UUID or PT-##### code")
    doctorId: str | None = Field(default=None, description="Doctor UUID or USR-#### code")
    therapistId: str | None = None

    date: date_type
    time: time_type = Field(description="Start time")
    #: Optional — defaults to the configured slot length when omitted.
    endTime: time_type | None = None
    durationMinutes: int | None = Field(default=None, ge=5, le=240)

    type: AppointmentType = AppointmentType.FOLLOW_UP
    notes: str | None = Field(default=None, max_length=2000)
    room: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _needs_a_clinician(self) -> "AppointmentCreate":
        if not self.doctorId and not self.therapistId:
            raise ValueError("An appointment needs a doctor or a therapist.")
        return self

    @model_validator(mode="after")
    def _end_after_start(self) -> "AppointmentCreate":
        if self.endTime is not None and self.endTime <= self.time:
            raise ValueError("The end time must be after the start time.")
        return self


class AppointmentUpdate(BaseModel):
    """Reschedule or amend an appointment.

    Status is deliberately absent — it moves only through the workflow
    endpoints, which enforce the transition rules.
    """

    date: date_type | None = None
    time: time_type | None = None
    endTime: time_type | None = None
    type: AppointmentType | None = None
    doctorId: str | None = None
    therapistId: str | None = None
    notes: str | None = Field(default=None, max_length=2000)
    room: str | None = Field(default=None, max_length=120)


class CancelRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class AppointmentPage(BaseModel):
    items: list[AppointmentResponse]
    page: int
    limit: int
    total: int
    total_pages: int
