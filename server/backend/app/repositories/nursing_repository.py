"""Data access for wards, beds, admissions and nursing tasks.

Branch scoping runs two ways here. A ward belongs to a branch directly, so beds
and wards scope on that. An admission scopes through its *patient*, as every
other clinical record does.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.enums import AdmissionStatus, BedStatus, BedType, NursingTaskType, TaskPriority
from app.models.patient import Patient
from app.models.ward import Admission, Bed, DischargeChecklistItem, NursingTask, Ward
from app.models.vitals import Vitals

#: Admissions that still occupy a bed.
ACTIVE_STATUSES = (AdmissionStatus.ADMITTED, AdmissionStatus.DISCHARGE_PENDING)


# ---------------------------------------------------------------------------
# Wards
# ---------------------------------------------------------------------------

_WARD_RELATIONS = (joinedload(Ward.branch), selectinload(Ward.beds))


def _ward_visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    if branch_ids is None:
        return stmt
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Ward.branch_id.in_(branch_ids))


def get_ward(db: Session, ward_id: uuid_lib.UUID) -> Ward | None:
    return (
        db.execute(select(Ward).options(*_WARD_RELATIONS).where(Ward.id == ward_id))
        .unique()
        .scalar_one_or_none()
    )


def find_ward(db: Session, branch_id: uuid_lib.UUID, name: str) -> Ward | None:
    return db.execute(
        select(Ward).where(Ward.branch_id == branch_id, func.lower(Ward.name) == name.strip().lower())
    ).scalar_one_or_none()


def list_wards(db: Session, *, branch_ids: list[uuid_lib.UUID] | None) -> list[Ward]:
    stmt = _ward_visible(select(Ward), branch_ids)
    return list(
        db.execute(stmt.options(*_WARD_RELATIONS).order_by(Ward.name)).unique().scalars().all()
    )


# ---------------------------------------------------------------------------
# Beds
# ---------------------------------------------------------------------------

_BED_RELATIONS = (
    joinedload(Bed.ward).joinedload(Ward.branch),
    joinedload(Bed.patient),
)


def _bed_visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    if branch_ids is None:
        return stmt
    stmt = stmt.join(Ward, Bed.ward_id == Ward.id)
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Ward.branch_id.in_(branch_ids))


def get_bed(db: Session, bed_id: uuid_lib.UUID) -> Bed | None:
    return (
        db.execute(select(Bed).options(*_BED_RELATIONS).where(Bed.id == bed_id))
        .unique()
        .scalar_one_or_none()
    )


def find_bed_by_number(
    db: Session, number: str, *, branch_ids: list[uuid_lib.UUID] | None = None
) -> Bed | None:
    """Resolve a human bed label such as ``A-101``, ``a101`` or ``BED-A101``.

    The frontend posts UUIDs, but a bed number is what ward staff say out loud
    and what the acceptance script types, so both are accepted. Separators and
    case are normalised on each side of the comparison.

    Bed numbers are unique per *ward*, not globally: two branches can each have
    an A-101. The caller's scope is therefore applied inside the query rather
    than to whichever row happened to come back first, and an ambiguous label
    resolves to nothing rather than to an arbitrary ward's bed.
    """
    wanted = number.strip().upper().removeprefix("BED-").replace("-", "").replace(" ", "")
    if not wanted:
        return None

    normalised = func.replace(func.upper(Bed.bed_number), "-", "")
    stmt = _bed_visible(select(Bed), branch_ids).where(normalised == wanted)
    rows = db.execute(stmt.options(*_BED_RELATIONS)).unique().scalars().all()
    return rows[0] if len(rows) == 1 else None


def find_bed_in_ward(db: Session, ward_id: uuid_lib.UUID, bed_number: str) -> Bed | None:
    """Enforce the ward+number uniqueness before the database has to."""
    return db.execute(
        select(Bed).where(
            Bed.ward_id == ward_id, func.upper(Bed.bed_number) == bed_number.strip().upper()
        )
    ).scalar_one_or_none()


def list_beds(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    ward_id: uuid_lib.UUID | None = None,
    status: BedStatus | None = None,
    bed_type: BedType | None = None,
) -> list[Bed]:
    stmt = _bed_visible(select(Bed), branch_ids)

    if ward_id is not None:
        stmt = stmt.where(Bed.ward_id == ward_id)
    if status is not None:
        stmt = stmt.where(Bed.status == status)
    if bed_type is not None:
        stmt = stmt.where(Bed.type == bed_type)

    return list(
        db.execute(stmt.options(*_BED_RELATIONS).order_by(Bed.bed_number)).unique().scalars().all()
    )


def lock_bed(db: Session, bed_id: uuid_lib.UUID) -> Bed | None:
    """Read a bed for update.

    ``FOR UPDATE`` holds the row until the transaction commits, so two staff
    admitting to the same bed serialise: the first wins, the second re-reads and
    finds it occupied. The partial unique index on active admissions is the
    backstop underneath.
    """
    return db.execute(
        select(Bed)
        .where(Bed.id == bed_id)
        .with_for_update()
        # Without this the identity map would hand back the copy this session
        # already loaded — the values from *before* the lock was waited on,
        # which is exactly what the lock exists to avoid reading.
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Admissions
# ---------------------------------------------------------------------------

_ADMISSION_RELATIONS = (
    joinedload(Admission.patient),
    joinedload(Admission.bed).joinedload(Bed.ward),
    selectinload(Admission.checklist_items).joinedload(DischargeChecklistItem.completer),
    # Both staff names are rendered on every row, so neither is left to a lazy
    # load that would fire once per admission in a list.
    joinedload(Admission.attending_doctor),
    joinedload(Admission.admitting_staff),
)


def _admission_visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    if branch_ids is None:
        return stmt
    stmt = stmt.join(Patient, Admission.patient_id == Patient.id)
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Patient.branch_id.in_(branch_ids))


def get_admission(db: Session, admission_id: uuid_lib.UUID) -> Admission | None:
    return (
        db.execute(
            select(Admission).options(*_ADMISSION_RELATIONS).where(Admission.id == admission_id)
        )
        .unique()
        .scalar_one_or_none()
    )


def active_admission_for_patient(db: Session, patient_id: uuid_lib.UUID) -> Admission | None:
    return (
        db.execute(
            select(Admission)
            .options(*_ADMISSION_RELATIONS)
            .where(
                Admission.patient_id == patient_id,
                Admission.status.in_(ACTIVE_STATUSES),
            )
        )
        .unique()
        .scalar_one_or_none()
    )


def active_admission_for_bed(db: Session, bed_id: uuid_lib.UUID) -> Admission | None:
    return (
        db.execute(
            select(Admission)
            .options(*_ADMISSION_RELATIONS)
            .where(Admission.bed_id == bed_id, Admission.status.in_(ACTIVE_STATUSES))
        )
        .unique()
        .scalar_one_or_none()
    )


def active_admissions_by_bed(
    db: Session, bed_ids: list[uuid_lib.UUID]
) -> dict[uuid_lib.UUID, Admission]:
    """Active admission per bed, in one query.

    The bed board needs the occupant's name and admission date for every
    occupied bed; without this it would be a query per bed.
    """
    if not bed_ids:
        return {}
    rows = (
        db.execute(
            select(Admission)
            .options(joinedload(Admission.patient))
            .where(Admission.bed_id.in_(bed_ids), Admission.status.in_(ACTIVE_STATUSES))
        )
        .unique()
        .scalars()
        .all()
    )
    return {row.bed_id: row for row in rows}


def lock_admission(db: Session, admission_id: uuid_lib.UUID) -> Admission | None:
    """Serialise two staff discharging the same patient.

    No eager loads: PostgreSQL refuses ``FOR UPDATE`` against the nullable side
    of an outer join, which is what a ``joinedload`` of an optional relationship
    produces.
    """
    return db.execute(
        select(Admission)
        .where(Admission.id == admission_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def list_admissions(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    patient_id: uuid_lib.UUID | None = None,
    ward_id: uuid_lib.UUID | None = None,
    statuses: list[AdmissionStatus] | None = None,
    offset: int = 0,
    limit: int = 100,
) -> tuple[list[Admission], int]:
    stmt = _admission_visible(select(Admission), branch_ids)

    if patient_id is not None:
        stmt = stmt.where(Admission.patient_id == patient_id)
    if ward_id is not None:
        stmt = stmt.join(Bed, Admission.bed_id == Bed.id).where(Bed.ward_id == ward_id)
    if statuses:
        stmt = stmt.where(Admission.status.in_(statuses))

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(Admission.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(
            stmt.options(*_ADMISSION_RELATIONS)
            .order_by(Admission.admission_date.desc())
            .offset(offset)
            .limit(limit)
        )
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


def admissions_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[Admission]:
    rows, _ = list_admissions(db, branch_ids=None, patient_id=patient_id, limit=100)
    return rows


def count_admissions(db: Session, branch_ids: list[uuid_lib.UUID] | None, statuses) -> int:
    stmt = _admission_visible(select(func.count(Admission.id)), branch_ids).where(
        Admission.status.in_(statuses)
    )
    return int(db.execute(stmt).scalar_one())


# ---------------------------------------------------------------------------
# Discharge checklist
# ---------------------------------------------------------------------------


def get_checklist_item(db: Session, item_id: uuid_lib.UUID) -> DischargeChecklistItem | None:
    return (
        db.execute(
            select(DischargeChecklistItem)
            .options(
                joinedload(DischargeChecklistItem.admission)
                .joinedload(Admission.patient)
            )
            .where(DischargeChecklistItem.id == item_id)
        )
        .unique()
        .scalar_one_or_none()
    )


def checklist_for(db: Session, admission_id: uuid_lib.UUID) -> list[DischargeChecklistItem]:
    return list(
        db.execute(
            select(DischargeChecklistItem)
            .where(DischargeChecklistItem.admission_id == admission_id)
            .order_by(DischargeChecklistItem.sort_order)
        )
        .scalars()
        .all()
    )


# ---------------------------------------------------------------------------
# Nursing tasks
# ---------------------------------------------------------------------------

_TASK_RELATIONS = (
    joinedload(NursingTask.patient),
    joinedload(NursingTask.ward),
    joinedload(NursingTask.bed),
    joinedload(NursingTask.assignee),
    joinedload(NursingTask.completer),
)


def _task_visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    if branch_ids is None:
        return stmt
    stmt = stmt.join(Patient, NursingTask.patient_id == Patient.id)
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Patient.branch_id.in_(branch_ids))


def _task_live(stmt: Select) -> Select:
    """Drop work belonging to a stay that has ended.

    A task is not completed by the patient going home, so discharge does not
    tick it — that would put a nurse's name against work nobody did. It simply
    stops being live, which is what every count and list here means by
    outstanding. Ward work with no admission behind it (an outpatient task) is
    unaffected.
    """
    return stmt.outerjoin(Admission, NursingTask.admission_id == Admission.id).where(
        or_(
            NursingTask.admission_id.is_(None),
            Admission.status != AdmissionStatus.DISCHARGED,
        )
    )


def get_task(db: Session, task_id: uuid_lib.UUID) -> NursingTask | None:
    return (
        db.execute(select(NursingTask).options(*_TASK_RELATIONS).where(NursingTask.id == task_id))
        .unique()
        .scalar_one_or_none()
    )


def list_tasks(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    patient_id: uuid_lib.UUID | None = None,
    ward_id: uuid_lib.UUID | None = None,
    bed_id: uuid_lib.UUID | None = None,
    assigned_to: uuid_lib.UUID | None = None,
    done: bool | None = None,
    priority: TaskPriority | None = None,
    task_type: NursingTaskType | None = None,
    limit: int = 200,
) -> list[NursingTask]:
    stmt = _task_live(_task_visible(select(NursingTask), branch_ids))

    if patient_id is not None:
        stmt = stmt.where(NursingTask.patient_id == patient_id)
    if ward_id is not None:
        stmt = stmt.where(NursingTask.ward_id == ward_id)
    if bed_id is not None:
        stmt = stmt.where(NursingTask.bed_id == bed_id)
    if assigned_to is not None:
        # Unassigned work is everyone's, so it stays in the list.
        stmt = stmt.where(
            or_(NursingTask.assigned_to == assigned_to, NursingTask.assigned_to.is_(None))
        )
    if done is not None:
        stmt = stmt.where(NursingTask.done.is_(done))
    if priority is not None:
        stmt = stmt.where(NursingTask.priority == priority)
    if task_type is not None:
        stmt = stmt.where(NursingTask.type == task_type)

    return list(
        db.execute(
            stmt.options(*_TASK_RELATIONS)
            .order_by(NursingTask.done, NursingTask.due_at, NursingTask.created_at)
            .limit(limit)
        )
        .unique()
        .scalars()
        .all()
    )


def count_tasks(db: Session, branch_ids: list[uuid_lib.UUID] | None, *, done: bool) -> int:
    stmt = _task_live(_task_visible(select(func.count(NursingTask.id)), branch_ids)).where(
        NursingTask.done.is_(done)
    )
    return int(db.execute(stmt).scalar_one())


def count_overdue_tasks(
    db: Session, branch_ids: list[uuid_lib.UUID] | None, now: datetime
) -> int:
    """Outstanding tasks whose due time has passed.

    Recurring work ("Hourly", "As needed") carries no ``due_at`` and so is never
    overdue — matching what the ward actually means by the word.
    """
    stmt = _task_live(_task_visible(select(func.count(NursingTask.id)), branch_ids)).where(
        NursingTask.done.is_(False),
        NursingTask.due_at.is_not(None),
        NursingTask.due_at < now,
    )
    return int(db.execute(stmt).scalar_one())


def count_tasks_by_type(
    db: Session, branch_ids: list[uuid_lib.UUID] | None, task_type: NursingTaskType
) -> int:
    """Outstanding tasks of one type — the dashboard's vitals/medication tiles."""
    stmt = _task_live(_task_visible(select(func.count(NursingTask.id)), branch_ids)).where(
        NursingTask.done.is_(False), NursingTask.type == task_type
    )
    return int(db.execute(stmt).scalar_one())


def count_tasks_completed_between(
    db: Session, branch_ids: list[uuid_lib.UUID] | None, start: datetime, end: datetime
) -> int:
    """Tasks completed within a half-open window.

    A window rather than ``date(completed_at)``: the column is ``timestamptz``,
    so a date cast would be evaluated in whatever zone the session happens to
    carry. The caller passes the clinic's day as two UTC instants instead.
    """
    stmt = _task_live(_task_visible(select(func.count(NursingTask.id)), branch_ids)).where(
        NursingTask.done.is_(True),
        NursingTask.completed_at >= start,
        NursingTask.completed_at < end,
    )
    return int(db.execute(stmt).scalar_one())


def count_vitals_between(
    db: Session, branch_ids: list[uuid_lib.UUID] | None, start: datetime, end: datetime
) -> int:
    """How many observations were recorded in the window.

    Read from the vitals table. Vitals live in one place (Step 7); nursing reads
    them and does not keep its own copy.
    """
    stmt = select(func.count(Vitals.id)).where(
        Vitals.recorded_at >= start, Vitals.recorded_at < end
    )
    if branch_ids is not None:
        if not branch_ids:
            return 0
        stmt = stmt.join(Patient, Vitals.patient_id == Patient.id).where(
            Patient.branch_id.in_(branch_ids)
        )
    return int(db.execute(stmt).scalar_one())
