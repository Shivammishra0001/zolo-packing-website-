"""Patient business rules: branch scoping, registration, and the 360 view."""

from __future__ import annotations

import logging
import uuid as uuid_lib
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import AdmissionStatus, AuditCategory, PatientStatus, UserRole
from app.core.errors import ConflictError, NotFoundError
from app.core.ids import PATIENT
from app.models.audit import AuditLog
from app.models.organisation import Branch, Department
from app.models.patient import Patient
from app.models.user import User
from app.repositories import appointment_repository as appointment_repo
from app.repositories import patient_repository as repo
from app.repositories import rehab_repository as rehab_repo
from app.schemas.patient import (
    DocumentOut,
    EmergencyContact,
    Insurance,
    MedicalHistoryOut,
    Page,
    Patient360Response,
    PatientCreate,
    PatientResponse,
    PatientSearchResult,
    PatientUpdate,
    VitalsOut,
)
from app.services import clinical_service as clinical
from app.services import consultation_service
from app.services import lab_service
from app.services import prescription_service
from app.services import rehab_service
from app.services.avatars import AVATAR_COLOURS, avatar_colour
from app.services import billing_service
from app.services import nursing_service
from app.services import therapy_service
from app.services.appointment_serializer import to_response as appointment_to_response
from app.services.scoping import CROSS_BRANCH_PERMISSIONS, visible_branch_ids  # noqa: F401

logger = logging.getLogger(__name__)


def _new_avatar_colour(patient_number: str) -> str:
    """The colour a newly registered patient is given, stored on the row."""
    digits = "".join(ch for ch in patient_number if ch.isdigit())
    return AVATAR_COLOURS[(int(digits) if digits else 0) % len(AVATAR_COLOURS)]

#: Sections of the 360 payload gated on patient.clinical.view. Named in the
#: response so the UI can say "restricted" rather than implying "none".
CLINICAL_SECTIONS = ("vitals", "medicalHistory", "consultations", "labs")

#: Rehabilitation sections, gated separately on therapy.progress.view. A
#: pharmacist holds patient.view but has no business reading therapy notes.
REHAB_SECTIONS = ("rehabPlan", "rehabPlans", "therapySessions", "progress", "milestones")

#: Financial sections, gated separately on billing.view. A doctor holds
#: patient.clinical.view and still has no business reading a patient's bills.
BILLING_SECTIONS = ("invoices",)

#: Sections whose module has not been built yet. Every one the frontend shows
#: is now real.
PENDING_MODULES: tuple[str, ...] = ()

# ---------------------------------------------------------------------------
# Scoping
# ---------------------------------------------------------------------------


def assert_can_access(patient: Patient, branch_ids: list[uuid_lib.UUID] | None) -> None:
    """404 rather than 403 for out-of-scope patients.

    Returning 403 would confirm the record exists, letting someone enumerate
    patients from another branch by changing the URL.
    """
    if branch_ids is None:
        return
    if patient.branch_id not in branch_ids:
        raise NotFoundError("Patient not found.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _age(dob: date | None) -> int | None:
    if dob is None:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _initials(first: str, last: str) -> str:
    return f"{(first or ' ')[0]}{(last or ' ')[0]}".strip().upper() or "?"


def _staff_name(user: User | None) -> str:
    return user.full_name if user else ""


def to_response(patient: Patient) -> PatientResponse:
    """Shape a row into what the existing UI renders.

    Ward, bed and admission date are read from the patient's open stay rather
    than stored on the patient, so they cannot disagree with the bed board.
    """
    stay = next(
        (
            row
            for row in patient.admissions
            if row.status in (AdmissionStatus.ADMITTED, AdmissionStatus.DISCHARGE_PENDING)
        ),
        None,
    )
    bed = stay.bed if stay else None

    return PatientResponse(
        id=patient.patient_number,
        uuid=str(patient.id),
        name=patient.full_name,
        age=_age(patient.date_of_birth),
        gender=patient.gender,
        phone=patient.phone,
        email=patient.email,
        address=patient.address,
        bloodGroup=patient.blood_group,
        avatarColor=avatar_colour(patient),
        initials=_initials(patient.first_name, patient.last_name),
        status=patient.status,
        registeredOn=patient.registration_date,
        primaryCondition=patient.primary_condition,
        assignedDoctor=_staff_name(patient.assigned_doctor),
        assignedTherapist=_staff_name(patient.assigned_therapist),
        department=patient.department.name if patient.department else "",
        branch=patient.branch.name if patient.branch else None,
        emergencyContact=(
            EmergencyContact(**patient.emergency_contact) if patient.emergency_contact else None
        ),
        insurance=Insurance(**patient.insurance) if patient.insurance else None,
        allergies=list(patient.allergies or []),
        contactConsent=patient.contact_consent,
        ward=bed.ward.name if bed and bed.ward else None,
        room=(bed.room or None) if bed else None,
        bed=bed.bed_number if bed else None,
        admittedOn=stay.admission_date if stay else None,
        expectedDischarge=stay.expected_discharge if stay else None,
        lastVisit=patient.last_visit_at or patient.registration_date,
        createdAt=patient.created_at,
        updatedAt=patient.updated_at,
    )


def to_search_result(patient: Patient) -> PatientSearchResult:
    return PatientSearchResult(
        id=patient.patient_number,
        uuid=str(patient.id),
        patientNumber=patient.patient_number,
        name=patient.full_name,
        age=_age(patient.date_of_birth),
        gender=patient.gender,
        phone=patient.phone,
        status=patient.status,
        department=patient.department.name if patient.department else "",
        primaryCondition=patient.primary_condition,
        avatarColor=avatar_colour(patient),
        initials=_initials(patient.first_name, patient.last_name),
    )


def _split_name(name: str) -> tuple[str, str]:
    parts = name.strip().split()
    if len(parts) == 1:
        return parts[0], ""
    return " ".join(parts[:-1]), parts[-1]


def _resolve_department(db: Session, name: str | None) -> uuid_lib.UUID | None:
    if not name:
        return None
    row = db.execute(select(Department).where(Department.name == name)).scalar_one_or_none()
    return row.id if row else None


def _resolve_branch(db: Session, name: str | None) -> uuid_lib.UUID | None:
    if not name:
        return None
    row = db.execute(select(Branch).where(Branch.name == name)).scalar_one_or_none()
    return row.id if row else None


def _resolve_staff(db: Session, name: str | None, role: UserRole) -> uuid_lib.UUID | None:
    """Match a clinician by display name, as the registration form supplies it."""
    if not name:
        return None
    for candidate in db.execute(select(User).where(User.role == role)).scalars():
        if candidate.full_name == name:
            return candidate.id
    return None


def _audit(db: Session, user: User, action: str, patient: Patient, ip: str | None) -> None:
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=AuditCategory.PATIENT,
            target_type="patients",
            target_id=patient.id,
            summary=f"{patient.patient_number} — {patient.full_name}",
            ip_address=ip,
        )
    )


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


def list_patients(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int,
    limit: int,
    search: str | None = None,
    status: PatientStatus | None = None,
    scope: str = "all",
    sort: str = "name",
) -> Page[PatientResponse]:
    branch_ids = visible_branch_ids(db, user, permissions)

    # "My caseload" resolves against the signed-in clinician, never a client id.
    doctor_id = therapist_id = None
    admitted_only = False
    if scope == "mine":
        if user.role is UserRole.DOCTOR:
            doctor_id = user.id
        elif user.role is UserRole.THERAPIST:
            therapist_id = user.id
        elif user.role is UserRole.NURSE:
            admitted_only = True

    rows, total = repo.list_patients(
        db,
        branch_ids=branch_ids,
        search=search,
        status=status,
        assigned_doctor_id=doctor_id,
        assigned_therapist_id=therapist_id,
        admitted_only=admitted_only,
        sort=sort,  # type: ignore[arg-type]
        offset=(page - 1) * limit,
        limit=limit,
    )

    return Page[PatientResponse](
        items=[to_response(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def search(
    db: Session, *, user: User, permissions: list[str], term: str, limit: int = 8
) -> list[PatientSearchResult]:
    rows = repo.search_patients(
        db, term=term, branch_ids=visible_branch_ids(db, user, permissions), limit=limit
    )
    return [to_search_result(row) for row in rows]


def get_patient(db: Session, *, identifier: str, user: User, permissions: list[str]) -> Patient:
    """Resolve by UUID or ``PT-#####`` code, then enforce branch scope."""
    patient: Patient | None = None

    if PATIENT.matches(identifier):
        patient = repo.get_by_number(db, identifier)
    else:
        try:
            patient = repo.get_by_uuid(db, uuid_lib.UUID(identifier))
        except ValueError:
            patient = repo.get_by_number(db, identifier)

    if patient is None:
        raise NotFoundError("Patient not found.")

    assert_can_access(patient, visible_branch_ids(db, user, permissions))
    return patient


def build_360(
    db: Session, *, patient: Patient, permissions: list[str]
) -> Patient360Response:
    """Assemble Patient 360.

    Clinical sections are withheld unless the caller holds
    ``patient.clinical.view``; the response says which sections were withheld
    so the UI can explain the empty tab rather than implying no data exists.

    Everything below is a real query. Sections whose module is not built yet
    come back empty and are named in ``pendingModules`` — none of them is
    invented.
    """
    can_see_clinical = "patient.clinical.view" in permissions
    can_see_rehab = "therapy.progress.view" in permissions or "rehab.plan.view" in permissions

    vitals: list[VitalsOut] = []
    history: list[MedicalHistoryOut] = []
    consultations: list = []
    labs: list = []
    plans: list = []
    sessions: list = []
    progress: list = []
    milestones: list = []
    active_plan = None
    restricted: list[str] = []

    if can_see_clinical:
        vitals = clinical.list_vitals(db, patient)
        history = clinical.list_history(db, patient)
        consultations = consultation_service.consultations_for_patient(db, patient.id)
        labs = lab_service.labs_for_patient(db, patient.id)
    else:
        restricted.extend(CLINICAL_SECTIONS)

    if can_see_rehab:
        plans = rehab_service.plans_for_patient(db, patient.id)
        progress = rehab_service.progress_for_patient(db, patient.id)
        sessions = therapy_service.sessions_for_patient(db, patient.id)
        # The patient record shows one plan — the active one, which is what the
        # rehab tab and the progress header read.
        current = rehab_repo.active_plan_for_patient(db, patient.id)
        if current is not None:
            active_plan = rehab_service.to_response(current)
            milestones = active_plan.milestones
    else:
        restricted.extend(REHAB_SECTIONS)

    documents = [
        DocumentOut(
            id=str(row.id),
            name=row.name,
            type=row.type,
            size=_format_size(row.size_bytes),
            uploadedOn=row.uploaded_on,
            uploadedBy=_staff_name(row.uploader) or "Records desk",
        )
        for row in repo.documents_for(db, patient.id)
    ]

    # Appointments and prescriptions are administrative as well as clinical —
    # reception books the one and the pharmacy fills the other — so they follow
    # patient access rather than the clinical gate. Scoping was already enforced
    # when the patient was resolved, so no second branch filter is needed.
    appointment_rows, _ = appointment_repo.list_appointments(
        db, branch_ids=None, patient_id=patient.id, limit=200
    )

    # Which bed a patient is in is ward information, not clinical detail, so it
    # follows patient access like appointments do.
    # A prescription lists medicines, doses and frequencies. That is clinical
    # content, so it follows the clinical gate — with the pharmacy's dispensing
    # key accepted alongside it, since dispensing is what they read it for.
    prescriptions: list = []
    if can_see_clinical or "prescription.dispense" in permissions:
        prescriptions = prescription_service.prescriptions_for_patient(db, patient.id)
    else:
        restricted.append("prescriptions")

    invoices: list = []
    if "billing.view" in permissions:
        invoices = billing_service.invoices_for_patient(db, patient.id)
    else:
        restricted.extend(BILLING_SECTIONS)

    admissions = nursing_service.admissions_for_patient(db, patient.id)
    current_admission = next(
        (row for row in admissions if row.status is not AdmissionStatus.DISCHARGED), None
    )

    return Patient360Response(
        patient=to_response(patient),
        vitals=vitals,
        medicalHistory=history,
        documents=documents,
        appointments=[appointment_to_response(row) for row in appointment_rows],
        consultations=consultations,
        prescriptions=prescriptions,
        labs=labs,
        rehabPlan=active_plan,
        rehabPlans=plans,
        therapySessions=sessions,
        progress=progress,
        milestones=milestones,
        invoices=invoices,
        admissions=admissions,
        currentAdmission=current_admission,
        restrictedSections=restricted,
        pendingModules=list(PENDING_MODULES),
    )


def _format_size(size_bytes: int | None) -> str:
    if not size_bytes:
        return "—"
    if size_bytes >= 1_048_576:
        return f"{size_bytes / 1_048_576:.1f} MB"
    return f"{max(1, size_bytes // 1024)} KB"


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------


def create_patient(
    db: Session, *, payload: PatientCreate, user: User, ip: str | None = None
) -> Patient:
    """Register a patient. Commits, or rolls back entirely."""
    if repo.phone_in_use(db, payload.phone):
        raise ConflictError(
            "A patient with this phone number is already registered.",
            code="duplicate_phone",
        )

    first_name, last_name = _split_name(payload.name)
    branch_id = _resolve_branch(db, payload.branch) or user.branch_id
    patient_number = repo.next_patient_number(db)

    patient = Patient(
        patient_number=patient_number,
        first_name=first_name,
        last_name=last_name,
        date_of_birth=payload.dateOfBirth,
        gender=payload.gender,
        phone=payload.phone,
        email=payload.email,
        address=payload.address,
        blood_group=payload.bloodGroup,
        status=payload.status,
        primary_condition=payload.primaryCondition,
        registration_date=date.today(),
        branch_id=branch_id,
        department_id=_resolve_department(db, payload.department),
        assigned_doctor_id=_resolve_staff(db, payload.assignedDoctor, UserRole.DOCTOR),
        assigned_therapist_id=_resolve_staff(db, payload.assignedTherapist, UserRole.THERAPIST),
        emergency_contact=payload.emergencyContact.model_dump(mode="json")
        if payload.emergencyContact
        else None,
        insurance=payload.insurance.model_dump(mode="json") if payload.insurance else None,
        allergies=payload.allergies,
        avatar_color=_new_avatar_colour(patient_number),
    )

    db.add(patient)
    db.flush()
    _audit(db, user, "PATIENT_CREATED", patient, ip)
    db.commit()
    db.refresh(patient)

    logger.info("Patient %s registered by %s", patient.patient_number, user.id)
    return patient


def update_patient(
    db: Session, *, patient: Patient, payload: PatientUpdate, user: User, ip: str | None = None
) -> Patient:
    """Apply an edit. Only fields present in the payload are touched."""
    data = payload.model_dump(exclude_unset=True)

    if "phone" in data and data["phone"] and repo.phone_in_use(db, data["phone"], exclude=patient.id):
        raise ConflictError(
            "Another patient is already registered with this phone number.",
            code="duplicate_phone",
        )

    if "name" in data and data["name"]:
        patient.first_name, patient.last_name = _split_name(data["name"])

    simple = {
        "dateOfBirth": "date_of_birth",
        "gender": "gender",
        "phone": "phone",
        "email": "email",
        "address": "address",
        "bloodGroup": "blood_group",
        "primaryCondition": "primary_condition",
        "status": "status",
    }
    for key, column in simple.items():
        if key in data:
            setattr(patient, column, data[key])

    if "allergies" in data and data["allergies"] is not None:
        patient.allergies = data["allergies"]
    if "emergencyContact" in data:
        patient.emergency_contact = (
            payload.emergencyContact.model_dump(mode="json") if payload.emergencyContact else None
        )
    if "insurance" in data:
        patient.insurance = (
            payload.insurance.model_dump(mode="json") if payload.insurance else None
        )
    if "department" in data:
        patient.department_id = _resolve_department(db, data["department"])
    if "branch" in data:
        patient.branch_id = _resolve_branch(db, data["branch"])
    if "assignedDoctor" in data:
        patient.assigned_doctor_id = _resolve_staff(db, data["assignedDoctor"], UserRole.DOCTOR)
    if "assignedTherapist" in data:
        patient.assigned_therapist_id = _resolve_staff(
            db, data["assignedTherapist"], UserRole.THERAPIST
        )

    # updated_at is maintained by the model's onupdate hook.
    db.add(patient)
    _audit(db, user, "PATIENT_UPDATED", patient, ip)
    db.commit()
    db.refresh(patient)

    logger.info("Patient %s updated by %s", patient.patient_number, user.id)
    return patient
