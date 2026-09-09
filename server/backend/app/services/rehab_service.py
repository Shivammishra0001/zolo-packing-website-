"""Rehabilitation plan business rules.

Three things hold throughout:

* a therapist sees and changes the plans they are assigned to, and no others;
* everything the UI shows as progress — completed sessions, attendance,
  adherence, trend — is **derived from therapy sessions**, never accepted from a
  request, so no client can assert progress that did not happen;
* nothing here logs clinical content, only record identifiers.
"""

from __future__ import annotations

import logging
import uuid as uuid_lib
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.enums import (
    AuditCategory,
    MilestoneStatus,
    RehabPlanStatus,
    RehabTrend,
    TherapySessionStatus,
    UserRole,
)
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.core.ids import USER
from app.models.audit import AuditLog
from app.models.rehab import RehabMilestone, RehabPlan, RehabProgressPoint
from app.models.user import User
from app.repositories import rehab_repository as repo
from app.schemas.rehab import (
    CaseloadEntry,
    MilestoneCreate,
    MilestoneOut,
    MilestoneUpdate,
    ProgressPointCreate,
    ProgressPointOut,
    ProgressSummary,
    RehabPlanCreate,
    RehabPlanPage,
    RehabPlanResponse,
    RehabPlanUpdate,
    RehabProgressResponse,
    SessionProgressPoint,
)
from app.services.avatars import avatar_colour, initials
from app.services.consultation_service import resolve_patient
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

#: Roles that own a caseload. A therapist's plan list is narrowed to their own;
#: doctors, admins and owners read across the branch they can already see.
CASELOAD_ROLES = {UserRole.THERAPIST}

#: The plan lifecycle. Anything not listed is refused with 409, so no client can
#: drive a plan into an impossible state.
ALLOWED_TRANSITIONS: dict[RehabPlanStatus, set[RehabPlanStatus]] = {
    RehabPlanStatus.ACTIVE: {
        RehabPlanStatus.ON_HOLD,
        RehabPlanStatus.COMPLETED,
        RehabPlanStatus.CANCELLED,
    },
    RehabPlanStatus.ON_HOLD: {RehabPlanStatus.ACTIVE, RehabPlanStatus.CANCELLED},
    # Terminal.
    RehabPlanStatus.COMPLETED: set(),
    RehabPlanStatus.CANCELLED: set(),
}

#: Sessions may only be delivered against a plan in one of these states. A plan
#: on hold or cancelled is not a programme anyone should be logging work to.
SESSIONABLE_STATUSES = {RehabPlanStatus.ACTIVE}


# ---------------------------------------------------------------------------
# Derived values
# ---------------------------------------------------------------------------


def _pct(part: int, whole: int) -> float | None:
    return round(part / whole * 100, 1) if whole else None


def recalculate(db: Session, plan: RehabPlan) -> RehabPlan:
    """Recompute everything the plan shows as progress, from its sessions.

    Called inside the transaction that changed a session, so the stored values
    and the sessions they come from can never drift apart. The plan's own
    columns exist because the frontend reads them directly; they are a cache of
    this calculation and nothing else writes them.
    """
    # The sessionmaker runs with autoflush off, so anything the caller has just
    # changed has to reach the database before it can be counted.
    db.flush()

    completed = repo.count_sessions(db, plan.id, repo.DELIVERED_STATUSES)
    expected = repo.count_sessions(db, plan.id, repo.EXPECTED_STATUSES)

    plan.completed_sessions = min(completed, plan.total_sessions)
    attendance = _pct(completed, expected)
    plan.attendance_rate = Decimal(str(attendance)) if attendance is not None else None

    # Adherence is how well the patient stuck to their programme between
    # sessions — the home exercises. That is exactly what the weekly review
    # records, so it is averaged from those points rather than inferred from
    # session pacing, which is what `attendance` already measures.
    plan.adherence_rate = _adherence(db, plan)
    plan.trend = _trend(db, plan)
    return plan


def _adherence(db: Session, plan: RehabPlan) -> Decimal | None:
    recorded = [p.adherence for p in repo.progress_for_plan(db, plan.id) if p.adherence is not None]
    if not recorded:
        return None
    return Decimal(str(round(sum(recorded) / len(recorded), 1)))


def _trend(db: Session, plan: RehabPlan) -> RehabTrend:
    """The trajectory badge the UI shows.

    Ordered so the most serious signal wins: a finished plan is Completed, a
    plan whose pain is not improving is At Risk or Plateaued regardless of
    session count, and only then does delivery pace decide Ahead / On Track.
    """
    if plan.status is RehabPlanStatus.COMPLETED:
        return RehabTrend.COMPLETED

    points = repo.progress_for_plan(db, plan.id)
    adherence = float(plan.adherence_rate) if plan.adherence_rate is not None else None
    attendance = float(plan.attendance_rate) if plan.attendance_rate is not None else None

    # Poor attendance is the clearest risk signal there is.
    if attendance is not None and attendance < 70:
        return RehabTrend.AT_RISK

    if len(points) >= 3:
        recent = points[-3:]
        pain_change = float(recent[-1].pain or 0) - float(recent[0].pain or 0)
        mobility_change = (recent[-1].mobility or 0) - (recent[0].mobility or 0)

        # Pain rising and mobility falling across three weeks is deterioration.
        if pain_change > 0.5 and mobility_change <= 0:
            return RehabTrend.AT_RISK
        # Barely moving in either direction is a plateau.
        if abs(pain_change) < 0.6 and abs(mobility_change) < 5:
            return RehabTrend.PLATEAUED

    # Delivery pace: how far through the session budget the patient is against
    # how far through the calendar. A fifth ahead of schedule is genuinely
    # ahead; a third behind is a programme that is slipping.
    pace = _delivery_pace(plan)
    if pace is not None:
        if pace >= 120:
            return RehabTrend.AHEAD_OF_PLAN
        if pace < 65:
            return RehabTrend.AT_RISK

    if adherence is not None and adherence < 70:
        return RehabTrend.AT_RISK

    return RehabTrend.ON_TRACK


def _delivery_pace(plan: RehabPlan) -> float | None:
    """Sessions delivered as a percentage of what the calendar expects by now."""
    if not (plan.start_date and plan.end_date and plan.total_sessions):
        return None
    span = (plan.end_date - plan.start_date).days
    if span <= 0:
        return None

    elapsed = max(0, min(span, (date_type.today() - plan.start_date).days))
    if elapsed == 0:
        return None

    expected = plan.total_sessions * (elapsed / span)
    return round(plan.completed_sessions / expected * 100, 1) if expected > 0 else None


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------


def milestone_out(row: RehabMilestone) -> MilestoneOut:
    return MilestoneOut(
        id=str(row.id),
        label=row.title,
        done=row.status is MilestoneStatus.ACHIEVED,
        date=row.target_date,
        description=row.description,
        status=row.status,
        completedAt=row.completed_at,
        sortOrder=row.sort_order,
    )


def progress_point_out(row: RehabProgressPoint) -> ProgressPointOut:
    return ProgressPointOut(
        week=row.week_label or row.week_start.isoformat(),
        pain=float(row.pain) if row.pain is not None else 0.0,
        mobility=row.mobility or 0,
        strength=row.strength or 0,
        adherence=row.adherence or 0,
    )


def to_response(plan: RehabPlan) -> RehabPlanResponse:
    patient = plan.patient
    therapist = plan.therapist

    return RehabPlanResponse(
        id=str(plan.id),
        patientId=patient.patient_number,
        patientUuid=str(patient.id),
        patientName=patient.full_name,
        patientInitials=initials(patient),
        patientAvatarColor=avatar_colour(patient),
        title=plan.name,
        goal=plan.goals,
        startDate=plan.start_date,
        targetEndDate=plan.end_date,
        totalSessions=plan.total_sessions,
        completedSessions=plan.completed_sessions,
        progressPercentage=plan.progress_percentage,
        frequencyPerWeek=plan.frequency_per_week,
        primaryTherapist=therapist.full_name if therapist else "",
        therapistId=therapist.user_number if therapist else "",
        modalities=list(plan.modalities or []),
        trend=plan.trend,
        attendanceRate=float(plan.attendance_rate) if plan.attendance_rate is not None else None,
        adherenceRate=float(plan.adherence_rate) if plan.adherence_rate is not None else None,
        status=plan.status,
        milestones=[milestone_out(m) for m in plan.milestones],
        createdAt=plan.created_at,
        updatedAt=plan.updated_at,
    )


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


def _own_caseload_only(user: User) -> bool:
    """Whether this user's plan list is narrowed to their own assignments.

    A therapist works a caseload. Doctors, admins and owners hold
    `rehab.plan.view` across the branch they can already see, which is what the
    Rehab Plans screen shows them.
    """
    return user.role in CASELOAD_ROLES


def assert_can_read(plan: RehabPlan, user: User) -> None:
    if _own_caseload_only(user) and plan.therapist_id != user.id:
        # 404 rather than 403 — a 403 confirms the plan exists, which would let
        # someone map another therapist's caseload by trying plan ids.
        raise NotFoundError("Rehabilitation plan not found.")


def assert_can_manage(plan: RehabPlan, user: User) -> None:
    """Who may change a plan: its own therapist, or a doctor prescribing it."""
    if user.role is UserRole.THERAPIST and plan.therapist_id != user.id:
        raise ForbiddenError(
            "You can only change plans you are assigned to.",
            code="not_your_plan",
        )


def get_plan(db: Session, *, plan_id: str, user: User, permissions: list[str]) -> RehabPlan:
    try:
        plan = repo.get_plan(db, uuid_lib.UUID(plan_id))
    except ValueError:
        plan = None

    if plan is None:
        raise NotFoundError("Rehabilitation plan not found.")

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and plan.patient.branch_id not in branch_ids:
        raise NotFoundError("Rehabilitation plan not found.")

    assert_can_read(plan, user)
    return plan


def _resolve_therapist(db: Session, identifier: str) -> User:
    """Find a therapist and confirm the role — an id alone is not trusted."""
    from sqlalchemy import select

    user: User | None = None
    if USER.matches(identifier):
        user = db.execute(select(User).where(User.user_number == identifier.upper())).scalar_one_or_none()
    else:
        try:
            user = db.execute(select(User).where(User.id == uuid_lib.UUID(identifier))).scalar_one_or_none()
        except ValueError:
            user = None

    if user is None:
        raise UnprocessableError(f"No therapist found for {identifier!r}.")
    if user.role is not UserRole.THERAPIST:
        raise UnprocessableError(f"{user.full_name} is not a therapist.")
    return user


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def list_plans(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int,
    limit: int,
    scope: str = "auto",
    patient: str | None = None,
    status: RehabPlanStatus | None = None,
    trend: RehabTrend | None = None,
) -> RehabPlanPage:
    """Plans the caller may read.

    A therapist gets their own caseload; everyone else with `rehab.plan.view`
    gets the branch. `scope=all` is refused for a therapist rather than
    silently narrowed, so the caller is never misled about what they received.
    """
    therapist_id = None
    if _own_caseload_only(user):
        if scope == "all":
            raise ForbiddenError(
                "You do not have permission to read other therapists' plans.",
                code="insufficient_permission",
            )
        therapist_id = user.id

    patient_id = resolve_patient(db, patient, user, permissions).id if patient else None

    rows, total = repo.list_plans(
        db,
        branch_ids=visible_branch_ids(db, user, permissions),
        patient_id=patient_id,
        therapist_id=therapist_id,
        status=status,
        trend=trend.value if trend else None,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return RehabPlanPage(
        items=[to_response(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def plans_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[RehabPlanResponse]:
    return [to_response(row) for row in repo.plans_for_patient(db, patient_id)]


def caseload(db: Session, *, user: User, permissions: list[str]) -> list[CaseloadEntry]:
    """The patients this therapist is responsible for, through active plans.

    Derived from the plans themselves rather than by filtering a patient list —
    a caseload *is* the set of active assignments.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    rows, _ = repo.list_plans(
        db,
        branch_ids=branch_ids,
        therapist_id=user.id if _own_caseload_only(user) else None,
        status=RehabPlanStatus.ACTIVE,
        limit=200,
    )

    entries: list[CaseloadEntry] = []
    for plan in rows:
        patient = plan.patient
        upcoming = [
            s
            for s in repo.sessions_for_plan(db, plan.id)
            if s.status is TherapySessionStatus.SCHEDULED
        ]
        entries.append(
            CaseloadEntry(
                patientId=patient.patient_number,
                patientUuid=str(patient.id),
                patientName=patient.full_name,
                initials=initials(patient),
                avatarColor=avatar_colour(patient),
                age=_age(patient.date_of_birth),
                primaryCondition=patient.primary_condition,
                planId=str(plan.id),
                planTitle=plan.name,
                totalSessions=plan.total_sessions,
                completedSessions=plan.completed_sessions,
                progressPercentage=plan.progress_percentage,
                trend=plan.trend,
                attendanceRate=float(plan.attendance_rate) if plan.attendance_rate is not None else None,
                adherenceRate=float(plan.adherence_rate) if plan.adherence_rate is not None else None,
                nextSessionDate=min((s.session_date for s in upcoming), default=None),
            )
        )
    return entries


def _age(dob: date_type | None) -> int | None:
    if dob is None:
        return None
    today = date_type.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------


def _audit(db: Session, user: User, action: str, plan: RehabPlan, ip: str | None) -> None:
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=AuditCategory.PATIENT,
            target_type="rehab_plans",
            target_id=plan.id,
            # Identifiers only — the goals and notes are clinical content.
            summary=f"Rehab plan for {plan.patient.patient_number}",
            ip_address=ip,
        )
    )


def create_plan(
    db: Session, *, payload: RehabPlanCreate, user: User, permissions: list[str], ip: str | None
) -> RehabPlan:
    """Create a plan, with its milestones, in one transaction."""
    patient = resolve_patient(db, payload.patientId, user, permissions)
    therapist = _resolve_therapist(db, payload.therapistId)

    # A therapist creates plans for their own caseload, not somebody else's.
    if user.role is UserRole.THERAPIST and therapist.id != user.id:
        raise ForbiddenError(
            "You can only create plans assigned to yourself.",
            code="not_your_plan",
        )

    plan = RehabPlan(
        patient_id=patient.id,
        therapist_id=therapist.id,
        name=payload.title,
        goals=payload.goal,
        start_date=payload.startDate,
        end_date=payload.targetEndDate,
        total_sessions=payload.totalSessions,
        frequency_per_week=payload.frequencyPerWeek,
        modalities=list(payload.modalities),
        status=RehabPlanStatus.ACTIVE,
        completed_sessions=0,
        trend=RehabTrend.ON_TRACK,
    )
    db.add(plan)
    db.flush()

    for order, milestone in enumerate(payload.milestones):
        db.add(
            RehabMilestone(
                rehab_plan_id=plan.id,
                title=milestone.label,
                description=milestone.description,
                target_date=milestone.date,
                status=MilestoneStatus.PENDING,
                sort_order=milestone.sortOrder if milestone.sortOrder is not None else order,
            )
        )

    recalculate(db, plan)
    _audit(db, user, "REHAB_PLAN_CREATED", plan, ip)
    db.commit()
    db.refresh(plan)

    logger.info("Rehab plan %s created by %s", plan.id, user.id)
    return plan


def update_plan(
    db: Session, *, plan: RehabPlan, payload: RehabPlanUpdate, user: User, ip: str | None
) -> RehabPlan:
    assert_can_manage(plan, user)

    if plan.status in (RehabPlanStatus.COMPLETED, RehabPlanStatus.CANCELLED):
        raise ConflictError(
            f"This plan is {plan.status.display.lower()} and can no longer be changed.",
            code="plan_closed",
        )

    data = payload.model_dump(exclude_unset=True)

    if "therapistId" in data and data["therapistId"]:
        therapist = _resolve_therapist(db, data["therapistId"])
        plan.therapist_id = therapist.id

    new_start = data.get("startDate", plan.start_date)
    new_end = data.get("targetEndDate", plan.end_date)

    # A plan that is already under way keeps its start date: moving it would
    # silently rewrite the adherence baseline that sessions were measured against.
    if "startDate" in data and plan.start_date and plan.start_date <= date_type.today():
        if data["startDate"] != plan.start_date:
            delivered = repo.count_sessions(db, plan.id, repo.EXPECTED_STATUSES)
            if delivered:
                raise ConflictError(
                    "This plan has already started and has sessions recorded, "
                    "so its start date cannot be moved.",
                    code="plan_already_started",
                )

    if new_start and new_end and new_end < new_start:
        raise UnprocessableError("The target end date cannot be before the start date.")

    if "totalSessions" in data and data["totalSessions"] is not None:
        if data["totalSessions"] < plan.completed_sessions:
            raise UnprocessableError(
                f"This plan already has {plan.completed_sessions} completed sessions, "
                f"so the total cannot be reduced to {data['totalSessions']}."
            )
        plan.total_sessions = data["totalSessions"]

    plan.start_date = new_start
    plan.end_date = new_end
    for wire, column in (
        ("title", "name"),
        ("goal", "goals"),
        ("frequencyPerWeek", "frequency_per_week"),
    ):
        if wire in data:
            setattr(plan, column, data[wire])
    if "modalities" in data and data["modalities"] is not None:
        plan.modalities = list(data["modalities"])

    recalculate(db, plan)
    db.add(plan)
    _audit(db, user, "REHAB_PLAN_UPDATED", plan, ip)
    db.commit()
    db.refresh(plan)

    logger.info("Rehab plan %s updated by %s", plan.id, user.id)
    return plan


def transition(
    db: Session, *, plan: RehabPlan, target: RehabPlanStatus, user: User, ip: str | None
) -> RehabPlan:
    """Move a plan through its lifecycle.

    Completion is deliberately an explicit act: reaching the session budget does
    not finish a programme, a clinician deciding it is finished does.
    """
    assert_can_manage(plan, user)

    if target not in ALLOWED_TRANSITIONS.get(plan.status, set()):
        raise ConflictError(
            f"Cannot move a plan from {plan.status.display.lower()} to {target.display.lower()}.",
            code="invalid_transition",
        )

    plan.status = target
    recalculate(db, plan)
    if target is RehabPlanStatus.COMPLETED:
        plan.trend = RehabTrend.COMPLETED

    db.add(plan)
    _audit(db, user, "REHAB_PLAN_UPDATED", plan, ip)
    db.commit()
    db.refresh(plan)

    logger.info("Rehab plan %s -> %s by %s", plan.id, target.value, user.id)
    return plan


# ---------------------------------------------------------------------------
# Milestones
# ---------------------------------------------------------------------------


def list_milestones(db: Session, plan: RehabPlan) -> list[MilestoneOut]:
    return [milestone_out(m) for m in repo.milestones_for_plan(db, plan.id)]


def add_milestone(
    db: Session, *, plan: RehabPlan, payload: MilestoneCreate, user: User, ip: str | None
) -> MilestoneOut:
    assert_can_manage(plan, user)

    row = RehabMilestone(
        rehab_plan_id=plan.id,
        title=payload.label,
        description=payload.description,
        target_date=payload.date,
        status=MilestoneStatus.PENDING,
        sort_order=(
            payload.sortOrder
            if payload.sortOrder is not None
            else repo.next_milestone_order(db, plan.id)
        ),
    )
    db.add(row)
    db.flush()
    _audit(db, user, "REHAB_PLAN_UPDATED", plan, ip)
    db.commit()
    db.refresh(row)

    logger.info("Milestone %s added to plan %s by %s", row.id, plan.id, user.id)
    return milestone_out(row)


def get_milestone(
    db: Session, *, milestone_id: str, user: User, permissions: list[str]
) -> RehabMilestone:
    try:
        row = repo.get_milestone(db, uuid_lib.UUID(milestone_id))
    except ValueError:
        row = None

    if row is None:
        raise NotFoundError("Milestone not found.")

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and row.plan.patient.branch_id not in branch_ids:
        raise NotFoundError("Milestone not found.")

    assert_can_read(row.plan, user)
    return row


def update_milestone(
    db: Session, *, milestone: RehabMilestone, payload: MilestoneUpdate, user: User, ip: str | None
) -> MilestoneOut:
    assert_can_manage(milestone.plan, user)

    data = payload.model_dump(exclude_unset=True)
    if "label" in data and data["label"]:
        milestone.title = data["label"]
    if "description" in data:
        milestone.description = data["description"]
    if "date" in data:
        milestone.target_date = data["date"]
    if "sortOrder" in data and data["sortOrder"] is not None:
        milestone.sort_order = data["sortOrder"]
    if "status" in data and data["status"] is not None:
        if data["status"] is MilestoneStatus.ACHIEVED:
            raise ConflictError(
                "Achieving a milestone is a separate action — "
                "POST /api/rehab/milestones/{id}/complete.",
                code="use_complete_endpoint",
            )
        milestone.status = data["status"]
        milestone.completed_at = None

    db.add(milestone)
    _audit(db, user, "REHAB_PLAN_UPDATED", milestone.plan, ip)
    db.commit()
    db.refresh(milestone)
    return milestone_out(milestone)


def complete_milestone(
    db: Session, *, milestone: RehabMilestone, user: User, ip: str | None
) -> MilestoneOut:
    """Mark a milestone achieved. The timestamp is server-set."""
    assert_can_manage(milestone.plan, user)

    if milestone.status is MilestoneStatus.ACHIEVED:
        raise ConflictError("This milestone is already achieved.", code="already_achieved")

    milestone.status = MilestoneStatus.ACHIEVED
    milestone.completed_at = datetime.now(timezone.utc)

    db.add(milestone)
    db.add(
        AuditLog(
            user_id=user.id,
            action="MILESTONE_COMPLETED",
            category=AuditCategory.PATIENT,
            target_type="rehab_milestones",
            target_id=milestone.id,
            summary=f"Milestone on plan {milestone.rehab_plan_id}",
            ip_address=ip,
        )
    )
    db.commit()
    db.refresh(milestone)

    logger.info("Milestone %s achieved by %s", milestone.id, user.id)
    return milestone_out(milestone)


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------


def _monday(day: date_type) -> date_type:
    return day - timedelta(days=day.weekday())


def build_progress(db: Session, plan: RehabPlan) -> RehabProgressResponse:
    """Chart-ready progress for one plan.

    Two series, deliberately separate: the weekly review the charts plot, and
    the per-session clinical record behind it.
    """
    points = repo.progress_for_plan(db, plan.id)
    sessions = repo.sessions_for_plan(db, plan.id)

    completed = [s for s in sessions if s.status is TherapySessionStatus.COMPLETED]
    missed = [s for s in sessions if s.status is TherapySessionStatus.MISSED]

    return RehabProgressResponse(
        planId=str(plan.id),
        patientId=plan.patient.patient_number,
        progress=[progress_point_out(p) for p in points],
        sessions=[
            SessionProgressPoint(
                sessionId=str(s.id),
                sessionNumber=s.session_number,
                sequence=s.sequence_in_plan or 0,
                date=s.session_date,
                painBefore=float(s.pain_before) if s.pain_before is not None else None,
                painAfter=float(s.pain_after) if s.pain_after is not None else None,
                mobility=s.mobility_score,
                strength=s.strength_score,
                attendance=s.attendance_status.display if s.attendance_status else None,
            )
            for s in completed
        ],
        summary=ProgressSummary(
            completedSessions=len(completed),
            totalSessions=plan.total_sessions,
            completionPercentage=round(
                len(completed) / plan.total_sessions * 100, 2
            )
            if plan.total_sessions
            else 0.0,
            attendedSessions=len(completed),
            missedSessions=len(missed),
            attendanceRate=float(plan.attendance_rate) if plan.attendance_rate is not None else None,
            adherenceRate=float(plan.adherence_rate) if plan.adherence_rate is not None else None,
            trend=plan.trend,
        ),
    )


def progress_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[ProgressPointOut]:
    """Every progress point for a patient — what Patient 360 plots."""
    return [progress_point_out(p) for p in repo.progress_for_patient(db, patient_id)]


def record_progress_point(
    db: Session, *, plan: RehabPlan, payload: ProgressPointCreate, user: User, ip: str | None
) -> ProgressPointOut:
    """Record (or replace) one week's review.

    One row per plan per week, enforced by a unique constraint — a second
    submission for the same week updates it rather than creating a duplicate
    the chart would plot twice.
    """
    assert_can_manage(plan, user)

    week_start = _monday(payload.weekStart or date_type.today())
    existing = repo.progress_point_for_week(db, plan.id, week_start)

    label = payload.week
    if label is None:
        if plan.start_date:
            weeks = max(0, (week_start - _monday(plan.start_date)).days // 7)
            label = f"Wk {weeks + 1}"
        else:
            label = week_start.isoformat()

    row = existing or RehabProgressPoint(
        patient_id=plan.patient_id, rehab_plan_id=plan.id, week_start=week_start
    )
    row.week_label = label
    row.pain = Decimal(str(payload.pain))
    row.mobility = payload.mobility
    row.strength = payload.strength
    row.adherence = payload.adherence

    db.add(row)
    db.flush()
    # A new point can change the trajectory, so the badge is recomputed here.
    recalculate(db, plan)
    db.add(plan)
    db.commit()
    db.refresh(row)

    logger.info("Progress point recorded on plan %s by %s", plan.id, user.id)
    return progress_point_out(row)
