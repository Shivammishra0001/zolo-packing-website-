"""Consultation endpoints.

Clinical records, so every route is behind `patient.clinical.view` at minimum,
and writing needs `consultation.manage`. There is no DELETE — an encounter is
part of the medical record.
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
from app.models.user import User
from app.schemas.clinical import (
    ConsultationCreate,
    ConsultationPage,
    ConsultationResponse,
    ConsultationUpdate,
)
from app.services import consultation_service as service

router = APIRouter(tags=["Consultations"])

_NOT_FOUND = {
    "description": "No such consultation, or its patient belongs to another branch",
    "content": {
        "application/json": {"example": {"detail": "Consultation not found.", "code": "not_found"}}
    },
}
_FORBIDDEN = {
    "description": "The caller lacks the required permission, or the record is another clinician's",
    "content": {
        "application/json": {
            "example": {
                "detail": "You can only edit consultations you recorded.",
                "code": "not_your_consultation",
            }
        }
    },
}


@router.get(
    "",
    response_model=ConsultationPage,
    summary="List consultations",
    description=(
        "Filtered and paged in PostgreSQL, and scoped twice over: to branches "
        "the caller can see, and — for a doctor — to their own encounters.\n\n"
        "`scope=all` widens to the whole branch and requires "
        "`patient.clinical.edit`, so signing in as any doctor does not hand "
        "over the clinic's entire clinical record."
    ),
    responses={403: _FORBIDDEN},
)
def list_consultations(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("patient.clinical.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    scope: Annotated[Literal["auto", "mine", "all"], Query()] = "auto",
    patient: Annotated[str | None, Query(max_length=64)] = None,
    appointment: Annotated[str | None, Query(max_length=64)] = None,
    on_date: Annotated[date_type | None, Query(alias="date")] = None,
    date_from: Annotated[date_type | None, Query()] = None,
    date_to: Annotated[date_type | None, Query()] = None,
) -> ConsultationPage:
    return service.list_consultations(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        scope=scope,
        patient=patient,
        appointment=appointment,
        on_date=on_date,
        date_from=date_from,
        date_to=date_to,
    )


@router.get(
    "/follow-ups",
    response_model=list[ConsultationResponse],
    summary="Follow-ups now due",
    description=(
        "Consultations whose `followUpDate` has arrived or passed, one per "
        "patient (the most recent encounter). Feeds the doctor dashboard's "
        "pending list — the count is derived, never hardcoded."
    ),
    responses={403: _FORBIDDEN},
)
def follow_ups(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("patient.clinical.view"))],
    through: Annotated[date_type | None, Query(description="Defaults to today")] = None,
) -> list[ConsultationResponse]:
    return service.due_follow_ups(db, user=user, permissions=permissions, through=through)


@router.post(
    "",
    response_model=ConsultationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a consultation",
    description=(
        "The encounter's author is the authenticated user — the request body "
        "has no `doctorId` field, so the browser cannot claim to be another "
        "clinician.\n\n"
        "When an `appointmentId` is supplied it must belong to the same "
        "patient, be booked with the caller, and be checked in or further "
        "along. One consultation per appointment."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Already recorded, or the appointment is not ready"}},
)
def create_consultation(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: ConsultationCreate,
    user: Annotated[User, Depends(require_permission("consultation.manage"))],
) -> ConsultationResponse:
    consultation = service.create_consultation(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )
    return service.to_response(consultation)


@router.get(
    "/{identifier}",
    response_model=ConsultationResponse,
    summary="Get one consultation",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_consultation(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("patient.clinical.view"))],
) -> ConsultationResponse:
    consultation = service.get_consultation(
        db, identifier=identifier, user=user, permissions=permissions
    )
    return service.to_response(consultation)


@router.put(
    "/{identifier}",
    response_model=ConsultationResponse,
    summary="Amend a consultation",
    description=(
        "The doctor who recorded the encounter may amend it. Anyone else needs "
        "`patient.clinical.edit`; without it, one doctor cannot rewrite "
        "another's clinical record. Patient, appointment and author are fixed "
        "at creation."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def update_consultation(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: ConsultationUpdate,
    user: Annotated[User, Depends(require_permission("consultation.manage"))],
) -> ConsultationResponse:
    consultation = service.get_consultation(
        db, identifier=identifier, user=user, permissions=permissions
    )
    updated = service.update_consultation(
        db,
        consultation=consultation,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )
    return service.to_response(updated)
