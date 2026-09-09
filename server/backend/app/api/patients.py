"""Patient endpoints.

Thin routers: permission guards and request parsing here, rules in the service,
SQL in the repository. No DELETE — the frontend has no destructive patient
action, so none is exposed.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.dependencies import (
    CurrentPermissions,
    CurrentUser,
    DbSession,
    client_ip,
    require_permission,
)
from app.core.enums import PatientStatus
from app.models.user import User
from app.schemas.billing import InvoiceResponse
from app.schemas.rehab import ProgressPointOut, RehabPlanResponse
from app.schemas.therapy import TherapySessionResponse
from app.schemas.clinical import (
    ConsultationResponse,
    MedicalHistoryCreate,
    MedicalHistoryOut,
    VitalsCreate,
    VitalsOut,
)
from app.schemas.patient import (
    Page,
    Patient360Response,
    PatientCreate,
    PatientResponse,
    PatientSearchResult,
    PatientUpdate,
)
from app.services import billing_service as billing
from app.services import clinical_service as clinical
from app.services import consultation_service as consultations
from app.services import patient_service as service
from app.services import rehab_service as rehab
from app.services import therapy_service as therapy

router = APIRouter(tags=["Patients"])

_NOT_FOUND = {
    "description": "No such patient, or it belongs to another branch",
    "content": {"application/json": {"example": {"detail": "Patient not found.", "code": "not_found"}}},
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
    response_model=Page[PatientResponse],
    summary="List patients",
    description=(
        "Paginated, filtered and sorted **in PostgreSQL** — no rows are loaded "
        "into the API to be filtered there.\n\n"
        "Results are scoped to the caller's branch unless they hold "
        "`branches.manage` or `analytics.business`. `scope=mine` narrows to the "
        "signed-in clinician's own caseload, resolved from the authenticated "
        "user rather than any client-supplied id."
    ),
    responses={403: _FORBIDDEN},
)
def list_patients(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[object, Depends(require_permission("patient.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    search: Annotated[str | None, Query(max_length=120)] = None,
    patient_status: Annotated[PatientStatus | None, Query(alias="status")] = None,
    scope: Annotated[Literal["all", "mine"], Query()] = "all",
    sort: Annotated[Literal["name", "registered", "status", "recent"], Query()] = "name",
) -> Page[PatientResponse]:
    return service.list_patients(
        db,
        user=user,  # type: ignore[arg-type]
        permissions=permissions,
        page=page,
        limit=limit,
        search=search,
        status=patient_status,
        scope=scope,
        sort=sort,
    )


@router.get(
    "/search",
    response_model=list[PatientSearchResult],
    summary="Global patient search",
    description=(
        "Powers the command palette. Matches patient number, first name, last "
        "name, the two combined, phone digits and primary condition, ranked so "
        "exact and prefix matches come first.\n\n"
        "Returns a lightweight record — never the full Patient 360 payload."
    ),
    responses={403: _FORBIDDEN},
)
def search_patients(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[object, Depends(require_permission("patient.view"))],
    q: Annotated[str, Query(min_length=1, max_length=120, description="Search term")],
    limit: Annotated[int, Query(ge=1, le=25)] = 8,
) -> list[PatientSearchResult]:
    return service.search(db, user=user, permissions=permissions, term=q, limit=limit)  # type: ignore[arg-type]


@router.get(
    "/{identifier}",
    response_model=PatientResponse,
    summary="Patient detail",
    description=(
        "Accepts either the UUID or the human-readable code (`PT-10248`), "
        "because the frontend routes on the code.\n\n"
        "A patient outside the caller's branch returns **404**, not 403 — a 403 "
        "would confirm the record exists and allow enumeration by URL."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_patient(
    identifier: str,
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[object, Depends(require_permission("patient.view"))],
) -> PatientResponse:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)  # type: ignore[arg-type]
    return service.to_response(patient)


@router.get(
    "/{identifier}/360",
    response_model=Patient360Response,
    summary="Patient 360",
    description=(
        "Everything the Patient 360 screen shows, in one call.\n\n"
        "**Clinical sections** (`vitals`, `medicalHistory`) require "
        "`patient.clinical.view`. Without it they come back empty and are named "
        "in `restrictedSections`, so the UI can say *why* a tab is empty rather "
        "than implying the patient has no records.\n\n"
        "Sections belonging to modules that are not built yet are listed in "
        "`pendingModules` and return empty — never fabricated data."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_patient_360(
    identifier: str,
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[object, Depends(require_permission("patient.view"))],
) -> Patient360Response:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)  # type: ignore[arg-type]
    return service.build_360(db, patient=patient, permissions=permissions)


@router.post(
    "",
    response_model=PatientResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a patient",
    description=(
        "The patient number (`PT-#####`) is allocated by the database from a "
        "sequence, so two simultaneous registrations can never collide. It is "
        "never accepted from the client.\n\n"
        "A duplicate phone number returns **409**."
    ),
    responses={
        403: _FORBIDDEN,
        409: {
            "description": "Another patient already uses this phone number",
            "content": {
                "application/json": {
                    "example": {
                        "detail": "A patient with this phone number is already registered.",
                        "code": "duplicate_phone",
                    }
                }
            },
        },
    },
)
def create_patient(
    payload: PatientCreate,
    request: Request,
    db: DbSession,
    user: Annotated[object, Depends(require_permission("patient.create"))],
) -> PatientResponse:
    patient = service.create_patient(db, payload=payload, user=user, ip=client_ip(request))  # type: ignore[arg-type]
    return service.to_response(patient)


@router.put(
    "/{identifier}",
    response_model=PatientResponse,
    summary="Update a patient",
    description=(
        "Only the fields the registration and edit forms expose can be changed. "
        "The UUID, patient number and `created_at` are not accepted; "
        "`updated_at` is maintained by the database."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Duplicate phone number"}},
)
def update_patient(
    identifier: str,
    payload: PatientUpdate,
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[object, Depends(require_permission("patient.edit"))],
) -> PatientResponse:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)  # type: ignore[arg-type]
    updated = service.update_patient(
        db, patient=patient, payload=payload, user=user, ip=client_ip(request)  # type: ignore[arg-type]
    )
    return service.to_response(updated)


# ---------------------------------------------------------------------------
# Clinical sub-resources
#
# These hang off the patient because that is how the frontend reads them — one
# patient at a time — and because the patient is what the branch check runs on.
# All of them need `patient.clinical.view` on top of patient access: being able
# to see a name is not permission to read a medical record.
# ---------------------------------------------------------------------------


@router.get(
    "/{identifier}/medical-history",
    response_model=list[MedicalHistoryOut],
    summary="Patient medical history",
    description="Diagnoses, surgeries, injuries and chronic conditions, newest first.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def patient_medical_history(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("patient.clinical.view"))],
) -> list[MedicalHistoryOut]:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return clinical.list_history(db, patient)


@router.post(
    "/{identifier}/medical-history",
    response_model=MedicalHistoryOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a medical history entry",
    description=(
        "The clinician is the authenticated user — the body has no clinician "
        "field. `type` uses the frontend's own vocabulary (Diagnosis, Surgery, "
        "Injury, Allergy, Chronic Condition, Lab Result).\n\n"
        "Requires `patient.clinical.edit`: reading a record does not confer "
        "the right to write to it."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def add_medical_history(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: MedicalHistoryCreate,
    user: Annotated[User, Depends(require_permission("patient.clinical.edit"))],
) -> MedicalHistoryOut:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return clinical.add_history_entry(
        db, patient=patient, payload=payload, user=user, ip=client_ip(request)
    )


@router.get(
    "/{identifier}/vitals",
    response_model=list[VitalsOut],
    summary="Patient vitals",
    description="Observation history, newest first — the order the UI displays.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def patient_vitals(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("patient.clinical.view"))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[VitalsOut]:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return clinical.list_vitals(db, patient, limit=limit)


@router.get(
    "/{identifier}/vitals/latest",
    response_model=VitalsOut | None,
    summary="Latest vitals",
    description=(
        "The most recent observation, or `null` when nothing has been recorded. "
        "The consultation screen and Patient 360 both want only this, and the "
        "`(patient_id, recorded_at)` index makes it a `LIMIT 1` rather than a "
        "full history fetched to read one row."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def patient_latest_vitals(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("patient.clinical.view"))],
) -> VitalsOut | None:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return clinical.latest_vitals(db, patient)


@router.post(
    "/{identifier}/vitals",
    response_model=VitalsOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record vitals",
    description=(
        "At least one reading is required. Ranges mirror the database CHECK "
        "constraints, so an impossible value is a 422 rather than a 503.\n\n"
        "Accepted from a nurse (`vitals.record`) or a doctor "
        "(`patient.clinical.edit`) — both record observations during a visit. "
        "The recorder is the authenticated user."
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
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return clinical.record_vitals(
        db, patient=patient, payload=payload, user=user, ip=client_ip(request)
    )


@router.get(
    "/{identifier}/invoices",
    response_model=list[InvoiceResponse],
    summary="Patient invoices",
    description=(
        "Every bill raised against this patient, newest first. Gated on "
        "`billing.view`: a clinician who may read the record has no business "
        "reading its finances."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def patient_invoices(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("billing.view"))],
) -> list[InvoiceResponse]:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return billing.invoices_for_patient(db, patient.id)


@router.get(
    "/{identifier}/consultations",
    response_model=list[ConsultationResponse],
    summary="Patient consultations",
    description="Every recorded encounter for this patient, newest first.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def patient_consultations(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("patient.clinical.view"))],
) -> list[ConsultationResponse]:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return consultations.consultations_for_patient(db, patient.id)


@router.get(
    "/{identifier}/rehab-plans",
    response_model=list[RehabPlanResponse],
    summary="Patient rehabilitation plans",
    description="Every plan for this patient, newest first.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def patient_rehab_plans(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("rehab.plan.view"))],
) -> list[RehabPlanResponse]:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return rehab.plans_for_patient(db, patient.id)


@router.get(
    "/{identifier}/therapy-sessions",
    response_model=list[TherapySessionResponse],
    summary="Patient therapy sessions",
    description="Every session for this patient, across all their plans.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def patient_therapy_sessions(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("therapy.progress.view"))],
) -> list[TherapySessionResponse]:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return therapy.sessions_for_patient(db, patient.id)


@router.get(
    "/{identifier}/progress",
    response_model=list[ProgressPointOut],
    summary="Patient rehabilitation progress",
    description=(
        "The weekly review series the rehabilitation charts plot, in the "
        "frontend's own `{week, pain, mobility, strength, adherence}` shape."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def patient_progress(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("therapy.progress.view"))],
) -> list[ProgressPointOut]:
    patient = service.get_patient(db, identifier=identifier, user=user, permissions=permissions)
    return rehab.progress_for_patient(db, patient.id)
