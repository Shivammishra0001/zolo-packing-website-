"""Therapy session and exercise-library business rules.

A session belongs to a plan, is delivered by the authenticated therapist, and
its completion is what moves the plan's progress — all three in one
transaction, so a plan's counters can never disagree with its sessions.
"""

from __future__ import annotations

import logging
import uuid as uuid_lib
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.enums import (
    AttendanceStatus,
    AuditCategory,
    RehabPlanStatus,
    TherapySessionStatus,
    TherapyType,
    UserRole,
)
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.core.ids import THERAPY_SESSION
from app.models.audit import AuditLog
from app.models.rehab import RehabPlan
from app.models.therapy import ExerciseLibrary, TherapySession, TherapySessionExercise
from app.models.user import User
from app.repositories import rehab_repository as repo
from app.schemas.therapy import (
    ExerciseCreate,
    ExerciseOut,
    ExerciseUpdate,
    SessionCompleteRequest,
    SessionExerciseCreate,
    SessionExerciseOut,
    TherapySessionCreate,
    TherapySessionPage,
    TherapySessionResponse,
    TherapySessionUpdate,
)
from app.services import rehab_service
from app.services.avatars import avatar_colour, initials
from app.services.consultation_service import resolve_patient
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

#: Only a therapist delivers a session. The permission matrix agrees —
#: `therapy.session.manage` is granted to the therapist role alone.
DELIVERING_ROLES = {UserRole.THERAPIST}

#: The session workflow. Anything not listed is refused with 409.
ALLOWED_TRANSITIONS: dict[TherapySessionStatus, set[TherapySessionStatus]] = {
    TherapySessionStatus.SCHEDULED: {
        TherapySessionStatus.IN_PROGRESS,
        TherapySessionStatus.COMPLETED,
        TherapySessionStatus.MISSED,
    },
    TherapySessionStatus.IN_PROGRESS: {
        TherapySessionStatus.COMPLETED,
        TherapySessionStatus.MISSED,
    },
    # Terminal.
    TherapySessionStatus.COMPLETED: set(),
    TherapySessionStatus.MISSED: set(),
}


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------


def exercise_out(row: ExerciseLibrary) -> ExerciseOut:
    return ExerciseOut(
        id=str(row.id),
        name=row.name,
        category=row.category,
        description=row.description,
        instructions=row.instructions,
        defaultDuration=row.default_duration,
        isActive=row.is_active,
    )


def to_response(session: TherapySession) -> TherapySessionResponse:
    patient = session.patient
    therapist = session.therapist
    plan = session.plan

    return TherapySessionResponse(
        id=session.session_number,
        uuid=str(session.id),
        patientId=patient.patient_number,
        patientUuid=str(patient.id),
        patientName=patient.full_name,
        patientInitials=initials(patient),
        patientAvatarColor=avatar_colour(patient),
        date=session.session_date,
        time=session.start_time.strftime("%H:%M") if session.start_time else "",
        durationMinutes=session.duration,
        type=session.session_type,
        therapist=therapist.full_name if therapist else "",
        therapistId=therapist.user_number if therapist else "",
        status=session.status,
        exercises=[e.exercise_name for e in session.exercises],
        exerciseDetail=[
            SessionExerciseOut(
                id=str(e.id),
                exerciseId=str(e.exercise_id) if e.exercise_id else None,
                name=e.exercise_name,
                sets=e.sets,
                repetitions=e.repetitions,
                duration=e.duration,
                notes=e.notes,
            )
            for e in session.exercises
        ],
        painBefore=float(session.pain_before) if session.pain_before is not None else None,
        painAfter=float(session.pain_after) if session.pain_after is not None else None,
        mobilityScore=session.mobility_score,
        strengthScore=session.strength_score,
        notes=session.therapist_notes,
        room=session.room or "",
        planId=str(plan.id) if plan else None,
        planTitle=plan.name if plan else None,
        # `progress` holds the tolerance note the session form captures; the
        # model has no dedicated column and inventing one for a single
        # free-text field would not have earned its keep.
        tolerance=session.progress,
        attendance=session.attendance_status,
        nextSessionDate=session.next_session_date,
        sequence=session.sequence_in_plan,
        createdAt=session.created_at,
        updatedAt=session.updated_at,
    )


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


def _own_sessions_only(user: User) -> bool:
    return user.role in DELIVERING_ROLES


def get_session(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> TherapySession:
    session: TherapySession | None = None
    if THERAPY_SESSION.matches(identifier):
        session = repo.get_session_by_number(db, identifier)
    else:
        try:
            session = repo.get_session(db, uuid_lib.UUID(identifier))
        except ValueError:
            session = repo.get_session_by_number(db, identifier)

    if session is None:
        raise NotFoundError("Therapy session not found.")

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and session.patient.branch_id not in branch_ids:
        raise NotFoundError("Therapy session not found.")

    # 404 rather than 403 — another therapist's diary is not enumerable.
    if _own_sessions_only(user) and session.therapist_id != user.id:
        raise NotFoundError("Therapy session not found.")

    return session


def _assert_may_deliver(user: User, plan: RehabPlan) -> None:
    if user.role not in DELIVERING_ROLES:
        raise ForbiddenError(
            "Only a therapist can record a therapy session.",
            code="not_a_therapist",
        )
    if plan.therapist_id != user.id:
        raise ForbiddenError(
            "You can only record sessions against plans you are assigned to.",
            code="not_your_plan",
        )


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def list_sessions(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int,
    limit: int,
    scope: str = "auto",
    patient: str | None = None,
    plan_id: str | None = None,
    on_date=None,
    date_from=None,
    date_to=None,
    statuses: list[TherapySessionStatus] | None = None,
    session_type: TherapyType | None = None,
) -> TherapySessionPage:
    """Sessions the caller may read.

    A therapist sees their own diary — which is what "My Sessions" shows.
    Everyone else with therapy visibility sees the branch.
    """
    therapist_id = None
    if _own_sessions_only(user):
        if scope == "all":
            raise ForbiddenError(
                "You do not have permission to read other therapists' sessions.",
                code="insufficient_permission",
            )
        therapist_id = user.id

    patient_id = resolve_patient(db, patient, user, permissions).id if patient else None

    resolved_plan = None
    if plan_id:
        resolved_plan = rehab_service.get_plan(
            db, plan_id=plan_id, user=user, permissions=permissions
        ).id

    rows, total = repo.list_sessions(
        db,
        branch_ids=visible_branch_ids(db, user, permissions),
        patient_id=patient_id,
        therapist_id=therapist_id,
        plan_id=resolved_plan,
        on_date=on_date,
        date_from=date_from,
        date_to=date_to,
        statuses=statuses,
        session_type=session_type,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return TherapySessionPage(
        items=[to_response(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def sessions_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[TherapySessionResponse]:
    return [to_response(row) for row in repo.sessions_for_patient(db, patient_id)]


def sessions_for_plan(db: Session, plan: RehabPlan) -> list[TherapySessionResponse]:
    return [to_response(row) for row in repo.sessions_for_plan(db, plan.id)]


# ---------------------------------------------------------------------------
# Exercises
# ---------------------------------------------------------------------------


def list_exercises(
    db: Session,
    *,
    search: str | None = None,
    category: TherapyType | None = None,
    active: bool | None = True,
) -> list[ExerciseOut]:
    return [exercise_out(row) for row in repo.list_exercises(db, search=search, category=category, active=active)]


def create_exercise(
    db: Session, *, payload: ExerciseCreate, user: User, ip: str | None
) -> ExerciseOut:
    row = ExerciseLibrary(
        name=payload.name,
        category=payload.category,
        description=payload.description,
        instructions=payload.instructions,
        default_duration=payload.defaultDuration,
        is_active=True,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            f"{payload.name!r} is already in the {payload.category.display} library.",
            code="duplicate_exercise",
        ) from exc

    db.add(
        AuditLog(
            user_id=user.id,
            action="EXERCISE_CREATED",
            category=AuditCategory.SYSTEM,
            target_type="exercise_library",
            target_id=row.id,
            summary=f"{row.category.display}: {row.name}",
            ip_address=ip,
        )
    )
    db.commit()
    db.refresh(row)
    return exercise_out(row)


def update_exercise(
    db: Session, *, exercise_id: str, payload: ExerciseUpdate, user: User, ip: str | None
) -> ExerciseOut:
    try:
        row = repo.get_exercise(db, uuid_lib.UUID(exercise_id))
    except ValueError:
        row = None
    if row is None:
        raise NotFoundError("Exercise not found.")

    data = payload.model_dump(exclude_unset=True)
    for wire, column in (
        ("name", "name"),
        ("category", "category"),
        ("description", "description"),
        ("instructions", "instructions"),
        ("defaultDuration", "default_duration"),
        ("isActive", "is_active"),
    ):
        if wire in data and data[wire] is not None:
            setattr(row, column, data[wire])

    db.add(row)
    db.add(
        AuditLog(
            user_id=user.id,
            action="EXERCISE_UPDATED",
            category=AuditCategory.SYSTEM,
            target_type="exercise_library",
            target_id=row.id,
            summary=f"{row.category.display}: {row.name}",
            ip_address=ip,
        )
    )
    db.commit()
    db.refresh(row)
    return exercise_out(row)


def _resolve_exercises(
    db: Session, lines: list[SessionExerciseCreate], category: TherapyType
) -> list[tuple[SessionExerciseCreate, ExerciseLibrary]]:
    """Resolve every submitted exercise before anything is written.

    A retired exercise stays on the sessions that already used it, but cannot be
    added to a new one — and an id the client invented is refused outright.
    """
    resolved: list[tuple[SessionExerciseCreate, ExerciseLibrary]] = []
    for index, line in enumerate(lines, start=1):
        row: ExerciseLibrary | None = None
        if line.exerciseId:
            try:
                row = repo.get_exercise(db, uuid_lib.UUID(line.exerciseId))
            except ValueError:
                row = None
        elif line.name:
            row = repo.find_exercise_by_name(db, line.name, category)

        if row is None:
            label = line.name or line.exerciseId
            raise UnprocessableError(f"Exercise {index}: {label!r} is not in the exercise library.")
        if not row.is_active:
            raise UnprocessableError(
                f"Exercise {index}: {row.name!r} has been retired and cannot be added to a session."
            )
        resolved.append((line, row))
    return resolved


def _write_exercises(
    db: Session, session: TherapySession, resolved: list[tuple[SessionExerciseCreate, ExerciseLibrary]]
) -> None:
    """Attach the resolved exercises through the relationship.

    Appending rather than db.add() keeps the loaded collection in step, so the
    response serialises the exercises that were just written.
    """
    for line, exercise in resolved:
        session.exercises.append(
            TherapySessionExercise(
                exercise_id=exercise.id,
                exercise_name=exercise.name,
                sets=line.sets,
                repetitions=line.repetitions,
                duration=line.duration if line.duration is not None else exercise.default_duration,
                notes=line.notes,
            )
        )
    db.flush()


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def _audit(db: Session, user: User, action: str, session: TherapySession, ip: str | None) -> None:
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=AuditCategory.PATIENT,
            target_type="therapy_sessions",
            target_id=session.id,
            # Identifiers only — the notes and scores are clinical content.
            summary=f"{session.session_number} for {session.patient.patient_number}",
            ip_address=ip,
        )
    )


def create_session(
    db: Session,
    *,
    payload: TherapySessionCreate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> TherapySession:
    """Log a session against a plan.

    The plan, the therapist and the position in the programme are all resolved
    server-side; the session, its exercises and the plan's recalculated
    progress share one transaction.
    """
    plan = rehab_service.get_plan(db, plan_id=payload.planId, user=user, permissions=permissions)
    _assert_may_deliver(user, plan)

    if plan.status not in rehab_service.SESSIONABLE_STATUSES:
        raise ConflictError(
            f"This plan is {plan.status.display.lower()}, so sessions cannot be recorded against it.",
            code="plan_not_active",
        )

    if plan.start_date and payload.date < plan.start_date:
        raise UnprocessableError("The session date is before the plan starts.")

    session_type = payload.type or _plan_discipline(db, plan)
    resolved = _resolve_exercises(db, payload.exercises, session_type)

    session = TherapySession(
        session_number=THERAPY_SESSION.format(repo.next_session_number(db)),
        sequence_in_plan=repo.next_sequence_in_plan(db, plan.id),
        patient_id=plan.patient_id,
        therapist_id=user.id,
        rehab_plan_id=plan.id,
        session_date=payload.date,
        start_time=payload.time,
        duration=payload.durationMinutes,
        session_type=session_type,
        room=payload.room,
        status=TherapySessionStatus.SCHEDULED,
        pain_before=_dec(payload.painBefore),
        pain_after=_dec(payload.painAfter),
        mobility_score=payload.mobilityScore,
        strength_score=payload.strengthScore,
        therapist_notes=payload.notes,
        progress=payload.tolerance,
        next_session_date=payload.nextSessionDate,
    )
    db.add(session)
    db.flush()

    _write_exercises(db, session, resolved)
    rehab_service.recalculate(db, plan)
    db.add(plan)
    _audit(db, user, "THERAPY_SESSION_CREATED", session, ip)
    db.commit()
    db.refresh(session)

    logger.info("Therapy session %s created by %s", session.session_number, user.id)
    return session


def _plan_discipline(db: Session, plan: RehabPlan) -> TherapyType:
    """The discipline a plan's sessions default to.

    Taken from the plan's existing sessions, then the therapist's department,
    then physiotherapy — the frontend's own default in the session form.
    """
    existing = repo.sessions_for_plan(db, plan.id)
    if existing:
        return existing[-1].session_type

    if plan.therapist and plan.therapist.department:
        name = plan.therapist.department.name
        for member in TherapyType:
            if member.display.lower() == name.lower():
                return member
    return TherapyType.PHYSIOTHERAPY


def _dec(value: float | None) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


def update_session(
    db: Session,
    *,
    session: TherapySession,
    payload: TherapySessionUpdate,
    user: User,
    ip: str | None,
) -> TherapySession:
    """Amend a session. Status moves only through the workflow endpoints."""
    if _own_sessions_only(user) and session.therapist_id != user.id:
        raise ForbiddenError(
            "You can only change sessions you delivered.",
            code="not_your_session",
        )
    if session.status in (TherapySessionStatus.COMPLETED, TherapySessionStatus.MISSED):
        raise ConflictError(
            f"This session is {session.status.display.lower()} and can no longer be changed.",
            code="session_closed",
        )

    data = payload.model_dump(exclude_unset=True)

    if "type" in data and data["type"] is not None:
        session.session_type = data["type"]
    if "exercises" in data and data["exercises"] is not None:
        resolved = _resolve_exercises(db, payload.exercises or [], session.session_type)
        repo.clear_session_exercises(db, session)
        _write_exercises(db, session, resolved)

    for wire, column in (
        ("date", "session_date"),
        ("time", "start_time"),
        ("durationMinutes", "duration"),
        ("room", "room"),
        ("mobilityScore", "mobility_score"),
        ("strengthScore", "strength_score"),
        ("notes", "therapist_notes"),
        ("tolerance", "progress"),
        ("nextSessionDate", "next_session_date"),
    ):
        if wire in data:
            setattr(session, column, data[wire])
    if "painBefore" in data:
        session.pain_before = _dec(data["painBefore"])
    if "painAfter" in data:
        session.pain_after = _dec(data["painAfter"])

    db.add(session)
    _audit(db, user, "THERAPY_SESSION_CREATED", session, ip)
    db.commit()
    db.refresh(session)
    return session


def _transition(
    db: Session,
    *,
    session: TherapySession,
    target: TherapySessionStatus,
    user: User,
    action: str,
    ip: str | None,
) -> TherapySession:
    if _own_sessions_only(user) and session.therapist_id != user.id:
        raise ForbiddenError(
            "You can only change sessions you delivered.",
            code="not_your_session",
        )
    if target not in ALLOWED_TRANSITIONS.get(session.status, set()):
        raise ConflictError(
            f"Cannot move a session from {session.status.display.lower()} "
            f"to {target.display.lower()}.",
            code="invalid_transition",
        )

    session.status = target
    db.add(session)
    # The session must reach the database before the plan is recounted — the
    # sessionmaker runs with autoflush off, so the SELECT inside recalculate()
    # would otherwise still see the old status.
    db.flush()

    # The plan's counters are recalculated in the same transaction as the status
    # change, so they can never disagree with the sessions they come from.
    if session.plan is not None:
        rehab_service.recalculate(db, session.plan)
        db.add(session.plan)

    _audit(db, user, action, session, ip)
    db.commit()
    db.refresh(session)

    logger.info("Therapy session %s -> %s by %s", session.session_number, target.value, user.id)
    return session


def start_session(db: Session, *, session: TherapySession, user: User, ip: str | None):
    return _transition(
        db,
        session=session,
        target=TherapySessionStatus.IN_PROGRESS,
        user=user,
        action="THERAPY_SESSION_CREATED",
        ip=ip,
    )


def complete_session(
    db: Session,
    *,
    session: TherapySession,
    payload: SessionCompleteRequest,
    user: User,
    ip: str | None,
) -> TherapySession:
    """Sign a session off and move the plan's progress with it."""
    if _own_sessions_only(user) and session.therapist_id != user.id:
        raise ForbiddenError(
            "You can only complete sessions you delivered.",
            code="not_your_session",
        )
    if session.plan is not None and session.plan.status not in rehab_service.SESSIONABLE_STATUSES:
        raise ConflictError(
            f"This plan is {session.plan.status.display.lower()}, "
            "so its sessions cannot be completed.",
            code="plan_not_active",
        )

    data = payload.model_dump(exclude_unset=True)
    if "exercises" in data and data["exercises"] is not None:
        resolved = _resolve_exercises(db, payload.exercises or [], session.session_type)
        repo.clear_session_exercises(db, session)
        _write_exercises(db, session, resolved)

    for wire, column in (
        ("durationMinutes", "duration"),
        ("mobilityScore", "mobility_score"),
        ("strengthScore", "strength_score"),
        ("notes", "therapist_notes"),
        ("tolerance", "progress"),
        ("nextSessionDate", "next_session_date"),
    ):
        if wire in data and data[wire] is not None:
            setattr(session, column, data[wire])
    if data.get("painBefore") is not None:
        session.pain_before = _dec(data["painBefore"])
    if data.get("painAfter") is not None:
        session.pain_after = _dec(data["painAfter"])

    # A completed session was attended unless the caller says otherwise; a
    # patient who did not turn up is a no-show, not a completion.
    session.attendance_status = payload.attendance or AttendanceStatus.ATTENDED
    if session.attendance_status is AttendanceStatus.NO_SHOW:
        raise UnprocessableError(
            "A session the patient did not attend is a no-show, not a completion."
        )

    return _transition(
        db,
        session=session,
        target=TherapySessionStatus.COMPLETED,
        user=user,
        action="THERAPY_SESSION_COMPLETED",
        ip=ip,
    )


def mark_missed(db: Session, *, session: TherapySession, user: User, ip: str | None):
    """The patient did not attend. Counts against attendance, not delivery."""
    session.attendance_status = AttendanceStatus.NO_SHOW
    return _transition(
        db,
        session=session,
        target=TherapySessionStatus.MISSED,
        user=user,
        action="THERAPY_SESSION_COMPLETED",
        ip=ip,
    )
