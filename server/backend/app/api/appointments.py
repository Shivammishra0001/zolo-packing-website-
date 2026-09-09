"""Appointment endpoints.

There is no DELETE. Appointments are clinical history: they are cancelled or
marked no-show, never erased. Status moves only through the workflow endpoints
below, each of which runs the transition through the backend state machine — a
client cannot PUT itself into a state the workflow does not allow.
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
from app.core.enums import AppointmentStatus, AppointmentType
from app.models.user import User
from app.schemas.appointment import (
    AppointmentCreate,
    AppointmentPage,
    AppointmentResponse,
    AppointmentUpdate,
    CancelRequest,
)
from app.services import appointment_service as service

router = APIRouter(tags=["Appointments"])

_NOT_FOUND = {
    "description": "No such appointment, or its patient belongs to another branch",
    "content": {
        "application/json": {"example": {"detail": "Appointment not found.", "code": "not_found"}}
    },
}
_CONFLICT = {
    "description": "Slot already taken, or the status transition is not allowed",
    "content": {
        "application/json": {
            "example": {
                "detail": "Cannot move an appointment from scheduled to completed.",
                "code": "invalid_transition",
            }
        }
    },
}
_FORBIDDEN = {
    "description": "The caller lacks the required permission",
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
    response_model=AppointmentPage,
    summary="List appointments",
    description=(
        "Filtered and paginated in PostgreSQL. Never returns every appointment "
        "to every authenticated user:\n\n"
        "* results are limited to branches the caller can see;\n"
        "* doctors and therapists default to their own diary (`scope=auto`);\n"
        "* `scope=branch` shows the whole clinic diary — what the reception "
        "queue needs — still within the caller's branch.\n\n"
        "The clinician filter is resolved from the authenticated user, never "
        "from a client-supplied id."
    ),
    responses={403: _FORBIDDEN},
)
def list_appointments(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("appointment.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    scope: Annotated[Literal["auto", "mine", "branch"], Query()] = "auto",
    on_date: Annotated[date_type | None, Query(alias="date")] = None,
    date_from: Annotated[date_type | None, Query()] = None,
    date_to: Annotated[date_type | None, Query()] = None,
    patient: Annotated[str | None, Query(max_length=64)] = None,
    appointment_status: Annotated[
        list[AppointmentStatus] | None, Query(alias="status")
    ] = None,
    appointment_type: Annotated[AppointmentType | None, Query(alias="type")] = None,
) -> AppointmentPage:
    return service.list_appointments(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        scope=scope,
        on_date=on_date,
        date_from=date_from,
        date_to=date_to,
        patient=patient,
        statuses=appointment_status,
        appointment_type=appointment_type,
    )


@router.post(
    "",
    response_model=AppointmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Book an appointment",
    description=(
        "The appointment number and the daily queue token are both generated "
        "here, inside one transaction — a rejected booking leaves neither "
        "behind. Overlapping slots are refused with **409**, first by an "
        "application check and ultimately by the database exclusion constraint, "
        "so two simultaneous bookings cannot both succeed."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _CONFLICT},
)
def create_appointment(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: AppointmentCreate,
    user: Annotated[User, Depends(require_permission("appointment.create"))],
) -> AppointmentResponse:
    appointment = service.create_appointment(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )
    return service.to_response(appointment)


@router.get(
    "/{identifier}",
    response_model=AppointmentResponse,
    summary="Get one appointment",
    description="Accepts either the UUID or the `APT-YYYY-#####` code.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_appointment(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("appointment.view"))],
) -> AppointmentResponse:
    appointment = service.get_appointment(
        db, identifier=identifier, user=user, permissions=permissions
    )
    return service.to_response(appointment)


@router.put(
    "/{identifier}",
    response_model=AppointmentResponse,
    summary="Reschedule or amend an appointment",
    description=(
        "Changes the time, clinician, type or notes. **Status is not accepted "
        "here** — it moves only through the workflow endpoints. Moving an "
        "appointment to another day reissues its token for that day's queue."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _CONFLICT},
)
def update_appointment(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: AppointmentUpdate,
    user: Annotated[User, Depends(require_permission("appointment.create"))],
) -> AppointmentResponse:
    appointment = service.get_appointment(
        db, identifier=identifier, user=user, permissions=permissions
    )
    updated = service.update_appointment(
        db, appointment=appointment, payload=payload, user=user, ip=client_ip(request)
    )
    return service.to_response(updated)


# ---------------------------------------------------------------------------
# Workflow — the only way an appointment changes status
# ---------------------------------------------------------------------------


@router.post(
    "/{identifier}/check-in",
    response_model=AppointmentResponse,
    summary="Check a patient in",
    description=(
        "Scheduled → Waiting. Stamps `checked_in_at` server-side; the elapsed "
        "wait shown on the queue board is derived from that timestamp, never "
        "stored as text."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _CONFLICT},
)
def check_in(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("appointment.checkin"))],
) -> AppointmentResponse:
    appointment = service.get_appointment(
        db, identifier=identifier, user=user, permissions=permissions
    )
    return service.to_response(
        service.check_in(db, appointment=appointment, user=user, ip=client_ip(request))
    )


@router.post(
    "/{identifier}/start",
    response_model=AppointmentResponse,
    summary="Start the consultation",
    description=(
        "Waiting → In Consultation. The clinician the appointment is booked "
        "with, or front-desk staff running the check-in board, may do this — "
        "but one clinician cannot drive another's diary."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _CONFLICT},
)
def start(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("appointment.view"))],
) -> AppointmentResponse:
    appointment = service.get_appointment(
        db, identifier=identifier, user=user, permissions=permissions
    )
    return service.to_response(
        service.start(
            db,
            appointment=appointment,
            user=user,
            permissions=permissions,
            ip=client_ip(request),
        )
    )


@router.post(
    "/{identifier}/complete",
    response_model=AppointmentResponse,
    summary="Complete the consultation",
    description=(
        "In Consultation → Completed. Same rule as starting. Recording the "
        "consultation itself is a later module; this only closes the slot."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _CONFLICT},
)
def complete(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("appointment.view"))],
) -> AppointmentResponse:
    appointment = service.get_appointment(
        db, identifier=identifier, user=user, permissions=permissions
    )
    return service.to_response(
        service.complete(
            db,
            appointment=appointment,
            user=user,
            permissions=permissions,
            ip=client_ip(request),
        )
    )


@router.post(
    "/{identifier}/cancel",
    response_model=AppointmentResponse,
    summary="Cancel an appointment",
    description=(
        "The non-destructive alternative to deletion: the row is kept, the "
        "status becomes Cancelled and the slot is released for rebooking. "
        "An optional reason is appended to the notes."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _CONFLICT},
)
def cancel(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: CancelRequest,
    user: Annotated[User, Depends(require_permission("appointment.create"))],
) -> AppointmentResponse:
    appointment = service.get_appointment(
        db, identifier=identifier, user=user, permissions=permissions
    )
    return service.to_response(
        service.cancel(
            db,
            appointment=appointment,
            user=user,
            reason=payload.reason,
            ip=client_ip(request),
        )
    )


@router.post(
    "/{identifier}/no-show",
    response_model=AppointmentResponse,
    summary="Mark a patient as a no-show",
    description="A front-desk record that the patient never arrived. The slot is released.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _CONFLICT},
)
def no_show(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("appointment.checkin"))],
) -> AppointmentResponse:
    appointment = service.get_appointment(
        db, identifier=identifier, user=user, permissions=permissions
    )
    return service.to_response(
        service.mark_no_show(db, appointment=appointment, user=user, ip=client_ip(request))
    )
