"""Prescription endpoints — writing and reading only.

Dispensing, stock and substitution belong to the pharmacy module and are not
implemented here. Nothing on these routes reads or changes inventory.
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
from app.core.enums import PrescriptionStatus
from app.models.user import User
from app.schemas.prescription import (
    MedicineOption,
    PrescriptionCreate,
    PrescriptionPage,
    PrescriptionResponse,
)
from app.services import prescription_service as service

router = APIRouter(tags=["Prescriptions"])

_NOT_FOUND = {
    "description": "No such prescription, or its patient belongs to another branch",
    "content": {
        "application/json": {"example": {"detail": "Prescription not found.", "code": "not_found"}}
    },
}
_FORBIDDEN = {
    "description": "The caller lacks the required permission",
    "content": {
        "application/json": {
            "example": {"detail": "Only a doctor can write a prescription.", "code": "not_a_prescriber"}
        }
    },
}


@router.get(
    "",
    response_model=PrescriptionPage,
    summary="List prescriptions",
    description=(
        "Scoped to branches the caller can see. A doctor sees what they "
        "prescribed, which is what their Prescriptions screen shows; "
        "`scope=all` gives the whole branch queue, for the pharmacy."
    ),
    responses={403: _FORBIDDEN},
)
def list_prescriptions(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[
        User,
        # A prescription's content is clinical. The pharmacy needs it to
        # dispense and holds no clinical permission, so either key opens the
        # queue — but `patient.view` alone does not, which keeps reception
        # and accounts out of every medicine and dose.
        Depends(require_permission("patient.clinical.view", "prescription.dispense", require_all=False)),
    ],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    scope: Annotated[Literal["auto", "mine", "all"], Query()] = "auto",
    patient: Annotated[str | None, Query(max_length=64)] = None,
    prescription_status: Annotated[PrescriptionStatus | None, Query(alias="status")] = None,
) -> PrescriptionPage:
    return service.list_prescriptions(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        scope=scope,
        patient=patient,
        status=prescription_status,
    )


@router.post(
    "",
    response_model=PrescriptionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Write a prescription",
    description=(
        "The prescriber is the authenticated user; the body has no `doctorId`. "
        "Every medicine is resolved against the catalogue **before** anything "
        "is inserted, and the prescription, its items and the audit entry share "
        "one transaction — an unknown medicine leaves no partial record.\n\n"
        "A new prescription is always `Pending`. Stock is not consulted: an "
        "out-of-stock medicine is still a valid prescription, and substitution "
        "is the pharmacy's decision."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 422: {"description": "Unknown medicine, or an invalid line"}},
)
def create_prescription(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: PrescriptionCreate,
    user: Annotated[User, Depends(require_permission("prescription.create"))],
) -> PrescriptionResponse:
    prescription = service.create_prescription(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )
    return service.to_response(prescription)


@router.get(
    "/medicines",
    response_model=list[MedicineOption],
    summary="Prescribable medicines",
    description=(
        "The catalogue the consultation form's medicine dropdown needs: a name "
        "to prescribe and a stock signal, so the form can keep showing its "
        "existing out-of-stock substitution note.\n\n"
        "Read-only and deliberately thin. Prices, batches and quantities belong "
        "to the pharmacy module and are not exposed here; `status` is derived "
        "from batches on each request and is never stored."
    ),
    responses={403: _FORBIDDEN},
)
def list_medicines(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("prescription.create"))],
) -> list[MedicineOption]:
    return service.list_medicines(db)


@router.get(
    "/{identifier}",
    response_model=PrescriptionResponse,
    summary="Get one prescription",
    description="Accepts either the UUID or the `RX-####` code.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_prescription(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("patient.view"))],
) -> PrescriptionResponse:
    return service.to_response(
        service.get_prescription(db, identifier=identifier, user=user, permissions=permissions)
    )
