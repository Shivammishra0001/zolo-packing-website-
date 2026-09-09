"""Appointment row → API response.

Separate from ``appointment_service`` so Patient 360 can render appointments
without the two services having to import each other.
"""

from __future__ import annotations

from datetime import date as date_type, datetime, time as time_type, timezone

from app.core.config import settings
from app.models.appointment import Appointment
from app.services.avatars import avatar_colour, initials
from app.schemas.appointment import AppointmentResponse


def _hhmm(value: time_type | None) -> str | None:
    return value.strftime("%H:%M") if value else None


def _local_hhmm(value: datetime | None) -> str | None:
    """A stored UTC timestamp as the wall-clock time staff actually saw.

    Everything is persisted in UTC; the queue board shows clinic-local time.
    A naive value can only have come from a database that was told the column
    is UTC, so it is treated as such rather than silently taking the server's
    zone.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(settings.clinic_tz).strftime("%H:%M")


def _age(dob: date_type | None) -> int | None:
    if dob is None:
        return None
    today = date_type.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def to_response(appointment: Appointment) -> AppointmentResponse:
    """Shape one appointment exactly as the existing UI reads it."""
    patient = appointment.patient
    checked_in = appointment.checked_in_at

    return AppointmentResponse(
        id=appointment.appointment_number,
        uuid=str(appointment.id),
        patientId=patient.patient_number,
        patientUuid=str(patient.id),
        patientName=patient.full_name,
        patientAge=_age(patient.date_of_birth),
        patientGender=patient.gender,
        patientInitials=initials(patient),
        patientAvatarColor=avatar_colour(patient),
        doctor=appointment.doctor.full_name if appointment.doctor else "",
        doctorId=appointment.doctor.user_number if appointment.doctor else "",
        therapist=appointment.therapist.full_name if appointment.therapist else "",
        therapistId=appointment.therapist.user_number if appointment.therapist else "",
        date=appointment.appointment_date,
        time=_hhmm(appointment.start_time) or "",
        endTime=_hhmm(appointment.end_time) or "",
        type=appointment.appointment_type,
        department=appointment.department.name if appointment.department else "",
        status=appointment.status,
        tokenNumber=appointment.token_number,
        # HH:MM only. The queue board computes the elapsed wait from this — the
        # waiting time is never stored as text.
        checkedInAt=_local_hhmm(checked_in),
        notes=appointment.notes,
        room=appointment.room,
        createdAt=appointment.created_at,
        updatedAt=appointment.updated_at,
    )
