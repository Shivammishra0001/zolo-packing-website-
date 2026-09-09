"""Therapy session and exercise-library endpoints.

There is no DELETE. A session the patient missed is marked missed; a retired
exercise stays on the sessions that used it. Neither is erased.
"""

from __future__ import annotations

from datetime import date as date_type
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.dependencies import (
    CurrentPermissions,
    DbSession,
    client_ip,
    require_permission,
)
from app.core.enums import TherapySessionStatus, TherapyType
from app.models.user import User
from app.schemas.therapy import (
    ExerciseCreate,
    ExerciseOut,
    ExerciseUpdate,
    SessionCompleteRequest,
    TherapySessionCreate,
    TherapySessionPage,
    TherapySessionResponse,
    TherapySessionUpdate,
)
from app.services import therapy_service as service

router = APIRouter()

_NOT_FOUND = {
    "description": "No such session, or it is another therapist's / another branch's",
    "content": {
        "application/json": {
            "example": {"detail": "Therapy session not found.", "code": "not_found"}
        }
    },
}
_FORBIDDEN = {
    "description": "The caller lacks the permission, or the session is not theirs",
    "content": {
        "application/json": {
            "example": {
                "detail": "You can only record sessions against plans you are assigned to.",
                "code": "not_your_plan",
            }
        }
    },
}


# ---------------------------------------------------------------------------
# Exercise library
# ---------------------------------------------------------------------------

exercises = APIRouter(tags=["Exercise Library"])


@exercises.get(
    "",
    response_model=list[ExerciseOut],
    summary="Search the exercise library",
    description=(
        "Filtered **in SQL** — the library is never loaded into the API to be "
        "filtered there. `search` matches the name and description; `category` "
        "is a therapy discipline; `active=false` includes retired exercises, "
        "which is what a historical session needs.\n\n"
        "Open to anyone who runs therapy or reads a plan; writing is not."
    ),
)
def list_exercises(
    db: DbSession,
    user: Annotated[
        User,
        Depends(require_permission("therapy.session.manage", "rehab.plan.view", require_all=False)),
    ],
    search: Annotated[str | None, Query(max_length=120)] = None,
    category: Annotated[TherapyType | None, Query()] = None,
    active: Annotated[bool | None, Query()] = True,
) -> list[ExerciseOut]:
    return service.list_exercises(db, search=search, category=category, active=active)


@exercises.post(
    "",
    response_model=ExerciseOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add an exercise to the library",
    description=(
        "Requires `settings.manage`. The library is shared clinical "
        "configuration, so every therapist reads it but does not edit it — "
        "otherwise the protocol lists drift per person."
    ),
    responses={403: _FORBIDDEN, 409: {"description": "Already in that category"}},
)
def create_exercise(
    request: Request,
    db: DbSession,
    payload: ExerciseCreate,
    user: Annotated[User, Depends(require_permission("settings.manage"))],
) -> ExerciseOut:
    return service.create_exercise(db, payload=payload, user=user, ip=client_ip(request))


@exercises.put(
    "/{exercise_id}",
    response_model=ExerciseOut,
    summary="Update or retire an exercise",
    description=(
        "Setting `isActive: false` retires an exercise: it stays on the "
        "sessions that already used it but disappears from the picker and is "
        "refused on new ones."
    ),
    responses={403: _FORBIDDEN, 404: {"description": "No such exercise"}},
)
def update_exercise(
    request: Request,
    db: DbSession,
    exercise_id: str,
    payload: ExerciseUpdate,
    user: Annotated[User, Depends(require_permission("settings.manage"))],
) -> ExerciseOut:
    return service.update_exercise(
        db, exercise_id=exercise_id, payload=payload, user=user, ip=client_ip(request)
    )


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

sessions = APIRouter(tags=["Therapy"])


@sessions.get(
    "/sessions",
    response_model=TherapySessionPage,
    summary="List therapy sessions",
    description=(
        "A therapist sees their own diary — which is what *My Sessions* shows. "
        "The therapist filter is resolved from the authenticated user, so the "
        "browser cannot ask for somebody else's list."
    ),
    responses={403: _FORBIDDEN},
)
def list_sessions(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("therapy.session.manage"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    scope: Annotated[Literal["auto", "mine", "all"], Query()] = "auto",
    patient: Annotated[str | None, Query(max_length=64)] = None,
    plan: Annotated[str | None, Query(max_length=64)] = None,
    on_date: Annotated[date_type | None, Query(alias="date")] = None,
    date_from: Annotated[date_type | None, Query()] = None,
    date_to: Annotated[date_type | None, Query()] = None,
    session_status: Annotated[list[TherapySessionStatus] | None, Query(alias="status")] = None,
    session_type: Annotated[TherapyType | None, Query(alias="type")] = None,
) -> TherapySessionPage:
    return service.list_sessions(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        scope=scope,
        patient=patient,
        plan_id=plan,
        on_date=on_date,
        date_from=date_from,
        date_to=date_to,
        statuses=session_status,
        session_type=session_type,
    )


@sessions.post(
    "/sessions",
    response_model=TherapySessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Log a therapy session",
    description=(
        "A session belongs to a plan — the therapist's work is a programme, and "
        "the plan's progress is counted from these rows.\n\n"
        "The therapist is the authenticated user (the body has no "
        "`therapistId`), the `TS-####` code and the position in the programme "
        "are both allocated server-side, and every exercise is resolved against "
        "the library **before** anything is inserted. The session, its "
        "exercises and the plan's recalculated progress share one transaction."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "The plan is not active"}, 422: {"description": "Unknown or retired exercise, or a reading out of range"}},
)
def create_session(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: TherapySessionCreate,
    user: Annotated[User, Depends(require_permission("therapy.session.manage"))],
) -> TherapySessionResponse:
    session = service.create_session(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )
    return service.to_response(session)


@sessions.get(
    "/sessions/{identifier}",
    response_model=TherapySessionResponse,
    summary="Get one therapy session",
    description="Accepts either the UUID or the `TS-####` code.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_session(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("therapy.session.manage"))],
) -> TherapySessionResponse:
    return service.to_response(
        service.get_session(db, identifier=identifier, user=user, permissions=permissions)
    )


@sessions.put(
    "/sessions/{identifier}",
    response_model=TherapySessionResponse,
    summary="Amend a therapy session",
    description=(
        "Status moves only through the workflow endpoints, so it is not "
        "accepted here. Supplying `exercises` replaces the session's list "
        "wholesale, in the same transaction."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "The session is closed"}},
)
def update_session(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: TherapySessionUpdate,
    user: Annotated[User, Depends(require_permission("therapy.session.manage"))],
) -> TherapySessionResponse:
    session = service.get_session(db, identifier=identifier, user=user, permissions=permissions)
    return service.to_response(
        service.update_session(db, session=session, payload=payload, user=user, ip=client_ip(request))
    )


@sessions.post(
    "/sessions/{identifier}/start",
    response_model=TherapySessionResponse,
    summary="Start a session",
    description="Scheduled → In Progress.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Not a valid transition"}},
)
def start_session(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("therapy.session.manage"))],
) -> TherapySessionResponse:
    session = service.get_session(db, identifier=identifier, user=user, permissions=permissions)
    return service.to_response(
        service.start_session(db, session=session, user=user, ip=client_ip(request))
    )


@sessions.post(
    "/sessions/{identifier}/complete",
    response_model=TherapySessionResponse,
    summary="Complete a session",
    description=(
        "Signs the session off with its final measurements and **moves the "
        "plan's progress in the same transaction** — the plan's completed count "
        "and trend can never disagree with the sessions they come from.\n\n"
        "A completed session is recorded as attended. A patient who did not "
        "turn up is a no-show, not a completion; use `/no-show` for that."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Not a valid transition, or the plan is not active"}},
)
def complete_session(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: SessionCompleteRequest,
    user: Annotated[User, Depends(require_permission("therapy.session.manage"))],
) -> TherapySessionResponse:
    session = service.get_session(db, identifier=identifier, user=user, permissions=permissions)
    return service.to_response(
        service.complete_session(
            db, session=session, payload=payload, user=user, ip=client_ip(request)
        )
    )


@sessions.post(
    "/sessions/{identifier}/no-show",
    response_model=TherapySessionResponse,
    summary="Mark a session missed",
    description=(
        "The patient did not attend. Counts against the plan's attendance rate "
        "but not against its delivered sessions — which is the distinction that "
        "makes attendance meaningful."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Not a valid transition"}},
)
def no_show(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("therapy.session.manage"))],
) -> TherapySessionResponse:
    session = service.get_session(db, identifier=identifier, user=user, permissions=permissions)
    return service.to_response(
        service.mark_missed(db, session=session, user=user, ip=client_ip(request))
    )


router.include_router(sessions)
