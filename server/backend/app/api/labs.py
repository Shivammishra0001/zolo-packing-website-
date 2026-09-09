"""Lab result endpoints.

Read plus review. There is no creation route: the frontend has no lab-entry
screen, so exposing one now would be inventing a workflow nobody asked for.
Reports reach the database through the seed until the laboratory's own
integration is built.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.core.dependencies import (
    CurrentPermissions,
    DbSession,
    client_ip,
    require_permission,
)
from app.core.enums import LabFlag
from app.models.user import User
from app.schemas.lab import LabPage, LabResultResponse
from app.services import lab_service as service

router = APIRouter(tags=["Labs"])

_NOT_FOUND = {
    "description": "No such report, or its patient belongs to another branch",
    "content": {
        "application/json": {"example": {"detail": "Lab result not found.", "code": "not_found"}}
    },
}
_FORBIDDEN = {
    "description": "The caller lacks clinical access",
    "content": {
        "application/json": {
            "example": {
                "detail": "You do not have permission to perform this action.",
                "code": "insufficient_permission",
            }
        }
    },
}


@router.get(
    "",
    response_model=LabPage,
    summary="List lab results",
    description=(
        "Released reports, newest first, limited to branches the caller can "
        "see. `reviewed=false` is what the doctor's Labs screen counts as its "
        "review queue; `patient=PT-#####` is what the consultation screen "
        "asks for, so it never pulls the whole list to filter one patient out."
    ),
    responses={403: _FORBIDDEN},
)
def list_labs(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("patient.clinical.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    patient: Annotated[str | None, Query(max_length=64)] = None,
    reviewed: Annotated[bool | None, Query()] = None,
    flag: Annotated[LabFlag | None, Query()] = None,
) -> LabPage:
    return service.list_labs(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        patient=patient,
        reviewed=reviewed,
        flag=flag,
    )


@router.get(
    "/{identifier}",
    response_model=LabResultResponse,
    summary="Get one lab result",
    description="Accepts either the UUID or the `LAB-####` code.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_lab(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("patient.clinical.view"))],
) -> LabResultResponse:
    return service.to_response(
        service.get_lab(db, identifier=identifier, user=user, permissions=permissions)
    )


@router.post(
    "/{identifier}/review",
    response_model=LabResultResponse,
    summary="Sign a report off",
    description=(
        "Sets `reviewed`, `reviewedBy` and `reviewedAt`. None of the three is "
        "accepted from the request — a clinical sign-off has to be attributable "
        "to whoever was actually authenticated.\n\n"
        "Requires `patient.clinical.edit`, so roles that may read a report "
        "(nurse, therapist) cannot sign it."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Already reviewed"}},
)
def review_lab(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("patient.clinical.edit"))],
) -> LabResultResponse:
    lab = service.get_lab(db, identifier=identifier, user=user, permissions=permissions)
    return service.to_response(service.review(db, lab=lab, user=user, ip=client_ip(request)))
