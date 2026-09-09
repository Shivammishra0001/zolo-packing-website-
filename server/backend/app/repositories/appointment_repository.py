"""Appointment data access.

Branch scoping runs through the patient, since an appointment has no branch of
its own — the patient's branch is what determines who may see it.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import date as date_type, time as time_type

from sqlalchemy import Integer, Select, and_, func, or_, select, text
from sqlalchemy.orm import Session, joinedload

from app.core.enums import AppointmentStatus, AppointmentType
from app.models.appointment import Appointment
from app.models.patient import Patient

#: Statuses that still occupy a slot. Mirrors the WHERE clause on the database
#: exclusion constraints, so application pre-checks and the constraint agree.
ACTIVE_STATUSES = (
    AppointmentStatus.SCHEDULED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.FOLLOW_UP,
)


def _with_relations(stmt: Select) -> Select:
    return stmt.options(
        joinedload(Appointment.patient).joinedload(Patient.branch),
        joinedload(Appointment.doctor),
        joinedload(Appointment.therapist),
        joinedload(Appointment.department),
    )


def _visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    """Restrict to appointments whose patient belongs to a visible branch."""
    if branch_ids is None:
        return stmt
    stmt = stmt.join(Patient, Appointment.patient_id == Patient.id)
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Patient.branch_id.in_(branch_ids))


def get_by_uuid(db: Session, appointment_id: uuid_lib.UUID) -> Appointment | None:
    return (
        db.execute(_with_relations(select(Appointment).where(Appointment.id == appointment_id)))
        .unique()
        .scalar_one_or_none()
    )


def get_by_number(db: Session, number: str) -> Appointment | None:
    return (
        db.execute(
            _with_relations(
                select(Appointment).where(Appointment.appointment_number == number.upper())
            )
        )
        .unique()
        .scalar_one_or_none()
    )


def list_appointments(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    on_date: date_type | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    doctor_id: uuid_lib.UUID | None = None,
    therapist_id: uuid_lib.UUID | None = None,
    patient_id: uuid_lib.UUID | None = None,
    statuses: list[AppointmentStatus] | None = None,
    appointment_type: AppointmentType | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Appointment], int]:
    """One page of appointments plus the total matching count."""
    stmt = _visible(select(Appointment), branch_ids)

    if on_date is not None:
        stmt = stmt.where(Appointment.appointment_date == on_date)
    if date_from is not None:
        stmt = stmt.where(Appointment.appointment_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Appointment.appointment_date <= date_to)
    if doctor_id is not None:
        stmt = stmt.where(Appointment.doctor_id == doctor_id)
    if therapist_id is not None:
        stmt = stmt.where(Appointment.therapist_id == therapist_id)
    if patient_id is not None:
        stmt = stmt.where(Appointment.patient_id == patient_id)
    if statuses:
        stmt = stmt.where(Appointment.status.in_(statuses))
    if appointment_type is not None:
        stmt = stmt.where(Appointment.appointment_type == appointment_type)

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(Appointment.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(
            _with_relations(stmt)
            .order_by(Appointment.appointment_date, Appointment.start_time)
            .offset(offset)
            .limit(limit)
        )
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


def find_clash(
    db: Session,
    *,
    on_date: date_type,
    start: time_type,
    end: time_type,
    doctor_id: uuid_lib.UUID | None,
    therapist_id: uuid_lib.UUID | None,
    exclude: uuid_lib.UUID | None = None,
) -> Appointment | None:
    """The first appointment overlapping this slot for the same clinician.

    A friendly pre-check only. The database exclusion constraints remain the
    real guarantee — two concurrent bookings can both pass this and only one
    will survive the INSERT.
    """
    if doctor_id is None and therapist_id is None:
        return None

    clinician = []
    if doctor_id is not None:
        clinician.append(Appointment.doctor_id == doctor_id)
    if therapist_id is not None:
        clinician.append(Appointment.therapist_id == therapist_id)

    stmt = (
        _with_relations(select(Appointment))
        .where(Appointment.appointment_date == on_date)
        .where(Appointment.status.in_(ACTIVE_STATUSES))
        .where(or_(*clinician))
        # Half-open overlap: 09:00-09:30 and 09:30-10:00 do not clash.
        .where(and_(Appointment.start_time < end, Appointment.end_time > start))
    )
    if exclude is not None:
        stmt = stmt.where(Appointment.id != exclude)

    return db.execute(stmt.limit(1)).unique().scalar_one_or_none()


def next_token_number(db: Session, on_date: date_type) -> int:
    """Allocate the next daily queue token.

    Tokens restart at 1 each day and are shared across clinicians, which is what
    the reception board shows. An advisory lock held for the rest of the
    transaction serialises allocation for this date, so two receptionists
    booking at the same instant cannot be handed the same token.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"appointment-token:{on_date.isoformat()}"},
    )
    current = db.execute(
        select(func.coalesce(func.max(Appointment.token_number), 0)).where(
            Appointment.appointment_date == on_date
        )
    ).scalar_one()
    return int(current) + 1


def next_sequence_number(db: Session, year: int) -> int:
    """Next appointment number within a year, under the same advisory lock."""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"appointment-number:{year}"},
    )
    # Max of the numeric suffix, not COUNT — a gap from a rolled-back booking
    # would make COUNT+1 collide with an existing number.
    current = db.execute(
        select(
            func.coalesce(
                func.max(
                    func.cast(
                        func.split_part(Appointment.appointment_number, "-", 3),
                        Integer,
                    )
                ),
                0,
            )
        ).where(Appointment.appointment_number.like(f"APT-{year}-%"))
    ).scalar_one()
    return int(current) + 1
