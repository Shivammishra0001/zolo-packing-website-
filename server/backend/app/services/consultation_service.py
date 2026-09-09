"""Consultation business rules.

Clinical records, so three things hold throughout:

* the encounter's author is the authenticated user, never a client-supplied id;
* a doctor edits their own encounters, not another clinician's;
* nothing here logs clinical content — only record identifiers.
"""

from __future__ import annotations

import logging
import uuid as uuid_lib
from datetime import date as date_type, datetime, timezone

from sqlalchemy.orm import Session

from app.core.enums import AppointmentStatus, AuditCategory, UserRole
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.core.ids import APPOINTMENT, PATIENT
from app.models.audit import AuditLog
from app.models.consultation import Consultation
from app.models.patient import Patient
from app.models.user import User
from app.repositories import appointment_repository as appointments_repo
from app.repositories import clinical_repository as repo
from app.repositories import patient_repository as patients_repo
from app.schemas.clinical import (
    ConsultationCreate,
    ConsultationPage,
    ConsultationResponse,
    ConsultationUpdate,
)
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

#: Roles that perform consultations. Kept alongside the permission check rather
#: than replacing it — the permission says "may record encounters", this says
#: "is a clinician", and the frontend grants `consultation.manage` to doctors only.
CONSULTING_ROLES = {UserRole.DOCTOR}

# There is deliberately no "edit any clinician's record" escape hatch.
#
# `patient.clinical.edit` looks like one but is not: the frontend grants it to
# every doctor, so treating it as oversight would let any doctor rewrite any
# colleague's notes — exactly what ownership is meant to prevent. If an
# administrator ever needs that power it gets its own permission key, granted
# deliberately, rather than being smuggled in through an existing one.

#: Appointment states in which recording an encounter makes sense. A consultation
#: is written while the patient is with the clinician, or just after — not
#: against a slot the patient never attended.
RECORDABLE_STATUSES = {
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.FOLLOW_UP,
}


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------


def to_response(consultation: Consultation) -> ConsultationResponse:
    patient = consultation.patient
    doctor = consultation.doctor
    appointment = consultation.appointment

    return ConsultationResponse(
        id=str(consultation.id),
        patientId=patient.patient_number,
        patientUuid=str(patient.id),
        patientName=patient.full_name,
        doctor=doctor.full_name if doctor else "",
        doctorId=doctor.user_number if doctor else "",
        appointmentId=appointment.appointment_number if appointment else None,
        appointmentUuid=str(appointment.id) if appointment else None,
        complaint=consultation.symptoms,
        examination=consultation.examination_notes,
        diagnosis=consultation.diagnosis,
        carePlan=consultation.care_plan,
        notes=consultation.notes,
        followUpDate=consultation.follow_up_date,
        prescriptionIds=[rx.prescription_number for rx in consultation.prescriptions],
        date=consultation.created_at,
        createdAt=consultation.created_at,
        updatedAt=consultation.updated_at,
    )


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


def resolve_patient(db: Session, identifier: str, user: User, permissions: list[str]) -> Patient:
    """Find a patient the caller is entitled to see, or 404."""
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

    branch_ids = visible_branch_ids(db, user, permissions)
    # 404 rather than 403 — a 403 would confirm the record exists.
    if branch_ids is not None and patient.branch_id not in branch_ids:
        raise NotFoundError("Patient not found.")
    return patient


def get_consultation(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> Consultation:
    try:
        consultation = repo.get_consultation(db, uuid_lib.UUID(identifier))
    except ValueError:
        consultation = None

    if consultation is None:
        raise NotFoundError("Consultation not found.")

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and consultation.patient.branch_id not in branch_ids:
        raise NotFoundError("Consultation not found.")

    return consultation


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def list_consultations(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int,
    limit: int,
    scope: str = "auto",
    patient: str | None = None,
    appointment: str | None = None,
    on_date: date_type | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
) -> ConsultationPage:
    """Consultations the caller is entitled to read.

    A doctor always sees their own encounters here — this list is their work
    queue, not the clinic's record. Reading another clinician's notes happens
    through the patient, at ``/patients/{id}/consultations``, which is a
    deliberate, patient-scoped act rather than a bulk listing.

    Roles with clinical access but no caseload of their own (nurse, therapist)
    see their branch, since narrowing by clinician would return nothing.
    """
    branch_ids = visible_branch_ids(db, user, permissions)

    doctor_id = None
    if user.role is UserRole.DOCTOR:
        if scope == "all":
            # No permission in the matrix grants a doctor the whole clinic's
            # encounter list. Refused rather than silently narrowed, so the
            # caller is not misled about what they received.
            raise ForbiddenError(
                "You do not have permission to read other clinicians' consultations.",
                code="insufficient_permission",
            )
        doctor_id = user.id

    patient_id = resolve_patient(db, patient, user, permissions).id if patient else None

    appointment_id = None
    if appointment:
        row = _resolve_appointment(db, appointment)
        appointment_id = row.id if row else None

    rows, total = repo.list_consultations(
        db,
        branch_ids=branch_ids,
        patient_id=patient_id,
        doctor_id=doctor_id,
        appointment_id=appointment_id,
        on_date=on_date,
        date_from=date_from,
        date_to=date_to,
        offset=(page - 1) * limit,
        limit=limit,
    )

    return ConsultationPage(
        items=[to_response(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def consultations_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[ConsultationResponse]:
    """Every encounter for one patient — used by Patient 360."""
    rows, _ = repo.list_consultations(db, branch_ids=None, patient_id=patient_id, limit=200)
    return [to_response(row) for row in rows]


def _resolve_appointment(db: Session, identifier: str):
    if APPOINTMENT.matches(identifier):
        return appointments_repo.get_by_number(db, identifier)
    try:
        return appointments_repo.get_by_uuid(db, uuid_lib.UUID(identifier))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------


def _audit(db: Session, user: User, action: str, consultation: Consultation, ip: str | None) -> None:
    """Record that an encounter was written, never what it said."""
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=AuditCategory.PATIENT,
            target_type="consultations",
            target_id=consultation.id,
            summary=f"Consultation for {consultation.patient.patient_number}",
            ip_address=ip,
        )
    )


def _assert_may_consult(user: User) -> None:
    if user.role not in CONSULTING_ROLES:
        raise ForbiddenError(
            "Only a doctor can record a consultation.",
            code="not_a_consulting_role",
        )


def create_consultation(
    db: Session,
    *,
    payload: ConsultationCreate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> Consultation:
    """Record an encounter.

    The author is the signed-in user. A ``doctor_id`` in the request body would
    be ignored — the schema does not accept one.
    """
    _assert_may_consult(user)
    patient = resolve_patient(db, payload.patientId, user, permissions)

    appointment = None
    if payload.appointmentId:
        appointment = _resolve_appointment(db, payload.appointmentId)
        if appointment is None:
            raise NotFoundError("Appointment not found.")
        if appointment.patient_id != patient.id:
            raise UnprocessableError("That appointment belongs to a different patient.")
        if appointment.doctor_id not in (None, user.id):
            raise ForbiddenError(
                "That appointment is booked with another clinician.",
                code="not_your_appointment",
            )
        if appointment.status not in RECORDABLE_STATUSES:
            raise ConflictError(
                f"This appointment is {appointment.status.display.lower()}. "
                "Check the patient in before recording a consultation.",
                code="appointment_not_ready",
            )
        existing = repo.consultation_for_appointment(db, appointment.id)
        if existing is not None:
            raise ConflictError(
                "A consultation has already been recorded for this appointment.",
                code="consultation_exists",
            )

    consultation = Consultation(
        patient_id=patient.id,
        doctor_id=user.id,
        appointment_id=appointment.id if appointment else None,
        symptoms=payload.complaint,
        examination_notes=payload.examination,
        diagnosis=payload.diagnosis,
        care_plan=payload.carePlan,
        notes=payload.notes,
        follow_up_date=payload.followUpDate,
    )
    db.add(consultation)
    db.flush()

    _audit(db, user, "CONSULTATION_CREATED", consultation, ip)
    db.commit()
    db.refresh(consultation)

    # Identifiers only — no diagnosis, no notes.
    logger.info("Consultation %s recorded by %s", consultation.id, user.id)
    return consultation


def update_consultation(
    db: Session,
    *,
    consultation: Consultation,
    payload: ConsultationUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> Consultation:
    """Amend an encounter.

    The author may edit their own. Anyone else needs clinical oversight — one
    doctor cannot quietly rewrite another's clinical record.
    """
    if consultation.doctor_id != user.id:
        raise ForbiddenError(
            "You can only edit consultations you recorded.",
            code="not_your_consultation",
        )

    data = payload.model_dump(exclude_unset=True)
    fields = {
        "complaint": "symptoms",
        "examination": "examination_notes",
        "diagnosis": "diagnosis",
        "carePlan": "care_plan",
        "notes": "notes",
        "followUpDate": "follow_up_date",
    }
    for wire, column in fields.items():
        if wire in data:
            setattr(consultation, column, data[wire])

    db.add(consultation)
    _audit(db, user, "CONSULTATION_UPDATED", consultation, ip)
    db.commit()
    db.refresh(consultation)

    logger.info("Consultation %s amended by %s", consultation.id, user.id)
    return consultation


def due_follow_ups(
    db: Session, *, user: User, permissions: list[str], through: date_type | None = None
) -> list[ConsultationResponse]:
    """Patients whose follow-up date has arrived, for the doctor's dashboard."""
    branch_ids = visible_branch_ids(db, user, permissions)
    doctor_id = user.id if user.role is UserRole.DOCTOR else None
    cutoff = through or datetime.now(timezone.utc).date()
    rows = repo.follow_ups_due(db, branch_ids=branch_ids, doctor_id=doctor_id, through=cutoff)
    return [to_response(row) for row in rows]
