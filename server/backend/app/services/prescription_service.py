"""Prescriptions — writing and reading only.

Dispensing belongs to the pharmacy module. Nothing here touches stock: an
out-of-stock medicine can still be prescribed, which is correct, because the
pharmacy is where a substitution gets decided.
"""

from __future__ import annotations

import logging
import re
import uuid as uuid_lib
from datetime import date as date_type

from sqlalchemy.orm import Session

from app.core.enums import AuditCategory, PrescriptionStatus, StockStatus, UserRole
from app.core.errors import ForbiddenError, NotFoundError, UnprocessableError
from app.core.ids import PRESCRIPTION
from app.models.audit import AuditLog
from app.models.pharmacy import Prescription, PrescriptionItem
from app.models.user import User
from app.repositories import clinical_repository as repo
from app.schemas.prescription import (
    MedicineOption,
    PrescriptionCreate,
    PrescriptionItemOut,
    PrescriptionPage,
    PrescriptionResponse,
)
from app.services.consultation_service import resolve_patient
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

#: Only a doctor prescribes. The permission matrix agrees — `prescription.create`
#: is granted to the doctor role alone.
PRESCRIBING_ROLES = {UserRole.DOCTOR}

#: A batch expiring within this window is flagged rather than counted as stock.
#: Mirrors NEAR_EXPIRY_DAYS in the frontend's original medicine data.
NEAR_EXPIRY_DAYS = 45

#: "12 mg", "1.16% w/w" — the trailing dose in a catalogue name.
_STRENGTH = re.compile(r"([\d.]+ ?(?:mg|mcg|ml|g|IU|%)\b.*)$", re.IGNORECASE)


def stock_status(medicine) -> StockStatus:
    """Derive the stock signal from batches — it is never stored.

    Same rule the frontend used before this was a real catalogue: nothing on
    hand is Out of Stock, an imminent expiry outranks quantity, then the
    reorder level decides Low versus In Stock.
    """
    on_hand = sum(batch.quantity for batch in medicine.batches)
    if on_hand == 0:
        return StockStatus.OUT_OF_STOCK

    today = date_type.today()
    soonest = min((b.expiry_date for b in medicine.batches if b.quantity > 0), default=None)
    if soonest is not None and (soonest - today).days <= NEAR_EXPIRY_DAYS:
        return StockStatus.NEAR_EXPIRY

    if on_hand <= (medicine.reorder_level or 0):
        return StockStatus.LOW_STOCK
    return StockStatus.IN_STOCK


def list_medicines(db: Session) -> list[MedicineOption]:
    """The catalogue the consultation form prescribes from."""
    options = []
    for medicine in repo.list_medicines(db):
        match = _STRENGTH.search(medicine.name)
        options.append(
            MedicineOption(
                id=medicine.medicine_number,
                name=medicine.name,
                genericName=medicine.generic_name,
                category=medicine.category,
                strength=match.group(1).strip() if match else None,
                status=stock_status(medicine),
            )
        )
    return options


def to_response(row: Prescription) -> PrescriptionResponse:
    patient = row.patient
    doctor = row.doctor

    return PrescriptionResponse(
        id=row.prescription_number,
        uuid=str(row.id),
        patientId=patient.patient_number,
        patientUuid=str(patient.id),
        patientName=patient.full_name,
        doctor=doctor.full_name if doctor else "",
        doctorId=doctor.user_number if doctor else "",
        consultationId=str(row.consultation_id) if row.consultation_id else None,
        # The frontend shows a date; created_at is the moment it was written.
        date=row.created_at.date(),
        items=[
            PrescriptionItemOut(
                id=str(item.id),
                medicine=item.medicine.name if item.medicine else "",
                strength=item.strength or "",
                dosage=item.dosage or "",
                frequency=item.frequency or "",
                duration=item.duration or "",
                quantity=item.quantity,
                quantityDispensed=item.quantity_dispensed,
                instructions=item.instructions or "",
            )
            for item in row.items
        ],
        status=row.status,
        priority=row.priority,
        createdAt=row.created_at,
    )


def get_prescription(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> Prescription:
    row: Prescription | None = None
    if PRESCRIPTION.matches(identifier):
        row = repo.get_prescription_by_number(db, identifier)
    else:
        try:
            row = repo.get_prescription(db, uuid_lib.UUID(identifier))
        except ValueError:
            row = None

    if row is None:
        raise NotFoundError("Prescription not found.")

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and row.patient.branch_id not in branch_ids:
        raise NotFoundError("Prescription not found.")

    return row


def list_prescriptions(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int,
    limit: int,
    scope: str = "auto",
    patient: str | None = None,
    status: PrescriptionStatus | None = None,
) -> PrescriptionPage:
    """Prescriptions the caller may read.

    A doctor sees what they prescribed — which is exactly what the doctor's
    Prescriptions screen shows. The pharmacy roles see the whole branch queue,
    since dispensing is not per-prescriber.
    """
    doctor_id = None
    if scope != "all" and user.role is UserRole.DOCTOR:
        doctor_id = user.id

    patient_id = resolve_patient(db, patient, user, permissions).id if patient else None

    rows, total = repo.list_prescriptions(
        db,
        branch_ids=visible_branch_ids(db, user, permissions),
        patient_id=patient_id,
        doctor_id=doctor_id,
        status=status,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return PrescriptionPage(
        items=[to_response(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def prescriptions_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[PrescriptionResponse]:
    return [to_response(row) for row in repo.prescriptions_for_patient(db, patient_id)]


def create_prescription(
    db: Session,
    *,
    payload: PrescriptionCreate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> Prescription:
    """Write a prescription and its lines in one transaction.

    Every medicine is resolved before anything is inserted, so an unknown name
    fails the whole request rather than leaving a prescription with missing
    lines behind.
    """
    if user.role not in PRESCRIBING_ROLES:
        raise ForbiddenError("Only a doctor can write a prescription.", code="not_a_prescriber")

    patient = resolve_patient(db, payload.patientId, user, permissions)

    consultation = None
    if payload.consultationId:
        try:
            consultation = repo.get_consultation(db, uuid_lib.UUID(payload.consultationId))
        except ValueError:
            consultation = None
        if consultation is None:
            raise NotFoundError("Consultation not found.")
        if consultation.patient_id != patient.id:
            raise UnprocessableError("That consultation belongs to a different patient.")
        if consultation.doctor_id != user.id:
            raise ForbiddenError(
                "You can only prescribe against your own consultation.",
                code="not_your_consultation",
            )

    # Resolve the catalogue first. Stock is deliberately not consulted — an
    # out-of-stock medicine is still a valid prescription; the pharmacy decides
    # what to substitute.
    resolved = []
    for index, line in enumerate(payload.items, start=1):
        medicine = repo.find_medicine(db, line.medicine)
        if medicine is None:
            raise UnprocessableError(
                f"Item {index}: {line.medicine!r} is not in the medicine catalogue."
            )
        resolved.append((line, medicine))

    prescription = Prescription(
        prescription_number=PRESCRIPTION.format(repo.next_prescription_number(db)),
        patient_id=patient.id,
        doctor_id=user.id,
        consultation_id=consultation.id if consultation else None,
        status=PrescriptionStatus.PENDING,
        priority=payload.priority,
    )
    db.add(prescription)
    db.flush()

    for line, medicine in resolved:
        db.add(
            PrescriptionItem(
                prescription_id=prescription.id,
                medicine_id=medicine.id,
                strength=line.strength,
                dosage=line.dosage,
                frequency=line.frequency,
                duration=line.duration,
                quantity=line.quantity,
                instructions=line.instructions,
            )
        )

    db.add(
        AuditLog(
            user_id=user.id,
            action="PRESCRIPTION_CREATED",
            category=AuditCategory.PATIENT,
            target_type="prescriptions",
            target_id=prescription.id,
            # Count only — the prescribed medicines are clinical content.
            summary=f"{prescription.prescription_number}: {len(resolved)} item(s)",
            ip_address=ip,
        )
    )

    # One commit for the prescription, its items and the audit entry. If any
    # insert fails, none of them lands.
    db.commit()
    db.refresh(prescription)

    logger.info(
        "Prescription %s written by %s with %s item(s)",
        prescription.prescription_number,
        user.id,
        len(resolved),
    )
    return prescription
