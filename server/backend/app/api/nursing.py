"""Nursing, wards, beds, admissions and discharge.

Four routers, because they are four resources rather than one module: the ward
board is read by reception and the doctors, while the task list and the ward
round belong to the nurses. Splitting them keeps each permission honest instead
of hiding everything behind one broad key.

There is no DELETE. A stay is discharged, a bed is released, a task is reopened
— nothing is erased, because an admission is the record that a patient occupied
a bed on a given date.

Permission keys are the ones the frontend already defines: `beds.view`,
`beds.manage`, `nursing.tasks`, `vitals.record`. No finer-grained set is
invented here.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.dependencies import (
    CurrentPermissions,
    DbSession,
    client_ip,
    require_permission,
)
from app.core.enums import AdmissionStatus, BedStatus, BedType, NursingTaskType, TaskPriority
from app.models.user import User
from app.schemas.clinical import VitalsCreate, VitalsOut
from app.schemas.nursing import (
    AdmissionCreate,
    AdmissionPage,
    AdmissionResponse,
    AdmissionUpdate,
    BedCreate,
    BedResponse,
    BedStatusUpdate,
    BedSummary,
    BedUpdate,
    ChecklistItemUpdate,
    DischargeRequest,
    NursingDashboard,
    NursingTaskResponse,
    NursingTaskUpdate,
    WardCreate,
    WardResponse,
    WardUpdate,
)
from app.services import nursing_service as service

#: The ward round — nurses only.
router = APIRouter(tags=["Nursing"])
#: The bed board — read widely, changed by ward staff.
beds = APIRouter(tags=["Wards & Beds"])
wards = APIRouter(tags=["Wards & Beds"])
admissions = APIRouter(tags=["Admissions"])

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
_NOT_FOUND = {
    "description": "No such ward, bed, admission or task — or it belongs to another branch",
    "content": {
        "application/json": {"example": {"detail": "Bed not found.", "code": "not_found"}}
    },
}
_BED_CONFLICT = {
    "description": "The bed is not free, or the patient is already admitted",
    "content": {
        "application/json": {
            "example": {"detail": "Bed A-102 is occupied.", "code": "bed_unavailable"}
        }
    },
}
_CHECKLIST_INCOMPLETE = {
    "description": "The discharge checklist still has outstanding items",
    "content": {
        "application/json": {
            "example": {
                "detail": (
                    "2 discharge checklist item(s) are still outstanding: "
                    "Follow-up appointment booked; Billing cleared with accounts"
                ),
                "code": "checklist_incomplete",
            }
        }
    },
}


# ---------------------------------------------------------------------------
# Wards
# ---------------------------------------------------------------------------


@wards.get(
    "",
    response_model=list[WardResponse],
    summary="Wards and their occupancy",
    description=(
        "Every ward the caller's branch scope allows, with bed counts derived "
        "from the beds themselves — no occupancy figure is stored."
    ),
    responses={403: _FORBIDDEN},
)
def list_wards(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("beds.view"))],
) -> list[WardResponse]:
    return service.list_wards(db, user=user, permissions=permissions)


@wards.post(
    "",
    response_model=WardResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a ward",
    description="Defaults to the caller's own branch when `branchId` is omitted.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def create_ward(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: WardCreate,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> WardResponse:
    return service.create_ward(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )


@wards.patch(
    "/{identifier}",
    response_model=WardResponse,
    summary="Rename a ward",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def update_ward(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: WardUpdate,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> WardResponse:
    return service.update_ward(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


# ---------------------------------------------------------------------------
# Beds
# ---------------------------------------------------------------------------


@beds.get(
    "",
    response_model=list[BedResponse],
    summary="The bed board",
    description=(
        "Every bed, flattened into the shape the board renders. The occupant is "
        "read from the active admission, so a bed always names whoever the "
        "admissions table says is in it."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def list_beds(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("beds.view"))],
    ward: Annotated[str | None, Query(description="Ward UUID")] = None,
    status_filter: Annotated[BedStatus | None, Query(alias="status")] = None,
    type_filter: Annotated[BedType | None, Query(alias="type")] = None,
) -> list[BedResponse]:
    return service.list_beds(
        db,
        user=user,
        permissions=permissions,
        ward=ward,
        status=status_filter,
        bed_type=type_filter,
    )


@beds.get(
    "/summary",
    response_model=BedSummary,
    summary="Occupancy summary",
    description="Counts and the occupancy rate, computed from real beds.",
    responses={403: _FORBIDDEN},
)
def bed_summary(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("beds.view"))],
) -> BedSummary:
    return service.bed_overview(db, user=user, permissions=permissions)


@beds.post(
    "",
    response_model=BedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a bed to a ward",
    description="A new bed is Available — occupancy is only ever a consequence of an admission.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _BED_CONFLICT},
)
def create_bed(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: BedCreate,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> BedResponse:
    return service.create_bed(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )


@beds.patch(
    "/{identifier}",
    response_model=BedResponse,
    summary="Amend a bed",
    description="Number, room, type and daily rate. Status has its own endpoint.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _BED_CONFLICT},
)
def update_bed(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: BedUpdate,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> BedResponse:
    return service.update_bed(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@beds.patch(
    "/{identifier}/status",
    response_model=BedResponse,
    summary="Move a bed through housekeeping",
    description=(
        "Available, Reserved and Cleaning only.\n\n"
        "**Occupied is not settable.** A bed becomes occupied because a patient "
        "was admitted to it and is freed because they were discharged; writing "
        "that state directly would let the board drift away from the admissions "
        "it reports. An occupied bed cannot be moved at all until the patient "
        "leaves."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _BED_CONFLICT},
)
def set_bed_status(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: BedStatusUpdate,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> BedResponse:
    return service.set_bed_status(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


# ---------------------------------------------------------------------------
# Admissions
# ---------------------------------------------------------------------------


@admissions.get(
    "",
    response_model=AdmissionPage,
    summary="Admissions",
    description="Newest first. Pass `active=true` for stays that still hold a bed.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def list_admissions(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("beds.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    patient: Annotated[str | None, Query(description="Patient UUID or PT-##### code")] = None,
    ward: Annotated[str | None, Query(description="Ward UUID")] = None,
    status_filter: Annotated[AdmissionStatus | None, Query(alias="status")] = None,
    active: bool = False,
) -> AdmissionPage:
    return service.list_admissions(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        patient=patient,
        ward=ward,
        status=status_filter,
        active=active,
    )


@admissions.post(
    "",
    response_model=AdmissionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Admit a patient",
    description=(
        "Runs as one transaction with the bed row locked: the bed is checked, "
        "the admission and its discharge checklist are written, and the bed is "
        "marked occupied — or none of it happens.\n\n"
        "Two staff admitting to the same bed serialise on that lock, and the "
        "partial unique indexes on `admissions` refuse a second active stay for "
        "either the bed or the patient. `admittedBy` is always the "
        "authenticated user; it is not read from the request."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _BED_CONFLICT},
)
def admit(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: AdmissionCreate,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> AdmissionResponse:
    return service.admit(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )


@admissions.get(
    "/{identifier}",
    response_model=AdmissionResponse,
    summary="One admission",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_admission(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("beds.view"))],
) -> AdmissionResponse:
    return service.get_admission(db, identifier=identifier, user=user, permissions=permissions)


@admissions.patch(
    "/{identifier}",
    response_model=AdmissionResponse,
    summary="Amend a stay",
    description=(
        "The expected discharge date and the attending doctor. Patient and bed "
        "are fixed at admission, and the status moves only through the discharge "
        "endpoints."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _BED_CONFLICT},
)
def update_admission(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: AdmissionUpdate,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> AdmissionResponse:
    return service.update_admission(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@admissions.post(
    "/{identifier}/discharge-pending",
    response_model=AdmissionResponse,
    summary="Begin a discharge",
    description=(
        "Moves the stay to Discharge Pending — the state the ward's checklist "
        "works in. The bed stays occupied, because the patient is still in it."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _BED_CONFLICT},
)
def start_discharge(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> AdmissionResponse:
    return service.start_discharge(
        db, identifier=identifier, user=user, permissions=permissions, ip=client_ip(request)
    )


@admissions.patch(
    "/checklist/{item_id}",
    response_model=AdmissionResponse,
    summary="Tick a discharge checklist item",
    description=(
        "Returns the whole admission so the screen's progress bar comes from the "
        "server rather than from local state. Who ticked the item is the "
        "authenticated user — the request cannot say otherwise."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def set_checklist_item(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    item_id: str,
    payload: ChecklistItemUpdate,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> AdmissionResponse:
    return service.set_checklist_item(
        db,
        item_id=item_id,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@admissions.post(
    "/{identifier}/discharge",
    response_model=AdmissionResponse,
    summary="Complete a discharge",
    description=(
        "One transaction with the admission and bed rows locked: the checklist "
        "is validated, the stay is closed and the bed is released — or none of "
        "it happens, so a discharged patient never keeps occupying a bed.\n\n"
        "Every checklist item must be ticked. That rule is the frontend's own: "
        "its discharge button is disabled until the checklist reaches 100%."
    ),
    responses={
        403: _FORBIDDEN,
        404: _NOT_FOUND,
        409: _BED_CONFLICT,
        422: _CHECKLIST_INCOMPLETE,
    },
)
def discharge(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: DischargeRequest,
    user: Annotated[User, Depends(require_permission("beds.manage"))],
) -> AdmissionResponse:
    return service.discharge(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


# ---------------------------------------------------------------------------
# The ward round
# ---------------------------------------------------------------------------


@router.get(
    "/dashboard",
    response_model=NursingDashboard,
    summary="Nurse dashboard",
    description="Every figure the nurse dashboard shows, counted in PostgreSQL.",
    responses={403: _FORBIDDEN},
)
def dashboard(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("nursing.tasks"))],
) -> NursingDashboard:
    return service.dashboard(db, user=user, permissions=permissions)


@router.get(
    "/ipd-patients",
    response_model=list[AdmissionResponse],
    summary="Inpatients",
    description=(
        "Every open stay, ordered by ward and bed — the list the ward round and "
        "the vitals round work through."
    ),
    responses={403: _FORBIDDEN},
)
def ipd_patients(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("beds.view"))],
) -> list[AdmissionResponse]:
    return service.ipd_patients(db, user=user, permissions=permissions)


@router.get(
    "/tasks",
    response_model=list[NursingTaskResponse],
    summary="Nursing tasks",
    description=(
        "Outstanding work first, then by due time. `mine=true` narrows to tasks "
        "assigned to the caller — unassigned work stays in the list, because it "
        "is everybody's."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def list_tasks(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("nursing.tasks"))],
    patient: Annotated[str | None, Query(description="Patient UUID or PT-##### code")] = None,
    ward: Annotated[str | None, Query(description="Ward UUID")] = None,
    bed: Annotated[str | None, Query(description="Bed UUID or bed number")] = None,
    done: bool | None = None,
    priority: TaskPriority | None = None,
    type_filter: Annotated[NursingTaskType | None, Query(alias="type")] = None,
    mine: bool = False,
) -> list[NursingTaskResponse]:
    return service.list_tasks(
        db,
        user=user,
        permissions=permissions,
        patient=patient,
        ward=ward,
        bed=bed,
        done=done,
        priority=priority,
        task_type=type_filter,
        mine=mine,
    )


@router.post(
    "/tasks/{identifier}/complete",
    response_model=NursingTaskResponse,
    summary="Complete a task",
    description=(
        "The completer is the authenticated user. A `completed_by` in the "
        "request body is not read — the frontend must not be able to sign work "
        "off in somebody else's name."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def complete_task(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("nursing.tasks"))],
) -> NursingTaskResponse:
    return service.set_task_done(
        db,
        identifier=identifier,
        done=True,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@router.post(
    "/tasks/{identifier}/reopen",
    response_model=NursingTaskResponse,
    summary="Reopen a task",
    description="Undoes a tick made by mistake, and clears who completed it.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def reopen_task(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("nursing.tasks"))],
) -> NursingTaskResponse:
    return service.set_task_done(
        db,
        identifier=identifier,
        done=False,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@router.patch(
    "/tasks/{identifier}",
    response_model=NursingTaskResponse,
    summary="Amend a task",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def update_task(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: NursingTaskUpdate,
    user: Annotated[User, Depends(require_permission("nursing.tasks"))],
) -> NursingTaskResponse:
    return service.update_task(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@router.post(
    "/admissions/{identifier}/vitals",
    response_model=VitalsOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record vitals on the ward round",
    description=(
        "Observations are posted against the **admission**, not a bare patient "
        "id. The stay has to exist, be inside the caller's branch scope and "
        "still be open, so holding `vitals.record` is not on its own a licence "
        "to write vitals for an arbitrary patient.\n\n"
        "The reading itself is written into the one vitals table — nursing does "
        "not keep a second copy."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def record_vitals(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: VitalsCreate,
    user: Annotated[
        User,
        Depends(require_permission("vitals.record", "patient.clinical.edit", require_all=False)),
    ],
) -> VitalsOut:
    return service.record_admission_vitals(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )
