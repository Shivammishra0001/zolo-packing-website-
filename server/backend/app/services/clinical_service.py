"""Medical history and vitals.

Both are patient-scoped clinical records, so both go through the same access
check: the caller must be able to see the patient *and* hold
``patient.clinical.view``. Demographic access alone is never enough.
"""

from __future__ import annotations

import logging
from datetime import date as date_type, datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.enums import AuditCategory
from app.models.audit import AuditLog
from app.models.patient import MedicalHistoryEntry, Patient
from app.models.user import User
from app.models.vitals import Vitals
from app.repositories import patient_repository as repo
from app.schemas.clinical import (
    MedicalHistoryCreate,
    MedicalHistoryOut,
    VitalsCreate,
    VitalsOut,
)

logger = logging.getLogger(__name__)

CLINICAL_VIEW = "patient.clinical.view"


def _staff_name(user: User | None) -> str | None:
    return user.full_name if user else None


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------


def vitals_out(row: Vitals) -> VitalsOut:
    return VitalsOut(
        id=str(row.id),
        recordedAt=row.recorded_at,
        recordedBy=_staff_name(row.nurse) or "Clinical staff",
        systolic=row.systolic,
        diastolic=row.diastolic,
        heartRate=row.heart_rate,
        temperature=float(row.temperature) if row.temperature is not None else None,
        spo2=row.spo2,
        respiratoryRate=row.respiratory_rate,
    )


def history_out(row: MedicalHistoryEntry) -> MedicalHistoryOut:
    return MedicalHistoryOut(
        id=str(row.id),
        date=row.entry_date,
        type=row.type,
        title=row.title,
        detail=row.detail,
        clinician=_staff_name(row.clinician) or "Clinical staff",
    )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def list_vitals(db: Session, patient: Patient, limit: int = 50) -> list[VitalsOut]:
    return [vitals_out(row) for row in repo.vitals_for(db, patient.id, limit=limit)]


def latest_vitals(db: Session, patient: Patient) -> VitalsOut | None:
    """The most recent observation, or ``None`` if nothing has been recorded.

    `vitals_for` already sorts newest-first and the index covers that order, so
    this is a `LIMIT 1` rather than a second endpoint's worth of machinery.
    """
    rows = repo.vitals_for(db, patient.id, limit=1)
    return vitals_out(rows[0]) if rows else None


def list_history(db: Session, patient: Patient) -> list[MedicalHistoryOut]:
    return [history_out(row) for row in repo.history_for(db, patient.id)]


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def _audit(db: Session, user: User, action: str, patient: Patient, target_id, ip: str | None) -> None:
    """Record that clinical data was written — never the readings themselves."""
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=AuditCategory.PATIENT,
            target_type="patients",
            target_id=target_id,
            summary=f"{patient.patient_number}",
            ip_address=ip,
        )
    )


def record_vitals(
    db: Session, *, patient: Patient, payload: VitalsCreate, user: User, ip: str | None
) -> VitalsOut:
    """Record one observation set. The recorder is the signed-in user."""
    recorded_at = payload.recordedAt or datetime.now(timezone.utc)
    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=timezone.utc)

    row = Vitals(
        patient_id=patient.id,
        recorded_by=user.id,
        recorded_at=recorded_at,
        systolic=payload.systolic,
        diastolic=payload.diastolic,
        heart_rate=payload.heartRate,
        # NUMERIC(4,2) — go through Decimal rather than binding a float.
        temperature=(
            Decimal(str(payload.temperature)) if payload.temperature is not None else None
        ),
        spo2=payload.spo2,
        respiratory_rate=payload.respiratoryRate,
    )
    db.add(row)
    db.flush()

    _audit(db, user, "VITALS_RECORDED", patient, row.id, ip)
    db.commit()
    db.refresh(row)

    logger.info("Vitals recorded for %s by %s", patient.patient_number, user.id)
    return vitals_out(row)


def add_history_entry(
    db: Session,
    *,
    patient: Patient,
    payload: MedicalHistoryCreate,
    user: User,
    ip: str | None,
) -> MedicalHistoryOut:
    """Add a history entry. The clinician is the signed-in user."""
    row = MedicalHistoryEntry(
        patient_id=patient.id,
        entry_date=payload.date or date_type.today(),
        type=payload.type,
        title=payload.title,
        detail=payload.detail,
        clinician_id=user.id,
    )
    db.add(row)
    db.flush()

    _audit(db, user, "MEDICAL_HISTORY_CREATED", patient, row.id, ip)
    db.commit()
    db.refresh(row)

    # The entry's title is clinical content, so it stays out of the log line.
    logger.info("Medical history entry added for %s by %s", patient.patient_number, user.id)
    return history_out(row)
