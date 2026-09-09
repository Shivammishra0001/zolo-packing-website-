"""Report series and export payloads.

Every model here is an aggregate — a count, a sum or an average. None of them
carries a record, which is what keeps a report from becoming a way to read rows
the caller could not read through the module that owns them.

Series are returned as continuous runs with zero-filled gaps, because a chart
with a missing column reads as a dip rather than as no data.
"""

from __future__ import annotations

from datetime import date as date_type
from decimal import Decimal

from pydantic import BaseModel, Field

from app.core.enums import AppointmentStatus, PaymentMethod


class ReportWindow(BaseModel):
    """The period a report covers, echoed back so a chart can label itself."""

    start: date_type
    end: date_type


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------


class PatientVolumePoint(BaseModel):
    """One column of the patient-volume chart."""

    #: "Aug 26" — the label the chart renders.
    month: str
    newPatients: int
    returning: int


class PatientReport(BaseModel):
    window: ReportWindow
    #: Everyone on file within the caller's branch scope.
    totalPatients: int
    volume: list[PatientVolumePoint] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------


class StatusCount(BaseModel):
    status: AppointmentStatus
    count: int


class DayCount(BaseModel):
    date: date_type
    count: int


class AppointmentReport(BaseModel):
    window: ReportWindow
    total: int
    byStatus: list[StatusCount] = Field(default_factory=list)
    byDay: list[DayCount] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Therapy
# ---------------------------------------------------------------------------


class TherapyWeekPoint(BaseModel):
    """One column of the therapy-capacity chart."""

    #: "Wk 3" — the label the chart renders.
    week: str
    sessions: int
    #: Everything booked in that week, delivered or not.
    capacity: int


class TherapistLoad(BaseModel):
    therapist: str
    booked: int
    completed: int


class TherapyReport(BaseModel):
    window: ReportWindow
    byWeek: list[TherapyWeekPoint] = Field(default_factory=list)
    workload: list[TherapistLoad] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# IPD and occupancy
# ---------------------------------------------------------------------------


class OccupancyPoint(BaseModel):
    date: date_type
    #: The chart's own field name.
    day: str
    occupancy: int
    capacity: int


class IpdReport(BaseModel):
    window: ReportWindow
    totalBeds: int
    occupiedNow: int
    #: `occupiedNow / totalBeds × 100`, computed from real beds.
    occupancyRate: int
    trend: list[OccupancyPoint] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


class MethodBreakdown(BaseModel):
    method: PaymentMethod
    amount: Decimal
    count: int


class PaymentReport(BaseModel):
    window: ReportWindow
    total: Decimal
    byMethod: list[MethodBreakdown] = Field(default_factory=list)
