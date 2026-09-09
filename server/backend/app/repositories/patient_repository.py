"""Patient data access.

Every filter, sort and page boundary is expressed in SQL. Nothing loads the
whole table into Python to filter it there.
"""

from __future__ import annotations

import uuid as uuid_lib
from typing import Literal

from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.enums import PatientStatus
from app.core.ids import PATIENT
from app.models.patient import MedicalHistoryEntry, Patient, PatientDocument
from app.models.vitals import Vitals
from app.models.ward import Admission, Bed

SortField = Literal["name", "registered", "status", "recent"]

#: Sequence created by the patients migration; nextval is atomic, so two
#: concurrent registrations can never receive the same number.
PATIENT_NUMBER_SEQUENCE = "patient_number_seq"


def _with_relations(stmt: Select) -> Select:
    """Eager-load the joins every response needs, avoiding N+1 queries."""
    return stmt.options(
        joinedload(Patient.branch),
        joinedload(Patient.department),
        joinedload(Patient.assigned_doctor),
        joinedload(Patient.assigned_therapist),
        # Ward and bed on a patient row come from their open admission. A
        # separate SELECT rather than another join, so a patient with a long
        # admission history does not multiply every other row out.
        selectinload(Patient.admissions).joinedload(Admission.bed).joinedload(Bed.ward),
    )


def next_patient_number(db: Session) -> str:
    """Allocate the next ``PT-#####`` code from a PostgreSQL sequence."""
    value = db.execute(select(func.nextval(PATIENT_NUMBER_SEQUENCE))).scalar_one()
    return PATIENT.format(int(value))


def get_by_uuid(db: Session, patient_id: uuid_lib.UUID) -> Patient | None:
    return db.execute(
        _with_relations(select(Patient).where(Patient.id == patient_id))
    ).unique().scalar_one_or_none()


def get_by_number(db: Session, patient_number: str) -> Patient | None:
    return db.execute(
        _with_relations(select(Patient).where(Patient.patient_number == patient_number.upper()))
    ).unique().scalar_one_or_none()


def _visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    """Apply branch scoping. ``None`` means organisation-wide access."""
    if branch_ids is None:
        return stmt
    if not branch_ids:
        # Scoped user with no branch assigned — sees nothing rather than everything.
        return stmt.where(func.false())
    return stmt.where(Patient.branch_id.in_(branch_ids))


def _apply_search(stmt: Select, term: str) -> Select:
    """Match against name, patient number, phone, condition and department.

    ``first_name || ' ' || last_name`` is matched as one string so "Raj Kumar"
    works; the trigram index created by the initial migration covers exactly
    that expression.
    """
    like = f"%{term.strip()}%"
    digits = "".join(ch for ch in term if ch.isdigit())

    clauses = [
        func.concat(Patient.first_name, " ", Patient.last_name).ilike(like),
        Patient.patient_number.ilike(like),
        Patient.primary_condition.ilike(like),
    ]
    if len(digits) >= 3:
        clauses.append(Patient.phone.ilike(f"%{digits}%"))

    return stmt.where(or_(*clauses))


def _apply_sort(stmt: Select, sort: SortField) -> Select:
    if sort == "registered":
        return stmt.order_by(Patient.registration_date.desc(), Patient.last_name)
    if sort == "status":
        return stmt.order_by(Patient.status, Patient.last_name, Patient.first_name)
    if sort == "recent":
        return stmt.order_by(Patient.last_visit_at.desc().nullslast(), Patient.last_name)
    return stmt.order_by(Patient.first_name, Patient.last_name)


def list_patients(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    search: str | None = None,
    status: PatientStatus | None = None,
    assigned_doctor_id: uuid_lib.UUID | None = None,
    assigned_therapist_id: uuid_lib.UUID | None = None,
    admitted_only: bool = False,
    sort: SortField = "name",
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[Patient], int]:
    """One page of patients plus the total matching count."""
    stmt = _visible(select(Patient), branch_ids)

    if search:
        stmt = _apply_search(stmt, search)
    if status is not None:
        stmt = stmt.where(Patient.status == status)
    if assigned_doctor_id is not None:
        stmt = stmt.where(Patient.assigned_doctor_id == assigned_doctor_id)
    if assigned_therapist_id is not None:
        stmt = stmt.where(Patient.assigned_therapist_id == assigned_therapist_id)
    if admitted_only:
        stmt = stmt.where(
            Patient.status.in_([PatientStatus.ADMITTED_IPD, PatientStatus.DISCHARGE_PENDING])
        )

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(Patient.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(_with_relations(_apply_sort(stmt, sort)).offset(offset).limit(limit))
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


def search_patients(
    db: Session,
    *,
    term: str,
    branch_ids: list[uuid_lib.UUID] | None,
    limit: int = 8,
) -> list[Patient]:
    """Ranked lookup for the command palette.

    Exact patient-number and name-prefix matches sort above substring hits, so
    typing "Raj" surfaces "Raj Kumar" before "Gurpreet Raja".
    """
    cleaned = term.strip()
    if not cleaned:
        return []

    full_name = func.concat(Patient.first_name, " ", Patient.last_name)
    prefix = f"{cleaned}%"

    rank = func.least(
        case(
            (Patient.patient_number.ilike(cleaned), 0),
            (Patient.patient_number.ilike(prefix), 1),
            else_=99,
        ),
        case(
            (full_name.ilike(prefix), 1),
            (Patient.first_name.ilike(prefix), 2),
            (Patient.last_name.ilike(prefix), 2),
            else_=99,
        ),
    ).label("rank")

    stmt = _apply_search(_visible(select(Patient), branch_ids), cleaned)
    stmt = _with_relations(stmt).order_by(rank, Patient.first_name).limit(limit)

    return list(db.execute(stmt).unique().scalars().all())


def vitals_for(db: Session, patient_id: uuid_lib.UUID, limit: int = 50) -> list[Vitals]:
    stmt = (
        select(Vitals)
        .options(joinedload(Vitals.nurse))
        .where(Vitals.patient_id == patient_id)
        .order_by(Vitals.recorded_at.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).unique().scalars().all())


def history_for(db: Session, patient_id: uuid_lib.UUID) -> list[MedicalHistoryEntry]:
    stmt = (
        select(MedicalHistoryEntry)
        .options(joinedload(MedicalHistoryEntry.clinician))
        .where(MedicalHistoryEntry.patient_id == patient_id)
        .order_by(MedicalHistoryEntry.entry_date.desc())
    )
    return list(db.execute(stmt).unique().scalars().all())


def documents_for(db: Session, patient_id: uuid_lib.UUID) -> list[PatientDocument]:
    stmt = (
        select(PatientDocument)
        .options(joinedload(PatientDocument.uploader))
        .where(PatientDocument.patient_id == patient_id)
        .order_by(PatientDocument.uploaded_on.desc())
    )
    return list(db.execute(stmt).unique().scalars().all())


#: Stored numbers are formatted for display ("+91 98201 44567"), so a raw LIKE
#: on digits never matches. Both sides are stripped to digits before comparing,
#: and only the last 10 are used so "+91 98201 44567" and "9820144567" are
#: recognised as the same subscriber.
_PHONE_DIGITS = func.regexp_replace(Patient.phone, r"[^0-9]", "", "g")


def phone_in_use(db: Session, phone: str, *, exclude: uuid_lib.UUID | None = None) -> bool:
    """Whether another patient already has this phone number."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 6:
        return False

    tail = digits[-10:]
    stmt = (
        select(func.count())
        .select_from(Patient)
        .where(Patient.phone.is_not(None))
        .where(func.right(_PHONE_DIGITS, len(tail)) == tail)
    )
    if exclude is not None:
        stmt = stmt.where(Patient.id != exclude)
    return db.execute(stmt).scalar_one() > 0
