"""Appointment business rules: the status state machine, conflicts and tokens."""

from __future__ import annotations

import logging
import uuid as uuid_lib
from datetime import date as date_type, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.enums import (
    AppointmentStatus,
    AppointmentType,
    AuditCategory,
    NotificationIcon,
    NotificationSeverity,
    UserRole,
)
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.core.ids import APPOINTMENT, PATIENT, USER
from app.models.appointment import Appointment
from app.models.audit import AuditLog
from app.models.patient import Patient
from app.models.user import User
from app.repositories import appointment_repository as repo
from app.services import notification_service as notifications
from app.repositories import patient_repository as patients_repo
from app.schemas.appointment import (
    AppointmentCreate,
    AppointmentPage,
    AppointmentResponse,
    AppointmentUpdate,
)
from app.services.appointment_serializer import to_response
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

#: Default slot length when the booking form does not supply an end time.
DEFAULT_SLOT_MINUTES = 30

#: The workflow, as a state machine. Anything not listed is rejected with 409,
#: so no client can drive an appointment into an impossible state.
ALLOWED_TRANSITIONS: dict[AppointmentStatus, set[AppointmentStatus]] = {
    AppointmentStatus.SCHEDULED: {
        AppointmentStatus.CHECKED_IN,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
    },
    AppointmentStatus.CHECKED_IN: {
        AppointmentStatus.IN_PROGRESS,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
    },
    AppointmentStatus.IN_PROGRESS: {AppointmentStatus.COMPLETED},
    # Terminal states.
    AppointmentStatus.COMPLETED: set(),
    AppointmentStatus.CANCELLED: set(),
    AppointmentStatus.NO_SHOW: set(),
    AppointmentStatus.FOLLOW_UP: set(),
}

#: Why a particular move is refused, phrased for the person reading the toast.
TRANSITION_MESSAGE = {
    (AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED): (
        "Cannot complete an appointment that has not started. Check the patient in first."
    ),
    (AppointmentStatus.SCHEDULED, AppointmentStatus.IN_PROGRESS): (
        "Cannot start an appointment before the patient is checked in."
    ),
    (AppointmentStatus.CHECKED_IN, AppointmentStatus.COMPLETED): (
        "Cannot complete an appointment that has not started."
    ),
    (AppointmentStatus.CHECKED_IN, AppointmentStatus.CHECKED_IN): (
        "This patient is already checked in."
    ),
}


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


def _resolve_user(db: Session, identifier: str | None, role: UserRole) -> User | None:
    """Accept a UUID or a ``USR-####`` code, and check the role matches."""
    if not identifier:
        return None

    user: User | None = None
    if USER.matches(identifier):
        user = db.execute(select(User).where(User.user_number == identifier.upper())).scalar_one_or_none()
    else:
        try:
            user = db.execute(
                select(User).where(User.id == uuid_lib.UUID(identifier))
            ).scalar_one_or_none()
        except ValueError:
            user = None

    if user is None:
        raise UnprocessableError(f"No {role.display.lower()} found for {identifier!r}.")
    if user.role is not role:
        raise UnprocessableError(f"{user.full_name} is not a {role.display.lower()}.")
    return user


def _resolve_patient(db: Session, identifier: str) -> Patient:
    patient: Patient | None = None
    if PATIENT.matches(identifier):
        patient = patients_repo.get_by_number(db, identifier)
    else:
        try:
            patient = patients_repo.get_by_uuid(db, uuid_lib.UUID(identifier))
        except ValueError:
            patient = None
    if patient is None:
        raise NotFoundError("Patient not found.")
    return patient


def get_appointment(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> Appointment:
    appointment: Appointment | None = None
    if APPOINTMENT.matches(identifier):
        appointment = repo.get_by_number(db, identifier)
    else:
        try:
            appointment = repo.get_by_uuid(db, uuid_lib.UUID(identifier))
        except ValueError:
            appointment = repo.get_by_number(db, identifier)

    if appointment is None:
        raise NotFoundError("Appointment not found.")

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and appointment.patient.branch_id not in branch_ids:
        # 404, not 403 — a 403 confirms the record exists.
        raise NotFoundError("Appointment not found.")

    return appointment


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def list_appointments(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int,
    limit: int,
    scope: str = "auto",
    on_date: date_type | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    patient: str | None = None,
    statuses: list[AppointmentStatus] | None = None,
    appointment_type: AppointmentType | None = None,
) -> AppointmentPage:
    """List appointments the caller is entitled to see.

    ``scope='auto'`` (the default) narrows clinicians to their own diary, which
    is what their dashboards show. ``scope='branch'`` returns the whole clinic
    diary — receptionists work that way, and a clinician may legitimately look
    at it, but it never crosses a branch the caller cannot already see.
    """
    branch_ids = visible_branch_ids(db, user, permissions)

    doctor_id = therapist_id = None
    if scope in ("auto", "mine"):
        if user.role is UserRole.DOCTOR:
            doctor_id = user.id
        elif user.role is UserRole.THERAPIST:
            therapist_id = user.id
        elif scope == "mine":
            # Nobody else has a personal diary; fall back to the branch view.
            pass

    patient_id = _resolve_patient(db, patient).id if patient else None

    rows, total = repo.list_appointments(
        db,
        branch_ids=branch_ids,
        on_date=on_date,
        date_from=date_from,
        date_to=date_to,
        doctor_id=doctor_id,
        therapist_id=therapist_id,
        patient_id=patient_id,
        statuses=statuses,
        appointment_type=appointment_type,
        offset=(page - 1) * limit,
        limit=limit,
    )

    return AppointmentPage(
        items=[to_response(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def appointments_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[AppointmentResponse]:
    """Every appointment for one patient — used by Patient 360."""
    rows, _ = repo.list_appointments(db, branch_ids=None, patient_id=patient_id, limit=200)
    return [to_response(row) for row in rows]


# ---------------------------------------------------------------------------
# Creation
# ---------------------------------------------------------------------------


def _audit(db: Session, user: User, action: str, appointment: Appointment, ip: str | None) -> None:
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=AuditCategory.PATIENT,
            target_type="appointments",
            target_id=appointment.id,
            summary=f"{appointment.appointment_number} — {appointment.patient.full_name}",
            ip_address=ip,
        )
    )


def create_appointment(
    db: Session, *, payload: AppointmentCreate, user: User, permissions: list[str], ip: str | None
) -> Appointment:
    """Book an appointment.

    Number allocation, token allocation and the insert all happen in one
    transaction, so a rejected booking leaves no orphaned token behind.
    """
    patient = _resolve_patient(db, payload.patientId)

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and patient.branch_id not in branch_ids:
        raise NotFoundError("Patient not found.")

    doctor = _resolve_user(db, payload.doctorId, UserRole.DOCTOR)
    therapist = _resolve_user(db, payload.therapistId, UserRole.THERAPIST)

    end_time = payload.endTime
    if end_time is None:
        minutes = payload.durationMinutes or DEFAULT_SLOT_MINUTES
        start_dt = datetime.combine(payload.date, payload.time)
        end_time = (start_dt + timedelta(minutes=minutes)).time()
        if end_time <= payload.time:
            raise UnprocessableError("The appointment would end before it starts.")

    # Friendly pre-check. The exclusion constraints below are the real guard.
    clash = repo.find_clash(
        db,
        on_date=payload.date,
        start=payload.time,
        end=end_time,
        doctor_id=doctor.id if doctor else None,
        therapist_id=therapist.id if therapist else None,
    )
    if clash is not None:
        who = (doctor or therapist)
        raise ConflictError(
            f"{who.full_name if who else 'That clinician'} already has an appointment "
            f"between {clash.start_time.strftime('%H:%M')} and {clash.end_time.strftime('%H:%M')} "
            f"on {payload.date.isoformat()}.",
            code="appointment_conflict",
        )

    clinician = doctor or therapist
    clinician_department = clinician.department_id if clinician else None

    sequence = repo.next_sequence_number(db, payload.date.year)
    appointment = Appointment(
        appointment_number=APPOINTMENT.format(sequence, year=payload.date.year),
        patient_id=patient.id,
        doctor_id=doctor.id if doctor else None,
        therapist_id=therapist.id if therapist else None,
        # The clinic the appointment is held in follows the clinician, which
        # is what the diary shows; the patient's own department is the fallback.
        department_id=clinician_department or patient.department_id,
        appointment_date=payload.date,
        start_time=payload.time,
        end_time=end_time,
        appointment_type=payload.type,
        status=AppointmentStatus.SCHEDULED,
        token_number=repo.next_token_number(db, payload.date),
        notes=payload.notes,
        room=payload.room,
        created_by=user.id,
    )

    db.add(appointment)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        # The exclusion constraint fired — someone booked the same slot between
        # our pre-check and this insert.
        if "no_overlap" in str(exc.orig):
            raise ConflictError(
                "That slot was just taken. Please choose another time.",
                code="appointment_conflict",
            ) from exc
        raise

    _audit(db, user, "APPOINTMENT_CREATED", appointment, ip)
    db.commit()
    db.refresh(appointment)

    logger.info("Appointment %s booked by %s", appointment.appointment_number, user.id)
    return appointment


def update_appointment(
    db: Session,
    *,
    appointment: Appointment,
    payload: AppointmentUpdate,
    user: User,
    ip: str | None,
) -> Appointment:
    """Reschedule or amend. Status changes go through the workflow endpoints."""
    if appointment.status in (
        AppointmentStatus.COMPLETED,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
    ):
        raise ConflictError(
            f"This appointment is {appointment.status.display.lower()} and can no longer be changed.",
            code="appointment_closed",
        )

    data = payload.model_dump(exclude_unset=True)

    if "doctorId" in data:
        doctor = _resolve_user(db, data["doctorId"], UserRole.DOCTOR)
        appointment.doctor_id = doctor.id if doctor else None
    if "therapistId" in data:
        therapist = _resolve_user(db, data["therapistId"], UserRole.THERAPIST)
        appointment.therapist_id = therapist.id if therapist else None

    if appointment.doctor_id is None and appointment.therapist_id is None:
        raise UnprocessableError("An appointment needs a doctor or a therapist.")

    new_date = data.get("date", appointment.appointment_date)
    new_start = data.get("time", appointment.start_time)
    new_end = data.get("endTime") or appointment.end_time

    if new_end <= new_start:
        raise UnprocessableError("The end time must be after the start time.")

    rescheduled = (
        new_date != appointment.appointment_date
        or new_start != appointment.start_time
        or new_end != appointment.end_time
        or "doctorId" in data
        or "therapistId" in data
    )
    if rescheduled:
        clash = repo.find_clash(
            db,
            on_date=new_date,
            start=new_start,
            end=new_end,
            doctor_id=appointment.doctor_id,
            therapist_id=appointment.therapist_id,
            exclude=appointment.id,
        )
        if clash is not None:
            raise ConflictError(
                f"That clinician already has an appointment between "
                f"{clash.start_time.strftime('%H:%M')} and {clash.end_time.strftime('%H:%M')}.",
                code="appointment_conflict",
            )
        # Moving to another day means a new place in that day's queue.
        if new_date != appointment.appointment_date:
            appointment.token_number = repo.next_token_number(db, new_date)

    appointment.appointment_date = new_date
    appointment.start_time = new_start
    appointment.end_time = new_end
    if "type" in data:
        appointment.appointment_type = data["type"]
    if "notes" in data:
        appointment.notes = data["notes"]
    if "room" in data:
        appointment.room = data["room"]

    db.add(appointment)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "no_overlap" in str(exc.orig):
            raise ConflictError(
                "That slot was just taken. Please choose another time.",
                code="appointment_conflict",
            ) from exc
        raise

    db.refresh(appointment)
    return appointment


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------


def _assert_transition(appointment: Appointment, target: AppointmentStatus) -> None:
    current = appointment.status
    if target in ALLOWED_TRANSITIONS.get(current, set()):
        return

    message = TRANSITION_MESSAGE.get((current, target))
    if message is None:
        message = (
            f"Cannot move an appointment from {current.display.lower()} "
            f"to {target.display.lower()}."
        )
    raise ConflictError(message, code="invalid_transition")


def _assert_may_move_queue(
    appointment: Appointment, user: User, permissions: list[str]
) -> None:
    """Who may send a patient in, or close the visit.

    The clinician the appointment is booked with, always — and front-desk staff,
    who run the check-in board and move the queue along from there. What this
    stops is one clinician driving another's diary.
    """
    if user.role is UserRole.DOCTOR and appointment.doctor_id == user.id:
        return
    if user.role is UserRole.THERAPIST and appointment.therapist_id == user.id:
        return
    if "appointment.checkin" in permissions:
        return
    raise ForbiddenError(
        "Only the clinician this appointment is booked with can do that.",
        code="not_your_appointment",
    )


def _transition(
    db: Session,
    *,
    appointment: Appointment,
    target: AppointmentStatus,
    user: User,
    action: str,
    ip: str | None,
) -> Appointment:
    _assert_transition(appointment, target)
    appointment.status = target

    if target is AppointmentStatus.CHECKED_IN:
        appointment.checked_in_at = datetime.now(timezone.utc)
        if appointment.token_number is None:
            appointment.token_number = repo.next_token_number(db, appointment.appointment_date)

        # The clinician is waiting on this, and reception is the one who knows.
        # Joins this transaction: if the check-in rolls back, so does the alert.
        if appointment.doctor_id is not None and appointment.doctor_id != user.id:
            notifications.notify(
                db,
                user_id=appointment.doctor_id,
                title=f"{appointment.patient.full_name} has checked in",
                body=(
                    f"Token {appointment.token_number} · {appointment.appointment_type.display}"
                    if appointment.token_number
                    else appointment.appointment_type.display
                ),
                icon=NotificationIcon.PATIENT,
                severity=NotificationSeverity.INFO,
                href="/doctor/appointments",
            )

    db.add(appointment)
    _audit(db, user, action, appointment, ip)
    db.commit()
    db.refresh(appointment)

    logger.info("Appointment %s -> %s by %s", appointment.appointment_number, target.value, user.id)
    return appointment


def check_in(db: Session, *, appointment: Appointment, user: User, ip: str | None) -> Appointment:
    return _transition(
        db,
        appointment=appointment,
        target=AppointmentStatus.CHECKED_IN,
        user=user,
        action="APPOINTMENT_CHECKED_IN",
        ip=ip,
    )


def start(
    db: Session,
    *,
    appointment: Appointment,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> Appointment:
    _assert_may_move_queue(appointment, user, permissions)
    return _transition(
        db,
        appointment=appointment,
        target=AppointmentStatus.IN_PROGRESS,
        user=user,
        action="APPOINTMENT_STARTED",
        ip=ip,
    )


def complete(
    db: Session,
    *,
    appointment: Appointment,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> Appointment:
    _assert_may_move_queue(appointment, user, permissions)
    return _transition(
        db,
        appointment=appointment,
        target=AppointmentStatus.COMPLETED,
        user=user,
        action="APPOINTMENT_COMPLETED",
        ip=ip,
    )


def cancel(
    db: Session, *, appointment: Appointment, user: User, reason: str | None, ip: str | None
) -> Appointment:
    if reason:
        prefix = f"Cancelled: {reason}"
        appointment.notes = f"{appointment.notes}\n{prefix}" if appointment.notes else prefix
    return _transition(
        db,
        appointment=appointment,
        target=AppointmentStatus.CANCELLED,
        user=user,
        action="APPOINTMENT_CANCELLED",
        ip=ip,
    )


def mark_no_show(db: Session, *, appointment: Appointment, user: User, ip: str | None) -> Appointment:
    return _transition(
        db,
        appointment=appointment,
        target=AppointmentStatus.NO_SHOW,
        user=user,
        action="APPOINTMENT_NO_SHOW",
        ip=ip,
    )
