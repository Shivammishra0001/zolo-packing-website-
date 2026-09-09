"""Data access for consultations, lab results and prescriptions.

Branch scoping always runs through the patient, exactly as it does for
appointments — none of these records carries a branch of its own, and the
patient's branch is what decides who may read them.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import date as date_type

from sqlalchemy import Integer, Select, func, select, text
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.enums import LabFlag, PrescriptionStatus
from app.models.consultation import Consultation
from app.models.lab import LabResult
from app.models.patient import Patient
from app.models.pharmacy import Medicine, Prescription, PrescriptionItem


def _visible(stmt: Select, model, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    """Restrict to rows whose patient belongs to a visible branch."""
    if branch_ids is None:
        return stmt
    stmt = stmt.join(Patient, model.patient_id == Patient.id)
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Patient.branch_id.in_(branch_ids))


def _page(db: Session, stmt: Select, model, order, offset: int, limit: int, options):
    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(model.id).subquery())
    ).scalar_one()
    rows = (
        db.execute(stmt.options(*options).order_by(*order).offset(offset).limit(limit))
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


# ---------------------------------------------------------------------------
# Consultations
# ---------------------------------------------------------------------------

_CONSULTATION_RELATIONS = (
    joinedload(Consultation.patient),
    joinedload(Consultation.doctor),
    joinedload(Consultation.appointment),
    selectinload(Consultation.prescriptions),
)


def get_consultation(db: Session, consultation_id: uuid_lib.UUID) -> Consultation | None:
    return (
        db.execute(
            select(Consultation)
            .options(*_CONSULTATION_RELATIONS)
            .where(Consultation.id == consultation_id)
        )
        .unique()
        .scalar_one_or_none()
    )


def consultation_for_appointment(
    db: Session, appointment_id: uuid_lib.UUID
) -> Consultation | None:
    """The encounter already recorded against an appointment, if any."""
    return (
        db.execute(
            select(Consultation)
            .options(*_CONSULTATION_RELATIONS)
            .where(Consultation.appointment_id == appointment_id)
        )
        .unique()
        .scalar_one_or_none()
    )


def list_consultations(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    patient_id: uuid_lib.UUID | None = None,
    doctor_id: uuid_lib.UUID | None = None,
    appointment_id: uuid_lib.UUID | None = None,
    on_date: date_type | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Consultation], int]:
    stmt = _visible(select(Consultation), Consultation, branch_ids)

    if patient_id is not None:
        stmt = stmt.where(Consultation.patient_id == patient_id)
    if doctor_id is not None:
        stmt = stmt.where(Consultation.doctor_id == doctor_id)
    if appointment_id is not None:
        stmt = stmt.where(Consultation.appointment_id == appointment_id)
    if on_date is not None:
        stmt = stmt.where(func.date(Consultation.created_at) == on_date)
    if date_from is not None:
        stmt = stmt.where(func.date(Consultation.created_at) >= date_from)
    if date_to is not None:
        stmt = stmt.where(func.date(Consultation.created_at) <= date_to)

    return _page(
        db,
        stmt,
        Consultation,
        (Consultation.created_at.desc(),),
        offset,
        limit,
        _CONSULTATION_RELATIONS,
    )


def follow_ups_due(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    doctor_id: uuid_lib.UUID | None,
    through: date_type,
) -> list[Consultation]:
    """Consultations whose follow-up date has arrived or passed.

    Only the most recent encounter per patient counts — an older consultation
    whose follow-up already happened should not keep reappearing.
    """
    stmt = _visible(select(Consultation), Consultation, branch_ids).where(
        Consultation.follow_up_date.is_not(None),
        Consultation.follow_up_date <= through,
    )
    if doctor_id is not None:
        stmt = stmt.where(Consultation.doctor_id == doctor_id)

    rows = (
        db.execute(stmt.options(*_CONSULTATION_RELATIONS).order_by(Consultation.follow_up_date))
        .unique()
        .scalars()
        .all()
    )

    latest: dict[uuid_lib.UUID, Consultation] = {}
    for row in rows:
        current = latest.get(row.patient_id)
        if current is None or row.created_at > current.created_at:
            latest[row.patient_id] = row
    return sorted(latest.values(), key=lambda c: c.follow_up_date)


# ---------------------------------------------------------------------------
# Lab results
# ---------------------------------------------------------------------------

_LAB_RELATIONS = (
    joinedload(LabResult.patient),
    joinedload(LabResult.doctor),
    joinedload(LabResult.reviewer),
    selectinload(LabResult.values),
)


def get_lab(db: Session, lab_id: uuid_lib.UUID) -> LabResult | None:
    return (
        db.execute(select(LabResult).options(*_LAB_RELATIONS).where(LabResult.id == lab_id))
        .unique()
        .scalar_one_or_none()
    )


def get_lab_by_number(db: Session, number: str) -> LabResult | None:
    return (
        db.execute(
            select(LabResult).options(*_LAB_RELATIONS).where(LabResult.lab_number == number.upper())
        )
        .unique()
        .scalar_one_or_none()
    )


def list_labs(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    patient_id: uuid_lib.UUID | None = None,
    reviewed: bool | None = None,
    flag: LabFlag | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[LabResult], int]:
    stmt = _visible(select(LabResult), LabResult, branch_ids)

    if patient_id is not None:
        stmt = stmt.where(LabResult.patient_id == patient_id)
    if reviewed is not None:
        stmt = stmt.where(LabResult.reviewed.is_(reviewed))
    if flag is not None:
        stmt = stmt.where(LabResult.flag == flag)

    return _page(
        db,
        stmt,
        LabResult,
        (LabResult.reported_on.desc(), LabResult.created_at.desc()),
        offset,
        limit,
        _LAB_RELATIONS,
    )


def labs_for_patient(db: Session, patient_id: uuid_lib.UUID, limit: int = 50) -> list[LabResult]:
    rows, _ = list_labs(db, branch_ids=None, patient_id=patient_id, limit=limit)
    return rows


# ---------------------------------------------------------------------------
# Prescriptions
# ---------------------------------------------------------------------------

_PRESCRIPTION_RELATIONS = (
    joinedload(Prescription.patient),
    joinedload(Prescription.doctor),
    joinedload(Prescription.consultation),
    selectinload(Prescription.items).joinedload(PrescriptionItem.medicine),
)


def get_prescription(db: Session, prescription_id: uuid_lib.UUID) -> Prescription | None:
    return (
        db.execute(
            select(Prescription)
            .options(*_PRESCRIPTION_RELATIONS)
            .where(Prescription.id == prescription_id)
        )
        .unique()
        .scalar_one_or_none()
    )


def get_prescription_by_number(db: Session, number: str) -> Prescription | None:
    return (
        db.execute(
            select(Prescription)
            .options(*_PRESCRIPTION_RELATIONS)
            .where(Prescription.prescription_number == number.upper())
        )
        .unique()
        .scalar_one_or_none()
    )


def list_prescriptions(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    patient_id: uuid_lib.UUID | None = None,
    doctor_id: uuid_lib.UUID | None = None,
    consultation_id: uuid_lib.UUID | None = None,
    status: PrescriptionStatus | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Prescription], int]:
    stmt = _visible(select(Prescription), Prescription, branch_ids)

    if patient_id is not None:
        stmt = stmt.where(Prescription.patient_id == patient_id)
    if doctor_id is not None:
        stmt = stmt.where(Prescription.doctor_id == doctor_id)
    if consultation_id is not None:
        stmt = stmt.where(Prescription.consultation_id == consultation_id)
    if status is not None:
        stmt = stmt.where(Prescription.status == status)

    return _page(
        db,
        stmt,
        Prescription,
        (Prescription.created_at.desc(),),
        offset,
        limit,
        _PRESCRIPTION_RELATIONS,
    )


def prescriptions_for_patient(
    db: Session, patient_id: uuid_lib.UUID, limit: int = 50
) -> list[Prescription]:
    rows, _ = list_prescriptions(db, branch_ids=None, patient_id=patient_id, limit=limit)
    return rows


def list_medicines(db: Session) -> list[Medicine]:
    """The prescribable catalogue, with batches loaded for the stock signal."""
    return list(
        db.execute(
            select(Medicine)
            .options(selectinload(Medicine.batches))
            .where(Medicine.is_active.is_(True))
            .order_by(Medicine.name)
        )
        .unique()
        .scalars()
        .all()
    )


def find_medicine(db: Session, name: str) -> Medicine | None:
    """Resolve a catalogue name, case-insensitively."""
    return db.execute(
        select(Medicine).where(func.lower(Medicine.name) == name.strip().lower())
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Number allocation
# ---------------------------------------------------------------------------


def _next_number(db: Session, column, prefix: str, start: int) -> int:
    """Next value of a ``PREFIX-####`` code, serialised by an advisory lock.

    Uses MAX of the numeric suffix rather than COUNT, so a gap left by a
    rolled-back transaction cannot produce a duplicate.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"code:{prefix}"})
    current = db.execute(
        select(
            func.coalesce(
                func.max(func.cast(func.split_part(column, "-", 2), Integer)),
                start,
            )
        ).where(column.like(f"{prefix}-%"))
    ).scalar_one()
    return int(current) + 1


def next_prescription_number(db: Session) -> int:
    return _next_number(db, Prescription.prescription_number, "RX", 7700)


def next_lab_number(db: Session) -> int:
    return _next_number(db, LabResult.lab_number, "LAB", 3300)
