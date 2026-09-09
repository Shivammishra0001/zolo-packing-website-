"""Wards, beds, admissions, nursing tasks and discharge.

Two invariants shape this module, and both are enforced here rather than in the
browser:

* a bed holds at most one active admission, and a patient occupies at most one
  bed. Both are backed by partial unique indexes, so even a race that slips past
  the checks below is refused by PostgreSQL rather than corrupting the ward;
* a bed's occupancy is a *consequence* of an admission. Nothing outside
  :func:`admit` and :func:`discharge` may set a bed Occupied or clear it, which
  is why :class:`BedStatusUpdate` only carries housekeeping states.

Vitals are not re-implemented here. The nurse's round posts against an
admission, and the reading is written by ``clinical_service`` into the one
vitals table Step 7 created.
"""

from __future__ import annotations

import logging
import uuid as uuid_lib
from datetime import date as date_type, datetime, time as time_type, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import (
    AdmissionStatus,
    AuditCategory,
    BedStatus,
    BedType,
    NursingTaskType,
    PatientStatus,
    TaskPriority,
    UserRole,
)
from app.core.errors import ConflictError, NotFoundError, UnprocessableError
from app.core.ids import USER
from app.models.audit import AuditLog
from app.models.organisation import Branch
from app.models.user import User
from app.models.ward import Admission, Bed, DischargeChecklistItem, NursingTask, Ward
from app.repositories import nursing_repository as repo
from app.schemas.clinical import VitalsCreate, VitalsOut
from app.schemas.nursing import (
    AdmissionCreate,
    AdmissionPage,
    AdmissionResponse,
    AdmissionUpdate,
    BedCreate,
    BedResponse,
    BedStatusUpdate,
    BedSummary,
    BedUpdate,
    ChecklistItemOut,
    ChecklistItemUpdate,
    DischargeRequest,
    NursingDashboard,
    NursingTaskResponse,
    NursingTaskUpdate,
    WardCreate,
    WardResponse,
    WardUpdate,
)
from app.services import clinical_service
from app.services.avatars import avatar_colour, initials
from app.services.consultation_service import resolve_patient
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

#: The discharge checklist, taken verbatim from the frontend's `BASE_CHECKLIST`
#: in `src/pages/nurse/Discharges.tsx`. Every line is mandatory: that screen
#: disables the discharge button until the progress bar reaches 100%, so the
#: rule is the frontend's, not one invented here.
DEFAULT_CHECKLIST: tuple[str, ...] = (
    "Final vitals recorded",
    "Discharge summary signed by doctor",
    "Medication reconciliation completed",
    "Home exercise programme handed over",
    "Follow-up appointment booked",
    "Billing cleared with accounts",
)

#: Statuses a bed may be moved to by hand. Occupied, and the clearing of an
#: occupant, belong to the admission workflow — see the module docstring.
HOUSEKEEPING_STATUSES = {BedStatus.AVAILABLE, BedStatus.RESERVED, BedStatus.CLEANING}

#: A bed one may admit into. A reservation exists precisely to become an
#: admission, so it is not an obstacle; Cleaning and Occupied are.
ADMISSIBLE_STATUSES = {BedStatus.AVAILABLE, BedStatus.RESERVED}

#: Where a bed may be left after a discharge.
POST_DISCHARGE_STATUSES = {BedStatus.AVAILABLE, BedStatus.CLEANING}


# ---------------------------------------------------------------------------
# Time
# ---------------------------------------------------------------------------


def _today() -> date_type:
    """The clinic's date, not the server's."""
    return datetime.now(settings.clinic_tz).date()


def _day_bounds(day: date_type) -> tuple[datetime, datetime]:
    """The clinic's day as two UTC instants.

    Counting "today" with a date cast would use whatever zone the database
    session happens to carry; a half-open window in UTC means the answer does
    not depend on that.
    """
    start = datetime.combine(day, time_type.min, tzinfo=settings.clinic_tz)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def _local_hhmm(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(settings.clinic_tz).strftime("%H:%M")


def _staff_name(user: User | None) -> str:
    return user.full_name if user else ""


def _age(dob: date_type | None) -> int | None:
    if dob is None:
        return None
    today = _today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------


def ward_out(ward: Ward) -> WardResponse:
    """Occupancy counted from the ward's own beds — never a stored figure."""
    beds = list(ward.beds)
    total = len(beds)
    occupied = sum(1 for bed in beds if bed.status is BedStatus.OCCUPIED)
    return WardResponse(
        id=str(ward.id),
        name=ward.name,
        branch=ward.branch.name if ward.branch else "",
        branchId=str(ward.branch_id),
        totalBeds=total,
        occupied=occupied,
        available=sum(1 for bed in beds if bed.status is BedStatus.AVAILABLE),
        reserved=sum(1 for bed in beds if bed.status is BedStatus.RESERVED),
        cleaning=sum(1 for bed in beds if bed.status is BedStatus.CLEANING),
        occupancyRate=round(occupied / total * 100) if total else 0,
    )


def bed_out(bed: Bed, admission: Admission | None = None) -> BedResponse:
    """One bed in the flat shape the board renders.

    The occupant is read from the active admission when one is supplied, with
    the denormalised ``bed.patient`` as the fallback — so a bed always names
    whoever the admissions table says is in it.
    """
    patient = admission.patient if admission else bed.patient
    return BedResponse(
        id=str(bed.id),
        ward=bed.ward.name if bed.ward else "",
        wardId=str(bed.ward_id),
        room=bed.room or "",
        bed=bed.bed_number,
        type=bed.type,
        status=bed.status,
        patientId=patient.patient_number if patient else None,
        patientUuid=str(patient.id) if patient else None,
        # A reservation may be held against someone not yet registered, which is
        # why the free-text holder stands in for a name here.
        patientName=(patient.full_name if patient else bed.reserved_for),
        since=admission.admission_date if admission else None,
        dailyRate=bed.daily_rate,
        admissionId=str(admission.id) if admission else None,
    )


def beds_out(db: Session, beds: list[Bed]) -> list[BedResponse]:
    active = repo.active_admissions_by_bed(db, [bed.id for bed in beds])
    return [bed_out(bed, active.get(bed.id)) for bed in beds]


def bed_summary(beds: list[Bed]) -> BedSummary:
    total = len(beds)
    occupied = sum(1 for bed in beds if bed.status is BedStatus.OCCUPIED)
    return BedSummary(
        total=total,
        occupied=occupied,
        available=sum(1 for bed in beds if bed.status is BedStatus.AVAILABLE),
        reserved=sum(1 for bed in beds if bed.status is BedStatus.RESERVED),
        cleaning=sum(1 for bed in beds if bed.status is BedStatus.CLEANING),
        occupancyRate=round(occupied / total * 100) if total else 0,
    )


def checklist_out(item: DischargeChecklistItem) -> ChecklistItemOut:
    return ChecklistItemOut(
        id=str(item.id),
        label=item.label,
        detail=item.detail,
        done=item.completed,
        completedBy=_staff_name(item.completer) or None,
        completedAt=item.completed_at,
        sortOrder=item.sort_order,
    )


def admission_out(row: Admission) -> AdmissionResponse:
    patient = row.patient
    bed = row.bed
    ward = bed.ward if bed else None
    checklist = [checklist_out(item) for item in row.checklist_items]
    done = sum(1 for item in checklist if item.done)

    return AdmissionResponse(
        id=str(row.id),
        patientId=patient.patient_number,
        patientUuid=str(patient.id),
        patientName=patient.full_name,
        patientInitials=initials(patient),
        patientAvatarColor=avatar_colour(patient),
        age=_age(patient.date_of_birth),
        primaryCondition=patient.primary_condition,
        ward=ward.name if ward else "",
        wardId=str(ward.id) if ward else None,
        room=(bed.room or "") if bed else "",
        bed=bed.bed_number if bed else "",
        bedId=str(row.bed_id),
        bedType=bed.type if bed else None,
        dailyRate=bed.daily_rate if bed else None,
        admissionDate=row.admission_date,
        expectedDischarge=row.expected_discharge,
        dischargeDate=row.discharge_date,
        status=row.status,
        attendingDoctor=_staff_name(row.attending_doctor),
        admittedBy=_staff_name(row.admitting_staff),
        checklist=checklist,
        checklistComplete=bool(checklist) and done == len(checklist),
        checklistProgress=round(done / len(checklist) * 100) if checklist else 0,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def task_out(row: NursingTask, now: datetime | None = None) -> NursingTaskResponse:
    now = now or datetime.now(timezone.utc)
    due_at = row.due_at
    if due_at is not None and due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=timezone.utc)

    return NursingTaskResponse(
        id=str(row.id),
        patientId=row.patient.patient_number,
        patientUuid=str(row.patient_id),
        patientName=row.patient.full_name,
        ward=row.ward.name if row.ward else "",
        bed=row.bed.bed_number if row.bed else "",
        type=row.type,
        label=row.label,
        # A timed task shows its clock time; recurring work shows its phrase.
        due=row.due_label or _local_hhmm(due_at) or "",
        priority=row.priority,
        done=row.done,
        assignedTo=_staff_name(row.assignee) or None,
        completedBy=_staff_name(row.completer) or None,
        completedAt=row.completed_at,
        overdue=bool(not row.done and due_at is not None and due_at < now),
    )


# ---------------------------------------------------------------------------
# Resolution — every lookup fails as 404 when out of the caller's branch
# ---------------------------------------------------------------------------


def _uuid_or_none(value: str | None) -> uuid_lib.UUID | None:
    try:
        return uuid_lib.UUID(value)  # type: ignore[arg-type]
    except (ValueError, AttributeError, TypeError):
        return None


def _visible(branch_ids: list[uuid_lib.UUID] | None, branch_id: uuid_lib.UUID | None) -> bool:
    return branch_ids is None or branch_id in branch_ids


def _resolve_ward(db: Session, identifier: str, branch_ids) -> Ward:
    ward_id = _uuid_or_none(identifier)
    ward = repo.get_ward(db, ward_id) if ward_id else None
    if ward is None or not _visible(branch_ids, ward.branch_id):
        # 404 rather than 403: a 403 would confirm the ward exists elsewhere.
        raise NotFoundError("Ward not found.")
    return ward


def _resolve_bed(db: Session, identifier: str, branch_ids) -> Bed:
    bed_id = _uuid_or_none(identifier)
    bed = (
        repo.get_bed(db, bed_id)
        if bed_id
        # Scoped inside the query: a bed number is unique per ward, so two
        # branches can each have an A-101 and only the caller's own may match.
        else repo.find_bed_by_number(db, identifier, branch_ids=branch_ids)
    )
    if bed is None or not _visible(branch_ids, bed.ward.branch_id if bed.ward else None):
        raise NotFoundError("Bed not found.")
    return bed


def _resolve_admission(db: Session, identifier: str, branch_ids) -> Admission:
    admission_id = _uuid_or_none(identifier)
    row = repo.get_admission(db, admission_id) if admission_id else None
    if row is None or not _visible(branch_ids, row.patient.branch_id):
        raise NotFoundError("Admission not found.")
    return row


def _resolve_task(db: Session, identifier: str, branch_ids) -> NursingTask:
    task_id = _uuid_or_none(identifier)
    row = repo.get_task(db, task_id) if task_id else None
    if row is None or not _visible(branch_ids, row.patient.branch_id):
        raise NotFoundError("Task not found.")
    return row


def _resolve_doctor(db: Session, identifier: str | None) -> User | None:
    """The attending doctor named on an admission, if any.

    Accepts a UUID or a ``USR-####`` code, the same two forms every other
    staff reference in the API takes.
    """
    if not identifier:
        return None

    doctor: User | None = None
    if USER.matches(identifier):
        doctor = db.execute(
            select(User).where(User.user_number == identifier.upper())
        ).scalar_one_or_none()
    else:
        parsed = _uuid_or_none(identifier)
        if parsed is not None:
            doctor = db.execute(select(User).where(User.id == parsed)).scalar_one_or_none()

    # Both failures are worded the same way on purpose. Naming the person
    # behind a user id would let anyone who may admit a patient walk the staff
    # table by guessing ids.
    if doctor is None or doctor.role is not UserRole.DOCTOR:
        raise UnprocessableError(f"No doctor found for {identifier!r}.")
    return doctor


def _audit(
    db: Session,
    user: User,
    action: str,
    target_type: str,
    target_id,
    summary: str,
    ip: str | None,
    category: AuditCategory = AuditCategory.PATIENT,
) -> None:
    """Record that something happened, never the clinical content of it.

    Summaries carry codes and bed numbers. A condition, a reading or a
    medication never reaches the audit trail.
    """
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=category,
            target_type=target_type,
            target_id=target_id,
            summary=summary,
            ip_address=ip,
        )
    )


def _commit_or_conflict(db: Session, message: str, code: str, *, log_context: str = "") -> None:
    """Commit, turning a uniqueness violation into a conflict rather than a 503.

    Every "does this already exist?" check here is a read followed by a write,
    so a second caller can slip between the two. The database refuses the
    duplicate either way; this is only about the caller being told *why*.
    """
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # The exception text can carry SQL and column values, so only the
        # constraint we were expecting is mentioned, and only in the log.
        logger.warning("Rejected by a uniqueness constraint%s", f": {log_context}" if log_context else "")
        raise ConflictError(message, code=code) from None


# ---------------------------------------------------------------------------
# Wards
# ---------------------------------------------------------------------------


def list_wards(db: Session, *, user: User, permissions: list[str]) -> list[WardResponse]:
    branch_ids = visible_branch_ids(db, user, permissions)
    return [ward_out(ward) for ward in repo.list_wards(db, branch_ids=branch_ids)]


def create_ward(
    db: Session, *, payload: WardCreate, user: User, permissions: list[str], ip: str | None
) -> WardResponse:
    branch_ids = visible_branch_ids(db, user, permissions)

    branch_id = _uuid_or_none(payload.branchId) if payload.branchId else user.branch_id
    if branch_id is None:
        raise UnprocessableError("A ward needs a branch, and you are not assigned to one.")
    if not _visible(branch_ids, branch_id):
        raise NotFoundError("Branch not found.")

    # Without this an unknown branchId reaches PostgreSQL as a foreign-key
    # violation and surfaces as a 503, which says nothing useful.
    if db.get(Branch, branch_id) is None:
        raise NotFoundError("Branch not found.")

    if repo.find_ward(db, branch_id, payload.name) is not None:
        raise ConflictError(f"{payload.name} already exists in that branch.", code="ward_exists")

    ward = Ward(branch_id=branch_id, name=payload.name.strip())
    db.add(ward)
    db.flush()
    _audit(
        db, user, "WARD_CREATED", "wards", ward.id, ward.name, ip,
        category=AuditCategory.SYSTEM,
    )
    _commit_or_conflict(
        db, f"{payload.name} already exists in that branch.", "ward_exists", log_context="wards"
    )
    db.refresh(ward)
    return ward_out(ward)


def update_ward(
    db: Session,
    *,
    identifier: str,
    payload: WardUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> WardResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    ward = _resolve_ward(db, identifier, branch_ids)

    if payload.name is not None and payload.name.strip() != ward.name:
        clash = repo.find_ward(db, ward.branch_id, payload.name)
        if clash is not None and clash.id != ward.id:
            raise ConflictError(f"{payload.name} already exists in that branch.", code="ward_exists")
        ward.name = payload.name.strip()

    _audit(
        db, user, "WARD_UPDATED", "wards", ward.id, ward.name, ip,
        category=AuditCategory.SYSTEM,
    )
    _commit_or_conflict(
        db, "That ward name is already taken in this branch.", "ward_exists", log_context="wards"
    )
    db.refresh(ward)
    return ward_out(ward)


# ---------------------------------------------------------------------------
# Beds
# ---------------------------------------------------------------------------


def list_beds(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    ward: str | None = None,
    status: BedStatus | None = None,
    bed_type: BedType | None = None,
) -> list[BedResponse]:
    branch_ids = visible_branch_ids(db, user, permissions)
    ward_id = _resolve_ward(db, ward, branch_ids).id if ward else None
    rows = repo.list_beds(
        db, branch_ids=branch_ids, ward_id=ward_id, status=status, bed_type=bed_type
    )
    return beds_out(db, rows)


def bed_overview(db: Session, *, user: User, permissions: list[str]) -> BedSummary:
    branch_ids = visible_branch_ids(db, user, permissions)
    return bed_summary(repo.list_beds(db, branch_ids=branch_ids))


def create_bed(
    db: Session, *, payload: BedCreate, user: User, permissions: list[str], ip: str | None
) -> BedResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    ward = _resolve_ward(db, payload.wardId, branch_ids)

    if repo.find_bed_in_ward(db, ward.id, payload.bedNumber) is not None:
        raise ConflictError(
            f"{ward.name} already has a bed {payload.bedNumber}.", code="bed_exists"
        )

    bed = Bed(
        ward_id=ward.id,
        bed_number=payload.bedNumber.strip(),
        room=payload.room.strip() if payload.room else None,
        type=payload.type,
        # A new bed has nobody in it. Occupancy is never asserted directly.
        status=BedStatus.AVAILABLE,
        daily_rate=payload.dailyRate,
    )
    db.add(bed)
    db.flush()
    _audit(
        db, user, "BED_CREATED", "beds", bed.id, f"{ward.name} {bed.bed_number}", ip,
        category=AuditCategory.SYSTEM,
    )
    _commit_or_conflict(
        db, f"{ward.name} already has a bed {payload.bedNumber}.", "bed_exists", log_context="beds"
    )
    db.refresh(bed)
    return bed_out(bed)


def update_bed(
    db: Session,
    *,
    identifier: str,
    payload: BedUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> BedResponse:
    """Amend a bed's description. Its status is not reachable from here."""
    branch_ids = visible_branch_ids(db, user, permissions)
    bed = _resolve_bed(db, identifier, branch_ids)

    if payload.bedNumber is not None and payload.bedNumber.strip().upper() != bed.bed_number.upper():
        clash = repo.find_bed_in_ward(db, bed.ward_id, payload.bedNumber)
        if clash is not None and clash.id != bed.id:
            raise ConflictError(
                f"That ward already has a bed {payload.bedNumber}.", code="bed_exists"
            )
        bed.bed_number = payload.bedNumber.strip()

    if payload.room is not None:
        bed.room = payload.room.strip() or None
    if payload.type is not None:
        bed.type = payload.type
    if payload.dailyRate is not None:
        bed.daily_rate = payload.dailyRate

    _audit(
        db, user, "BED_UPDATED", "beds", bed.id, bed.bed_number, ip,
        category=AuditCategory.SYSTEM,
    )
    _commit_or_conflict(
        db, "That ward already has a bed with that number.", "bed_exists", log_context="beds"
    )
    db.refresh(bed)
    active = repo.active_admission_for_bed(db, bed.id)
    return bed_out(bed, active)


def set_bed_status(
    db: Session,
    *,
    identifier: str,
    payload: BedStatusUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> BedResponse:
    """Move a bed through housekeeping.

    Occupancy is deliberately unreachable from here. A bed becomes Occupied
    because someone was admitted to it and is freed because they were
    discharged; letting the board write that state directly would let it drift
    away from the admissions it is supposed to be reporting.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    bed = _resolve_bed(db, identifier, branch_ids)

    if payload.status not in HOUSEKEEPING_STATUSES:
        raise UnprocessableError(
            "A bed is set Occupied by admitting a patient, not by editing the board.",
            code="occupancy_not_settable",
        )

    locked = repo.lock_bed(db, bed.id)
    if locked is None:  # pragma: no cover - the row was resolved a moment ago
        raise NotFoundError("Bed not found.")

    if locked.status is BedStatus.OCCUPIED:
        raise ConflictError(
            f"Bed {locked.bed_number} is occupied. Discharge the patient first.",
            code="bed_occupied",
        )

    locked.status = payload.status
    locked.reserved_for = payload.reservedFor if payload.status is BedStatus.RESERVED else None

    _audit(
        db,
        user,
        "BED_STATUS_CHANGED",
        "beds",
        locked.id,
        f"{locked.bed_number} -> {payload.status.display}",
        ip,
        category=AuditCategory.SYSTEM,
    )
    db.commit()
    db.refresh(locked)
    return bed_out(locked)


# ---------------------------------------------------------------------------
# Admissions
# ---------------------------------------------------------------------------


def list_admissions(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int = 1,
    limit: int = 50,
    patient: str | None = None,
    ward: str | None = None,
    status: AdmissionStatus | None = None,
    active: bool = False,
) -> AdmissionPage:
    branch_ids = visible_branch_ids(db, user, permissions)
    patient_id = resolve_patient(db, patient, user, permissions).id if patient else None
    ward_id = _resolve_ward(db, ward, branch_ids).id if ward else None

    statuses: list[AdmissionStatus] | None = None
    if status is not None:
        statuses = [status]
    elif active:
        statuses = list(repo.ACTIVE_STATUSES)

    rows, total = repo.list_admissions(
        db,
        branch_ids=branch_ids,
        patient_id=patient_id,
        ward_id=ward_id,
        statuses=statuses,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return AdmissionPage(
        items=[admission_out(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def get_admission(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> AdmissionResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    return admission_out(_resolve_admission(db, identifier, branch_ids))


def admissions_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[AdmissionResponse]:
    """Patient 360's admission history. Access is checked by the caller."""
    return [admission_out(row) for row in repo.admissions_for_patient(db, patient_id)]


def active_admission_for(db: Session, patient_id: uuid_lib.UUID) -> AdmissionResponse | None:
    row = repo.active_admission_for_patient(db, patient_id)
    return admission_out(row) if row else None


def _admission_conflict(exc: IntegrityError, patient, bed: Bed) -> ConflictError:
    """Turn a partial-index violation into the conflict the caller expects.

    Two indexes guard an admission, and they fail for different reasons: the
    bed is taken, or the patient already has one. The frontend branches on the
    code, so the two are not collapsed into a single message.
    """
    constraint = str(getattr(exc, "orig", exc))
    if "uq_admissions_active_patient" in constraint:
        logger.warning("Admission rejected: %s is already admitted", patient.patient_number)
        return ConflictError(
            f"{patient.full_name} was admitted elsewhere while this was being saved.",
            code="already_admitted",
        )

    logger.warning("Admission rejected: bed %s is already taken", bed.id)
    return ConflictError(
        "That bed was taken while this admission was being saved.", code="bed_unavailable"
    )


def admit(
    db: Session,
    *,
    payload: AdmissionCreate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> AdmissionResponse:
    """Admit a patient to a bed, atomically.

    The whole sequence runs in one transaction with the bed row locked::

        BEGIN -> lock bed -> check the bed is free -> check the patient is not
        already admitted -> insert the admission and its checklist -> mark the
        bed Occupied -> COMMIT

    Anything that fails rolls the lot back, so there is no state in which a
    patient is admitted to a bed the board still shows as free. Two staff
    admitting to the same bed serialise on the lock, and the second then sees
    the bed as Occupied. If even that were bypassed, the partial unique indexes
    on ``admissions`` refuse the second row.
    """
    patient = resolve_patient(db, payload.patientId, user, permissions)
    branch_ids = visible_branch_ids(db, user, permissions)
    bed = _resolve_bed(db, payload.bedId, branch_ids)
    doctor = _resolve_doctor(db, payload.attendingDoctorId)

    admission_date = payload.admissionDate or _today()
    if payload.expectedDischarge and payload.expectedDischarge < admission_date:
        raise UnprocessableError("The expected discharge cannot be before the admission date.")

    # --- everything below runs with the bed row held ------------------------
    locked = repo.lock_bed(db, bed.id)
    if locked is None:  # pragma: no cover - resolved a moment ago
        raise NotFoundError("Bed not found.")

    if locked.ward is not None and locked.ward.branch_id != patient.branch_id:
        raise UnprocessableError(
            "That bed is in a different branch from the patient.", code="branch_mismatch"
        )

    if locked.status not in ADMISSIBLE_STATUSES:
        raise ConflictError(
            f"Bed {locked.bed_number} is {locked.status.display.lower()}.", code="bed_unavailable"
        )

    if repo.active_admission_for_bed(db, locked.id) is not None:
        raise ConflictError(
            f"Bed {locked.bed_number} already has an active admission.", code="bed_unavailable"
        )

    existing = repo.active_admission_for_patient(db, patient.id)
    if existing is not None:
        raise ConflictError(
            f"{patient.full_name} is already admitted to {existing.bed.bed_number}.",
            code="already_admitted",
        )

    admission = Admission(
        patient_id=patient.id,
        bed_id=locked.id,
        admission_date=admission_date,
        expected_discharge=payload.expectedDischarge,
        status=AdmissionStatus.ADMITTED,
        # Never taken from the request — the admitting user is the caller.
        admitted_by=user.id,
        attending_doctor_id=doctor.id if doctor else patient.assigned_doctor_id,
    )
    db.add(admission)
    # The flush is inside the guard because that is the statement the partial
    # unique indexes reject. They are partial indexes, which PostgreSQL cannot
    # defer, so the violation is raised here and never at COMMIT — a guard
    # around the commit alone could not fire for the race it exists to catch.
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise _admission_conflict(exc, patient, locked) from None

    for order, label in enumerate(DEFAULT_CHECKLIST):
        db.add(
            DischargeChecklistItem(
                admission_id=admission.id, label=label, completed=False, sort_order=order
            )
        )

    locked.status = BedStatus.OCCUPIED
    locked.patient_id = patient.id
    locked.reserved_for = None
    patient.status = PatientStatus.ADMITTED_IPD

    _audit(
        db,
        user,
        "PATIENT_ADMITTED",
        "admissions",
        admission.id,
        f"{patient.patient_number} -> {locked.bed_number}",
        ip,
    )

    try:
        db.commit()
    except IntegrityError as exc:  # pragma: no cover - the flush above catches the real race
        db.rollback()
        raise _admission_conflict(exc, patient, locked) from None

    db.refresh(admission)
    logger.info(
        "Patient %s admitted to bed %s by %s",
        patient.patient_number,
        locked.bed_number,
        user.id,
    )
    return admission_out(admission)


def update_admission(
    db: Session,
    *,
    identifier: str,
    payload: AdmissionUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> AdmissionResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    admission = _resolve_admission(db, identifier, branch_ids)

    if admission.status is AdmissionStatus.DISCHARGED:
        raise ConflictError("This stay has ended and can no longer be amended.", code="discharged")

    if payload.expectedDischarge is not None:
        if payload.expectedDischarge < admission.admission_date:
            raise UnprocessableError("The expected discharge cannot be before the admission date.")
        admission.expected_discharge = payload.expectedDischarge

    if payload.attendingDoctorId is not None:
        doctor = _resolve_doctor(db, payload.attendingDoctorId)
        admission.attending_doctor_id = doctor.id if doctor else None

    _audit(
        db,
        user,
        "ADMISSION_UPDATED",
        "admissions",
        admission.id,
        admission.patient.patient_number,
        ip,
    )
    db.commit()
    db.refresh(admission)
    return admission_out(admission)


def start_discharge(
    db: Session, *, identifier: str, user: User, permissions: list[str], ip: str | None
) -> AdmissionResponse:
    """Mark a stay Discharge Pending — the state the ward's checklist works in.

    The bed stays Occupied, because the patient is still in it.

    The admission is locked before its status is read. Without that, a nurse
    opening the discharge screen while a colleague completes the discharge
    would write DISCHARGE_PENDING over DISCHARGED after the bed had already
    been released — an open stay on a bed the board shows as free, which is
    precisely what this module promises cannot happen.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    admission = _resolve_admission(db, identifier, branch_ids)

    locked = repo.lock_admission(db, admission.id)
    if locked is None:  # pragma: no cover - resolved a moment ago
        raise NotFoundError("Admission not found.")

    if locked.status is AdmissionStatus.DISCHARGED:
        raise ConflictError("This patient has already been discharged.", code="discharged")

    locked.status = AdmissionStatus.DISCHARGE_PENDING
    admission.patient.status = PatientStatus.DISCHARGE_PENDING

    _audit(
        db,
        user,
        "DISCHARGE_STARTED",
        "admissions",
        admission.id,
        admission.patient.patient_number,
        ip,
    )
    db.commit()
    db.refresh(admission)
    return admission_out(admission)


def set_checklist_item(
    db: Session,
    *,
    item_id: str,
    payload: ChecklistItemUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> AdmissionResponse:
    """Tick or untick one checklist line.

    Who ticked it is the authenticated user; the request cannot say otherwise.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    parsed = _uuid_or_none(item_id)
    item = repo.get_checklist_item(db, parsed) if parsed else None
    if item is None or not _visible(branch_ids, item.admission.patient.branch_id):
        raise NotFoundError("Checklist item not found.")

    # Same lock, same order as `discharge`. The discharge re-reads the checklist
    # under this lock, so taking it here is what stops an item being unticked in
    # the instant between that read and the stay being closed.
    locked = repo.lock_admission(db, item.admission_id)
    if locked is None:  # pragma: no cover - resolved a moment ago
        raise NotFoundError("Checklist item not found.")

    if locked.status is AdmissionStatus.DISCHARGED:
        raise ConflictError(
            "This patient has been discharged; the checklist is closed.", code="discharged"
        )

    item.completed = payload.done
    item.completed_by = user.id if payload.done else None
    item.completed_at = datetime.now(timezone.utc) if payload.done else None

    admission_id = item.admission_id
    _audit(
        db,
        user,
        "DISCHARGE_CHECKLIST_TICKED" if payload.done else "DISCHARGE_CHECKLIST_CLEARED",
        "discharge_checklist_items",
        item.id,
        f"{item.admission.patient.patient_number}: {item.label}",
        ip,
    )
    db.commit()
    return admission_out(_resolve_admission(db, str(admission_id), branch_ids))


def discharge(
    db: Session,
    *,
    identifier: str,
    payload: DischargeRequest,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> AdmissionResponse:
    """Complete a stay and release the bed, atomically.

        BEGIN -> lock admission -> lock bed -> validate the checklist -> mark
        the admission Discharged -> stamp the discharge date -> release the bed
        -> COMMIT

    A failure anywhere rolls all of it back, so a discharged patient never keeps
    occupying a bed and a released bed never belongs to a stay that is still
    open. The two locks are always taken admission-then-bed, so two concurrent
    discharges cannot deadlock against each other.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    admission = _resolve_admission(db, identifier, branch_ids)

    locked_admission = repo.lock_admission(db, admission.id)
    if locked_admission is None:  # pragma: no cover - resolved a moment ago
        raise NotFoundError("Admission not found.")
    locked_bed = repo.lock_bed(db, locked_admission.bed_id)
    if locked_bed is None:  # pragma: no cover - a bed cannot vanish under an FK
        raise NotFoundError("Bed not found.")

    if locked_admission.status is AdmissionStatus.DISCHARGED:
        raise ConflictError("This patient has already been discharged.", code="already_discharged")

    if payload.bedStatus not in POST_DISCHARGE_STATUSES:
        raise UnprocessableError(
            "After a discharge a bed is either Available or Cleaning.", code="invalid_bed_status"
        )

    # Re-read the checklist now the admission is locked, rather than trusting
    # the copy loaded before the lock was taken.
    outstanding = [
        item.label for item in repo.checklist_for(db, locked_admission.id) if not item.completed
    ]
    if outstanding:
        raise UnprocessableError(
            f"{len(outstanding)} discharge checklist item(s) are still outstanding: "
            + "; ".join(outstanding),
            code="checklist_incomplete",
        )

    discharge_date = payload.dischargeDate or _today()
    if discharge_date < locked_admission.admission_date:
        raise UnprocessableError("The discharge date cannot be before the admission date.")

    locked_admission.status = AdmissionStatus.DISCHARGED
    locked_admission.discharge_date = discharge_date

    locked_bed.status = payload.bedStatus
    locked_bed.patient_id = None
    locked_bed.reserved_for = None

    patient = admission.patient
    patient.status = PatientStatus.DISCHARGED

    _audit(
        db,
        user,
        "PATIENT_DISCHARGED",
        "admissions",
        locked_admission.id,
        f"{patient.patient_number} from {locked_bed.bed_number}",
        ip,
    )
    db.commit()

    logger.info(
        "Patient %s discharged from bed %s by %s",
        patient.patient_number,
        locked_bed.bed_number,
        user.id,
    )
    return admission_out(_resolve_admission(db, str(locked_admission.id), branch_ids))


# ---------------------------------------------------------------------------
# Nursing tasks
# ---------------------------------------------------------------------------


def list_tasks(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    patient: str | None = None,
    ward: str | None = None,
    bed: str | None = None,
    done: bool | None = None,
    priority: TaskPriority | None = None,
    task_type: NursingTaskType | None = None,
    mine: bool = False,
) -> list[NursingTaskResponse]:
    branch_ids = visible_branch_ids(db, user, permissions)
    rows = repo.list_tasks(
        db,
        branch_ids=branch_ids,
        patient_id=resolve_patient(db, patient, user, permissions).id if patient else None,
        ward_id=_resolve_ward(db, ward, branch_ids).id if ward else None,
        bed_id=_resolve_bed(db, bed, branch_ids).id if bed else None,
        assigned_to=user.id if mine else None,
        done=done,
        priority=priority,
        task_type=task_type,
    )
    now = datetime.now(timezone.utc)
    return [task_out(row, now) for row in rows]


def set_task_done(
    db: Session,
    *,
    identifier: str,
    done: bool,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> NursingTaskResponse:
    """Complete or reopen a task.

    The completer is the authenticated user. A ``completed_by`` in the request
    body is not read — the frontend must not be able to sign a task off in
    somebody else's name.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    task = _resolve_task(db, identifier, branch_ids)

    task.done = done
    task.completed_by = user.id if done else None
    task.completed_at = datetime.now(timezone.utc) if done else None

    _audit(
        db,
        user,
        "NURSING_TASK_COMPLETED" if done else "NURSING_TASK_REOPENED",
        "nursing_tasks",
        task.id,
        f"{task.patient.patient_number}: {task.type.display}",
        ip,
    )
    db.commit()
    db.refresh(task)
    return task_out(task)


def update_task(
    db: Session,
    *,
    identifier: str,
    payload: NursingTaskUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> NursingTaskResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    task = _resolve_task(db, identifier, branch_ids)

    if payload.label is not None:
        task.label = payload.label.strip()
    if payload.priority is not None:
        task.priority = payload.priority
    if payload.dueLabel is not None:
        task.due_label = payload.dueLabel.strip() or None
    if payload.dueAt is not None:
        task.due_at = payload.dueAt

    if payload.done is not None and payload.done != task.done:
        task.done = payload.done
        task.completed_by = user.id if payload.done else None
        task.completed_at = datetime.now(timezone.utc) if payload.done else None

    _audit(
        db,
        user,
        "NURSING_TASK_UPDATED",
        "nursing_tasks",
        task.id,
        f"{task.patient.patient_number}: {task.type.display}",
        ip,
    )
    db.commit()
    db.refresh(task)
    return task_out(task)


# ---------------------------------------------------------------------------
# The vitals round
# ---------------------------------------------------------------------------


def record_admission_vitals(
    db: Session,
    *,
    identifier: str,
    payload: VitalsCreate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> VitalsOut:
    """Record observations against an inpatient stay.

    Posting through the admission is what stops a nurse recording vitals for an
    arbitrary patient id: the stay has to exist, be in the caller's branch, and
    still be open. The reading itself is written by ``clinical_service`` into
    the single vitals table — nursing does not keep a second copy.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    admission = _resolve_admission(db, identifier, branch_ids)

    if admission.status is AdmissionStatus.DISCHARGED:
        raise UnprocessableError(
            "That patient has been discharged; record observations on their record instead.",
            code="not_admitted",
        )

    return clinical_service.record_vitals(
        db, patient=admission.patient, payload=payload, user=user, ip=ip
    )


def ipd_patients(db: Session, *, user: User, permissions: list[str]) -> list[AdmissionResponse]:
    """The inpatients the ward round covers — every open stay, ordered by bed."""
    branch_ids = visible_branch_ids(db, user, permissions)
    rows, _ = repo.list_admissions(
        db, branch_ids=branch_ids, statuses=list(repo.ACTIVE_STATUSES), limit=200
    )
    return sorted((admission_out(row) for row in rows), key=lambda row: (row.ward, row.bed))


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


def dashboard(db: Session, *, user: User, permissions: list[str]) -> NursingDashboard:
    """Every figure the nurse dashboard shows, counted in PostgreSQL."""
    branch_ids = visible_branch_ids(db, user, permissions)
    now = datetime.now(timezone.utc)
    start, end = _day_bounds(_today())

    beds = repo.list_beds(db, branch_ids=branch_ids)
    wards = [ward_out(ward) for ward in repo.list_wards(db, branch_ids=branch_ids)]

    return NursingDashboard(
        admittedPatients=repo.count_admissions(db, branch_ids, [AdmissionStatus.ADMITTED]),
        dischargePending=repo.count_admissions(db, branch_ids, [AdmissionStatus.DISCHARGE_PENDING]),
        pendingTasks=repo.count_tasks(db, branch_ids, done=False),
        overdueTasks=repo.count_overdue_tasks(db, branch_ids, now),
        completedTasksToday=repo.count_tasks_completed_between(db, branch_ids, start, end),
        vitalsPending=repo.count_tasks_by_type(db, branch_ids, NursingTaskType.VITALS),
        medicationsDue=repo.count_tasks_by_type(db, branch_ids, NursingTaskType.MEDICATION),
        vitalsRecordedToday=repo.count_vitals_between(db, branch_ids, start, end),
        beds=bed_summary(beds),
        wards=[ward for ward in wards if ward.totalBeds > 0],
    )
