"""Rehabilitation plan, milestone and progress endpoints.

There is no DELETE. A plan is cancelled, a milestone is missed — neither is
erased, because both are part of the clinical record.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.dependencies import (
    CurrentPermissions,
    DbSession,
    client_ip,
    require_permission,
)
from app.core.enums import RehabPlanStatus, RehabTrend
from app.models.user import User
from app.schemas.rehab import (
    CaseloadEntry,
    MilestoneCreate,
    MilestoneOut,
    MilestoneUpdate,
    ProgressPointCreate,
    ProgressPointOut,
    RehabPlanCreate,
    RehabPlanPage,
    RehabPlanResponse,
    RehabPlanUpdate,
    RehabProgressResponse,
)
from app.schemas.therapy import TherapySessionResponse
from app.services import rehab_service as service
from app.services import therapy_service

router = APIRouter(tags=["Rehabilitation"])

_NOT_FOUND = {
    "description": "No such plan, or it is another therapist's / another branch's",
    "content": {
        "application/json": {
            "example": {"detail": "Rehabilitation plan not found.", "code": "not_found"}
        }
    },
}
_FORBIDDEN = {
    "description": "The caller lacks the permission, or the plan is not theirs",
    "content": {
        "application/json": {
            "example": {
                "detail": "You can only change plans you are assigned to.",
                "code": "not_your_plan",
            }
        }
    },
}


# ---------------------------------------------------------------------------
# Caseload
# ---------------------------------------------------------------------------


@router.get(
    "/caseload",
    response_model=list[CaseloadEntry],
    summary="The signed-in therapist's caseload",
    description=(
        "The patients this therapist is responsible for, derived from their "
        "**active rehabilitation plans** — not by filtering a patient list in "
        "the browser. Each entry carries the plan that puts the patient there, "
        "its progress and the next scheduled session.\n\n"
        "Roles without a caseload of their own (doctor, admin, owner) get the "
        "active plans across the branch they can already see."
    ),
    responses={403: _FORBIDDEN},
)
def my_caseload(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("rehab.plan.view"))],
) -> list[CaseloadEntry]:
    return service.caseload(db, user=user, permissions=permissions)


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------


@router.get(
    "/plans",
    response_model=RehabPlanPage,
    summary="List rehabilitation plans",
    description=(
        "Filtered and paged in PostgreSQL, scoped twice over: to branches the "
        "caller can see, and — for a therapist — to the plans they are assigned "
        "to. A therapist asking for `scope=all` is refused rather than silently "
        "narrowed, so they are never misled about what they received."
    ),
    responses={403: _FORBIDDEN},
)
def list_plans(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("rehab.plan.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    scope: Annotated[Literal["auto", "mine", "all"], Query()] = "auto",
    patient: Annotated[str | None, Query(max_length=64)] = None,
    plan_status: Annotated[RehabPlanStatus | None, Query(alias="status")] = None,
    trend: Annotated[RehabTrend | None, Query()] = None,
) -> RehabPlanPage:
    return service.list_plans(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        scope=scope,
        patient=patient,
        status=plan_status,
        trend=trend,
    )


@router.post(
    "/plans",
    response_model=RehabPlanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a rehabilitation plan",
    description=(
        "The plan and its milestones are written in one transaction.\n\n"
        "The therapist id is **verified**, not trusted: it must resolve to a "
        "real user holding the therapist role, and a therapist can only create "
        "plans assigned to themselves.\n\n"
        "`completedSessions`, `attendanceRate`, `adherenceRate` and `trend` are "
        "not accepted — all four are derived from therapy sessions, so a client "
        "cannot assert progress that never happened."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 422: {"description": "Unknown patient or therapist, or invalid dates"}},
)
def create_plan(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: RehabPlanCreate,
    user: Annotated[User, Depends(require_permission("rehab.plan.manage"))],
) -> RehabPlanResponse:
    plan = service.create_plan(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )
    return service.to_response(plan)


@router.get(
    "/plans/{plan_id}",
    response_model=RehabPlanResponse,
    summary="Get one rehabilitation plan",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_plan(
    db: DbSession,
    permissions: CurrentPermissions,
    plan_id: str,
    user: Annotated[User, Depends(require_permission("rehab.plan.view"))],
) -> RehabPlanResponse:
    return service.to_response(
        service.get_plan(db, plan_id=plan_id, user=user, permissions=permissions)
    )


@router.put(
    "/plans/{plan_id}",
    response_model=RehabPlanResponse,
    summary="Update a rehabilitation plan",
    description=(
        "The patient is fixed at creation and status moves only through the "
        "workflow endpoints, so neither is accepted here.\n\n"
        "A plan that has already started **and has sessions recorded** keeps its "
        "start date: moving it would silently rewrite the adherence baseline "
        "those sessions were measured against. The session total cannot be cut "
        "below the number already delivered."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Plan closed, or already started"}},
)
def update_plan(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    plan_id: str,
    payload: RehabPlanUpdate,
    user: Annotated[User, Depends(require_permission("rehab.plan.manage"))],
) -> RehabPlanResponse:
    plan = service.get_plan(db, plan_id=plan_id, user=user, permissions=permissions)
    return service.to_response(
        service.update_plan(db, plan=plan, payload=payload, user=user, ip=client_ip(request))
    )


# ---------------------------------------------------------------------------
# Plan lifecycle
# ---------------------------------------------------------------------------

_LIFECYCLE = {
    "complete": (
        RehabPlanStatus.COMPLETED,
        "Finish a plan",
        "Completion is an explicit clinical decision. Reaching the session "
        "budget does **not** finish a programme on its own — a therapist "
        "deciding it is finished does.",
    ),
    "hold": (
        RehabPlanStatus.ON_HOLD,
        "Put a plan on hold",
        "Pauses the programme. Sessions cannot be recorded or completed "
        "against a plan on hold.",
    ),
    "resume": (
        RehabPlanStatus.ACTIVE,
        "Resume a plan",
        "Returns a plan on hold to active, so sessions can be delivered again.",
    ),
    "cancel": (
        RehabPlanStatus.CANCELLED,
        "Cancel a plan",
        "The non-destructive alternative to deletion: the plan and every "
        "session it holds stay as history.",
    ),
}


def _lifecycle_route(verb: str) -> None:
    target, summary, description = _LIFECYCLE[verb]

    @router.post(
        f"/plans/{{plan_id}}/{verb}",
        response_model=RehabPlanResponse,
        summary=summary,
        description=description,
        responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Not a valid transition"}},
        name=f"plan_{verb}",
    )
    def _route(
        request: Request,
        db: DbSession,
        permissions: CurrentPermissions,
        plan_id: str,
        user: Annotated[User, Depends(require_permission("rehab.plan.manage"))],
    ) -> RehabPlanResponse:
        plan = service.get_plan(db, plan_id=plan_id, user=user, permissions=permissions)
        return service.to_response(
            service.transition(db, plan=plan, target=target, user=user, ip=client_ip(request))
        )


for _verb in _LIFECYCLE:
    _lifecycle_route(_verb)


# ---------------------------------------------------------------------------
# Milestones
# ---------------------------------------------------------------------------


@router.get(
    "/plans/{plan_id}/milestones",
    response_model=list[MilestoneOut],
    summary="Plan milestones",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def list_milestones(
    db: DbSession,
    permissions: CurrentPermissions,
    plan_id: str,
    user: Annotated[User, Depends(require_permission("rehab.plan.view"))],
) -> list[MilestoneOut]:
    plan = service.get_plan(db, plan_id=plan_id, user=user, permissions=permissions)
    return service.list_milestones(db, plan)


@router.post(
    "/plans/{plan_id}/milestones",
    response_model=MilestoneOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a milestone",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def add_milestone(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    plan_id: str,
    payload: MilestoneCreate,
    user: Annotated[User, Depends(require_permission("rehab.plan.manage"))],
) -> MilestoneOut:
    plan = service.get_plan(db, plan_id=plan_id, user=user, permissions=permissions)
    return service.add_milestone(db, plan=plan, payload=payload, user=user, ip=client_ip(request))


@router.put(
    "/milestones/{milestone_id}",
    response_model=MilestoneOut,
    summary="Amend a milestone",
    description=(
        "Achieving a milestone is a separate action — sending `status: Achieved` "
        "here is refused, so the completion timestamp is always server-set."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Use the complete endpoint"}},
)
def update_milestone(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    milestone_id: str,
    payload: MilestoneUpdate,
    user: Annotated[User, Depends(require_permission("rehab.plan.manage"))],
) -> MilestoneOut:
    milestone = service.get_milestone(
        db, milestone_id=milestone_id, user=user, permissions=permissions
    )
    return service.update_milestone(
        db, milestone=milestone, payload=payload, user=user, ip=client_ip(request)
    )


@router.post(
    "/milestones/{milestone_id}/complete",
    response_model=MilestoneOut,
    summary="Achieve a milestone",
    description=(
        "Sets `status` to Achieved and stamps `completedAt` server-side. Only "
        "the therapist the plan is assigned to (or a doctor managing it) can "
        "do this."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Already achieved"}},
)
def complete_milestone(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    milestone_id: str,
    user: Annotated[User, Depends(require_permission("rehab.plan.manage"))],
) -> MilestoneOut:
    milestone = service.get_milestone(
        db, milestone_id=milestone_id, user=user, permissions=permissions
    )
    return service.complete_milestone(db, milestone=milestone, user=user, ip=client_ip(request))


# ---------------------------------------------------------------------------
# Progress and sessions
# ---------------------------------------------------------------------------


@router.get(
    "/plans/{plan_id}/progress",
    response_model=RehabProgressResponse,
    summary="Plan progress",
    description=(
        "Chart-ready. Two series, deliberately not merged:\n\n"
        "* `progress` — the weekly review the charts plot, in the frontend's "
        "own `{week, pain, mobility, strength, adherence}` shape;\n"
        "* `sessions` — the per-session clinical record behind it.\n\n"
        "`summary` counts completed sessions from the sessions themselves, "
        "never from a stored figure a client could have set."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def plan_progress(
    db: DbSession,
    permissions: CurrentPermissions,
    plan_id: str,
    user: Annotated[User, Depends(require_permission("therapy.progress.view"))],
) -> RehabProgressResponse:
    plan = service.get_plan(db, plan_id=plan_id, user=user, permissions=permissions)
    return service.build_progress(db, plan)


@router.post(
    "/plans/{plan_id}/progress",
    response_model=ProgressPointOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record a weekly progress point",
    description=(
        "One row per plan per week, enforced by a unique constraint — a second "
        "submission for the same week updates it rather than creating a "
        "duplicate the chart would plot twice. Recording a point recalculates "
        "the plan's trend."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def record_progress(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    plan_id: str,
    payload: ProgressPointCreate,
    user: Annotated[User, Depends(require_permission("rehab.plan.manage"))],
) -> ProgressPointOut:
    plan = service.get_plan(db, plan_id=plan_id, user=user, permissions=permissions)
    return service.record_progress_point(
        db, plan=plan, payload=payload, user=user, ip=client_ip(request)
    )


@router.get(
    "/plans/{plan_id}/sessions",
    response_model=list[TherapySessionResponse],
    summary="Sessions in a plan",
    description="Every session in the programme, in delivery order.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def plan_sessions(
    db: DbSession,
    permissions: CurrentPermissions,
    plan_id: str,
    user: Annotated[User, Depends(require_permission("rehab.plan.view"))],
) -> list[TherapySessionResponse]:
    plan = service.get_plan(db, plan_id=plan_id, user=user, permissions=permissions)
    return therapy_service.sessions_for_plan(db, plan)
