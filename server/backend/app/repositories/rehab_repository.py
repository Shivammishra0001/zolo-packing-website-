"""Data access for rehabilitation plans, therapy sessions and the exercise library.

Branch scoping runs through the patient, as it does everywhere else — a plan
carries no branch of its own, and the patient's branch decides who may read it.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import date as date_type

from sqlalchemy import Select, func, select, text
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.enums import RehabPlanStatus, TherapySessionStatus, TherapyType
from app.models.patient import Patient
from app.models.rehab import RehabMilestone, RehabPlan, RehabProgressPoint
from app.models.therapy import ExerciseLibrary, TherapySession, TherapySessionExercise

#: Sessions that count as delivered against a plan's budget.
DELIVERED_STATUSES = (TherapySessionStatus.COMPLETED,)

#: Sessions the patient was expected at — the denominator for attendance.
EXPECTED_STATUSES = (TherapySessionStatus.COMPLETED, TherapySessionStatus.MISSED)


def _visible(stmt: Select, model, branch_ids: list[uuid_lib.UUID] | None) -> Select:
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
# Rehab plans
# ---------------------------------------------------------------------------

_PLAN_RELATIONS = (
    joinedload(RehabPlan.patient),
    joinedload(RehabPlan.therapist),
    selectinload(RehabPlan.milestones),
)


def get_plan(db: Session, plan_id: uuid_lib.UUID) -> RehabPlan | None:
    return (
        db.execute(select(RehabPlan).options(*_PLAN_RELATIONS).where(RehabPlan.id == plan_id))
        .unique()
        .scalar_one_or_none()
    )


def list_plans(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    patient_id: uuid_lib.UUID | None = None,
    therapist_id: uuid_lib.UUID | None = None,
    status: RehabPlanStatus | None = None,
    trend: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[RehabPlan], int]:
    stmt = _visible(select(RehabPlan), RehabPlan, branch_ids)

    if patient_id is not None:
        stmt = stmt.where(RehabPlan.patient_id == patient_id)
    if therapist_id is not None:
        stmt = stmt.where(RehabPlan.therapist_id == therapist_id)
    if status is not None:
        stmt = stmt.where(RehabPlan.status == status)
    if trend is not None:
        stmt = stmt.where(RehabPlan.trend == trend)

    return _page(
        db,
        stmt,
        RehabPlan,
        (RehabPlan.created_at.desc(),),
        offset,
        limit,
        _PLAN_RELATIONS,
    )


def plans_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[RehabPlan]:
    rows, _ = list_plans(db, branch_ids=None, patient_id=patient_id, limit=100)
    return rows


def active_plan_for_patient(db: Session, patient_id: uuid_lib.UUID) -> RehabPlan | None:
    """The plan the UI shows on a patient record — the newest active one."""
    return (
        db.execute(
            select(RehabPlan)
            .options(*_PLAN_RELATIONS)
            .where(
                RehabPlan.patient_id == patient_id,
                RehabPlan.status == RehabPlanStatus.ACTIVE,
            )
            .order_by(RehabPlan.created_at.desc())
            .limit(1)
        )
        .unique()
        .scalar_one_or_none()
    )


# ---------------------------------------------------------------------------
# Milestones
# ---------------------------------------------------------------------------


def get_milestone(db: Session, milestone_id: uuid_lib.UUID) -> RehabMilestone | None:
    return (
        db.execute(
            select(RehabMilestone)
            .options(joinedload(RehabMilestone.plan).joinedload(RehabPlan.patient))
            .where(RehabMilestone.id == milestone_id)
        )
        .unique()
        .scalar_one_or_none()
    )


def milestones_for_plan(db: Session, plan_id: uuid_lib.UUID) -> list[RehabMilestone]:
    return list(
        db.execute(
            select(RehabMilestone)
            .where(RehabMilestone.rehab_plan_id == plan_id)
            .order_by(RehabMilestone.sort_order, RehabMilestone.target_date)
        )
        .scalars()
        .all()
    )


def next_milestone_order(db: Session, plan_id: uuid_lib.UUID) -> int:
    current = db.execute(
        select(func.coalesce(func.max(RehabMilestone.sort_order), -1)).where(
            RehabMilestone.rehab_plan_id == plan_id
        )
    ).scalar_one()
    return int(current) + 1


# ---------------------------------------------------------------------------
# Progress points
# ---------------------------------------------------------------------------


def progress_for_plan(db: Session, plan_id: uuid_lib.UUID) -> list[RehabProgressPoint]:
    return list(
        db.execute(
            select(RehabProgressPoint)
            .where(RehabProgressPoint.rehab_plan_id == plan_id)
            .order_by(RehabProgressPoint.week_start)
        )
        .scalars()
        .all()
    )


def progress_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[RehabProgressPoint]:
    """Every point for a patient, oldest first — what the 360 chart plots."""
    return list(
        db.execute(
            select(RehabProgressPoint)
            .where(RehabProgressPoint.patient_id == patient_id)
            .order_by(RehabProgressPoint.week_start)
        )
        .scalars()
        .all()
    )


def progress_point_for_week(
    db: Session, plan_id: uuid_lib.UUID, week_start: date_type
) -> RehabProgressPoint | None:
    return db.execute(
        select(RehabProgressPoint).where(
            RehabProgressPoint.rehab_plan_id == plan_id,
            RehabProgressPoint.week_start == week_start,
        )
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Therapy sessions
# ---------------------------------------------------------------------------

_SESSION_RELATIONS = (
    joinedload(TherapySession.patient),
    joinedload(TherapySession.therapist),
    joinedload(TherapySession.plan),
    selectinload(TherapySession.exercises),
)


def get_session(db: Session, session_id: uuid_lib.UUID) -> TherapySession | None:
    return (
        db.execute(
            select(TherapySession).options(*_SESSION_RELATIONS).where(TherapySession.id == session_id)
        )
        .unique()
        .scalar_one_or_none()
    )


def get_session_by_number(db: Session, number: str) -> TherapySession | None:
    return (
        db.execute(
            select(TherapySession)
            .options(*_SESSION_RELATIONS)
            .where(TherapySession.session_number == number.upper())
        )
        .unique()
        .scalar_one_or_none()
    )


def list_sessions(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    patient_id: uuid_lib.UUID | None = None,
    therapist_id: uuid_lib.UUID | None = None,
    plan_id: uuid_lib.UUID | None = None,
    on_date: date_type | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    statuses: list[TherapySessionStatus] | None = None,
    session_type: TherapyType | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[TherapySession], int]:
    stmt = _visible(select(TherapySession), TherapySession, branch_ids)

    if patient_id is not None:
        stmt = stmt.where(TherapySession.patient_id == patient_id)
    if therapist_id is not None:
        stmt = stmt.where(TherapySession.therapist_id == therapist_id)
    if plan_id is not None:
        stmt = stmt.where(TherapySession.rehab_plan_id == plan_id)
    if on_date is not None:
        stmt = stmt.where(TherapySession.session_date == on_date)
    if date_from is not None:
        stmt = stmt.where(TherapySession.session_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(TherapySession.session_date <= date_to)
    if statuses:
        stmt = stmt.where(TherapySession.status.in_(statuses))
    if session_type is not None:
        stmt = stmt.where(TherapySession.session_type == session_type)

    return _page(
        db,
        stmt,
        TherapySession,
        (TherapySession.session_date.desc(), TherapySession.start_time),
        offset,
        limit,
        _SESSION_RELATIONS,
    )


def sessions_for_plan(db: Session, plan_id: uuid_lib.UUID) -> list[TherapySession]:
    """Every session in a plan, in delivery order."""
    return list(
        db.execute(
            select(TherapySession)
            .options(*_SESSION_RELATIONS)
            .where(TherapySession.rehab_plan_id == plan_id)
            .order_by(TherapySession.sequence_in_plan, TherapySession.session_date)
        )
        .unique()
        .scalars()
        .all()
    )


def sessions_for_patient(db: Session, patient_id: uuid_lib.UUID, limit: int = 200):
    rows, _ = list_sessions(db, branch_ids=None, patient_id=patient_id, limit=limit)
    return rows


def count_sessions(db: Session, plan_id: uuid_lib.UUID, statuses) -> int:
    """How many of a plan's sessions are in one of these states."""
    return db.execute(
        select(func.count(TherapySession.id)).where(
            TherapySession.rehab_plan_id == plan_id,
            TherapySession.status.in_(statuses),
        )
    ).scalar_one()


def next_sequence_in_plan(db: Session, plan_id: uuid_lib.UUID) -> int:
    """Next position in a plan, serialised so two therapists cannot collide.

    MAX + 1 rather than COUNT + 1: a deleted or rolled-back session would make
    COUNT reuse a number the unique index still holds.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"plan-session:{plan_id}"}
    )
    current = db.execute(
        select(func.coalesce(func.max(TherapySession.sequence_in_plan), 0)).where(
            TherapySession.rehab_plan_id == plan_id
        )
    ).scalar_one()
    return int(current) + 1


def next_session_number(db: Session) -> int:
    """Next ``TS-####`` code, under the same advisory-lock discipline."""
    from sqlalchemy import Integer

    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": "code:TS"})
    current = db.execute(
        select(
            func.coalesce(
                func.max(func.cast(func.split_part(TherapySession.session_number, "-", 2), Integer)),
                5500,
            )
        ).where(TherapySession.session_number.like("TS-%"))
    ).scalar_one()
    return int(current) + 1


def clear_session_exercises(db: Session, session: TherapySession) -> None:
    """Clear a session's exercises so the caller can write the new set.

    Done through the relationship rather than a bulk DELETE: `delete-orphan`
    removes the rows *and* leaves the loaded collection consistent. A bulk
    DELETE would empty the table but leave the in-memory collection holding
    instances that no longer exist, which blows up the moment the response is
    serialised from it.
    """
    session.exercises.clear()
    db.flush()


# ---------------------------------------------------------------------------
# Exercise library
# ---------------------------------------------------------------------------


def get_exercise(db: Session, exercise_id: uuid_lib.UUID) -> ExerciseLibrary | None:
    return db.execute(
        select(ExerciseLibrary).where(ExerciseLibrary.id == exercise_id)
    ).scalar_one_or_none()


def find_exercise_by_name(
    db: Session, name: str, category: TherapyType | None = None
) -> ExerciseLibrary | None:
    """Resolve a catalogue name, case-insensitively.

    The session form submits names, so this is the lookup that turns the
    checkbox list into real library rows.
    """
    stmt = select(ExerciseLibrary).where(func.lower(ExerciseLibrary.name) == name.strip().lower())
    if category is not None:
        # Prefer the matching discipline; fall back to the name alone, since a
        # few exercises legitimately appear in more than one protocol.
        scoped = db.execute(stmt.where(ExerciseLibrary.category == category)).scalars().first()
        if scoped is not None:
            return scoped
    return db.execute(stmt).scalars().first()


def list_exercises(
    db: Session,
    *,
    search: str | None = None,
    category: TherapyType | None = None,
    active: bool | None = True,
) -> list[ExerciseLibrary]:
    """The library, filtered in SQL — never loaded whole and filtered in Python."""
    stmt = select(ExerciseLibrary)

    if search:
        term = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            func.lower(ExerciseLibrary.name).like(term)
            | func.lower(func.coalesce(ExerciseLibrary.description, "")).like(term)
        )
    if category is not None:
        stmt = stmt.where(ExerciseLibrary.category == category)
    if active is not None:
        stmt = stmt.where(ExerciseLibrary.is_active.is_(active))

    return list(
        db.execute(stmt.order_by(ExerciseLibrary.category, ExerciseLibrary.name)).scalars().all()
    )
