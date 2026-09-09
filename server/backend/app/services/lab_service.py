"""Lab results and clinical review.

Reports are read-only over the API: the frontend has no lab-entry screen, so no
creation endpoint is exposed. Review is the one write, and every part of it —
who reviewed, when — is set by the server.
"""

from __future__ import annotations

import logging
import uuid as uuid_lib
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.enums import AuditCategory, LabFlag
from app.core.errors import ConflictError, NotFoundError
from app.core.ids import LAB_RESULT
from app.models.audit import AuditLog
from app.models.lab import LabResult
from app.models.user import User
from app.repositories import clinical_repository as repo
from app.services import notification_service as notifications
from app.schemas.lab import LabPage, LabResultResponse, LabValueOut
from app.services.consultation_service import resolve_patient
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)


def to_response(row: LabResult) -> LabResultResponse:
    patient = row.patient
    return LabResultResponse(
        id=row.lab_number,
        uuid=str(row.id),
        patientId=patient.patient_number,
        patientUuid=str(patient.id),
        patientName=patient.full_name,
        test=row.test,
        reportedOn=row.reported_on,
        flag=row.flag,
        summary=row.summary,
        values=[
            LabValueOut(
                analyte=v.analyte,
                value=f"{v.value} {v.unit}".strip() if v.unit else v.value,
                reference=v.reference_range,
                abnormal=v.is_abnormal,
            )
            for v in row.values
        ],
        reviewed=row.reviewed,
        reviewedBy=row.reviewer.full_name if row.reviewer else None,
        reviewedAt=row.reviewed_at,
        orderedBy=row.doctor.full_name if row.doctor else None,
    )


def get_lab(db: Session, *, identifier: str, user: User, permissions: list[str]) -> LabResult:
    row: LabResult | None = None
    if LAB_RESULT.matches(identifier):
        row = repo.get_lab_by_number(db, identifier)
    else:
        try:
            row = repo.get_lab(db, uuid_lib.UUID(identifier))
        except ValueError:
            row = None

    if row is None:
        raise NotFoundError("Lab result not found.")

    branch_ids = visible_branch_ids(db, user, permissions)
    # 404, not 403 — the existence of another branch's report is not disclosed.
    if branch_ids is not None and row.patient.branch_id not in branch_ids:
        raise NotFoundError("Lab result not found.")

    return row


def list_labs(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int,
    limit: int,
    patient: str | None = None,
    reviewed: bool | None = None,
    flag: LabFlag | None = None,
) -> LabPage:
    """Reports the caller may read, newest first.

    Scoped by the patient's branch. Unlike consultations there is no
    per-clinician narrowing: a report is released to whoever is covering the
    patient, which is how the doctor's Labs screen already behaves.
    """
    # Resolving through the patient service applies the same branch check the
    # patient routes use, so an out-of-branch id is a 404 rather than an
    # empty list that looks like "this patient has no reports".
    patient_id = resolve_patient(db, patient, user, permissions).id if patient else None

    rows, total = repo.list_labs(
        db,
        branch_ids=visible_branch_ids(db, user, permissions),
        patient_id=patient_id,
        reviewed=reviewed,
        flag=flag,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return LabPage(
        items=[to_response(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def labs_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[LabResultResponse]:
    return [to_response(row) for row in repo.labs_for_patient(db, patient_id)]


def review(db: Session, *, lab: LabResult, user: User, ip: str | None) -> LabResult:
    """Sign a report off.

    ``reviewed_by`` and ``reviewed_at`` are set here and are not accepted from
    the request — a clinical sign-off has to be attributable to whoever was
    actually authenticated.
    """
    if lab.reviewed:
        raise ConflictError(
            f"This report was already reviewed by {lab.reviewer.full_name if lab.reviewer else 'a clinician'}.",
            code="already_reviewed",
        )

    lab.reviewed = True
    lab.reviewed_by = user.id
    lab.reviewed_at = datetime.now(timezone.utc)

    # The clinician who ordered it is the one waiting on the sign-off. The
    # title names the test; the values stay out of the notification, because a
    # bell menu is not a place for results.
    if lab.doctor_id is not None and lab.doctor_id != user.id:
        notifications.notify(
            db,
            user_id=lab.doctor_id,
            title=f"{lab.test} reviewed",
            body=f"{lab.lab_number} for {lab.patient.full_name}",
            icon=NotificationIcon.CLINICAL,
            severity=NotificationSeverity.INFO,
            href="/doctor/labs",
        )

    db.add(lab)
    db.add(
        AuditLog(
            user_id=user.id,
            action="LAB_REVIEWED",
            category=AuditCategory.PATIENT,
            target_type="lab_results",
            target_id=lab.id,
            # The test name is safe; the values and summary are not, so they
            # are not written here.
            summary=f"{lab.lab_number} for {lab.patient.patient_number}",
            ip_address=ip,
        )
    )
    db.commit()
    db.refresh(lab)

    logger.info("Lab %s reviewed by %s", lab.lab_number, user.id)
    return lab
