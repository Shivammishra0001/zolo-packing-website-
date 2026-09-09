"""Centralised enum vocabularies.

The frontend switches on human-readable display literals (``'In Consultation'``,
``'Partially Dispensed'``, ``'Near Expiry'``). PostgreSQL stores conventional
values. ``DisplayEnum`` carries both, so models persist the canonical value
while the API serialises the display label — which is what lets the existing UI
keep working untouched.

    database value  ->  DisplayEnum member  ->  frontend display value
    'CHECKED_IN'        AppointmentStatus.CHECKED_IN   'Waiting'

Two vocabularies are deliberately lowercase because the frontend keys objects
off them directly: :class:`UserRole` and :class:`UserStatus`.
"""

from __future__ import annotations

from enum import Enum

from sqlalchemy import Enum as SAEnum


class DisplayEnum(str, Enum):
    """String enum carrying a UI-facing label next to its stored value.

    >>> class Colour(DisplayEnum):
    ...     OFF_TRACK = ("OFF_TRACK", "Off Track")
    >>> Colour.OFF_TRACK.value
    'OFF_TRACK'
    >>> Colour.OFF_TRACK.display
    'Off Track'
    >>> Colour.from_display("Off Track") is Colour.OFF_TRACK
    True
    """

    display: str

    def __new__(cls, value: str, display: str | None = None) -> "DisplayEnum":
        obj = str.__new__(cls, value)
        obj._value_ = value
        obj.display = display if display is not None else value
        return obj

    @classmethod
    def from_display(cls, label: str) -> "DisplayEnum":
        """Resolve a UI label back to its member (used when parsing requests)."""
        for member in cls:
            if member.display == label or member.value == label:
                return member
        valid = ", ".join(sorted(m.display for m in cls))
        raise ValueError(f"{label!r} is not a valid {cls.__name__}. Expected one of: {valid}")

    @classmethod
    def displays(cls) -> list[str]:
        """Every UI label, for schema examples and validation messages."""
        return [member.display for member in cls]

    @classmethod
    def _wire_uses_value(cls) -> bool:
        """Whether the API sends the stored value instead of the display label.

        Almost every vocabulary crosses the wire as its label, because that is
        what the frontend switches on. Roles and account status are the
        exception: the frontend keys objects off the lowercase value itself
        (ROLE_HOME, ROLE_LABEL, NAVIGATION), so those must stay verbatim.
        """
        return False

    @classmethod
    def _wire_value(cls, member: "DisplayEnum") -> str:
        return member.value if cls._wire_uses_value() else member.display

    @classmethod
    def _wire_options(cls) -> list[str]:
        return [cls._wire_value(m) for m in cls]

    @classmethod
    def display_map(cls) -> dict[str, str]:
        """``{stored value: display label}`` — handy for docs and tests."""
        return {member.value: member.display for member in cls}

    def __str__(self) -> str:  # pragma: no cover - convenience only
        return self.value

    # -- Pydantic integration -------------------------------------------------
    # Every DisplayEnum crosses the API boundary as its *display* label, and is
    # accepted as either the label or the stored value. Defining it here means
    # no schema or route has to annotate individual fields, and the database
    # keeps storing the canonical value (SQLAlchemy uses its own Enum type).

    @classmethod
    def __get_pydantic_core_schema__(cls, source_type, handler):  # noqa: ANN001, ANN206
        from pydantic_core import core_schema

        def validate(value: object) -> "DisplayEnum":
            if isinstance(value, cls):
                return value
            try:
                return cls.from_display(str(value))
            except ValueError as exc:
                raise ValueError(str(exc)) from exc

        return core_schema.no_info_plain_validator_function(
            validate,
            serialization=core_schema.plain_serializer_function_ser_schema(
                cls._wire_value,
                return_schema=core_schema.str_schema(),
                # JSON only. `model_dump()` in python mode must keep the enum
                # member, because that value goes straight to SQLAlchemy — which
                # expects the canonical name, not the display label.
                when_used="json",
            ),
        )

    @classmethod
    def __get_pydantic_json_schema__(cls, schema, handler):  # noqa: ANN001, ANN206
        # Advertise exactly the strings clients send and receive.
        return {"type": "string", "enum": cls._wire_options(), "title": cls.__name__}


def pg_enum(enum_cls: type[Enum], name: str) -> SAEnum:
    """Build a PostgreSQL ENUM type that persists ``.value``, not ``.name``.

    SQLAlchemy stores ``.name`` by default, which would put ``ACTIVE_OPD`` in
    the column for a member whose value is ``ACTIVE_OPD`` anyway — but would
    break the lowercase role vocabulary. ``values_callable`` makes the stored
    representation explicit and stable.
    """
    return SAEnum(
        enum_cls,
        name=name,
        values_callable=lambda members: [m.value for m in members],
        native_enum=True,
        validate_strings=True,
    )


# ---------------------------------------------------------------------------
# Identity and organisation
# ---------------------------------------------------------------------------


class UserRole(DisplayEnum):
    """The eight staff roles.

    Crosses the API as the lowercase value, not the label: ROLE_HOME,
    ROLE_LABEL and NAVIGATION in the frontend are all keyed on it. The label
    here is for server-side display only (logs, seed output).
    """

    @classmethod
    def _wire_uses_value(cls) -> bool:
        return True

    OWNER = ("owner", "Hospital Owner")
    ADMIN = ("admin", "Administrator")
    DOCTOR = ("doctor", "Doctor")
    THERAPIST = ("therapist", "Therapist")
    NURSE = ("nurse", "Nurse")
    PHARMACIST = ("pharmacist", "Pharmacist")
    RECEPTIONIST = ("receptionist", "Receptionist")
    ACCOUNTANT = ("accountant", "Accountant")


class UserStatus(DisplayEnum):
    """Lowercase — rendered directly by the admin staff table."""

    @classmethod
    def _wire_uses_value(cls) -> bool:
        return True

    ACTIVE = ("active", "active")
    SUSPENDED = ("suspended", "suspended")
    PENDING = ("pending", "pending")


class DepartmentType(DisplayEnum):
    CLINICAL = ("CLINICAL", "Clinical")
    THERAPY = ("THERAPY", "Therapy")
    SUPPORT = ("SUPPORT", "Support")


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------


class Gender(DisplayEnum):
    MALE = ("MALE", "Male")
    FEMALE = ("FEMALE", "Female")
    OTHER = ("OTHER", "Other")


class PatientStatus(DisplayEnum):
    ACTIVE_OPD = ("ACTIVE_OPD", "Active - OPD")
    ADMITTED_IPD = ("ADMITTED_IPD", "Admitted - IPD")
    IN_REHABILITATION = ("IN_REHABILITATION", "In Rehabilitation")
    DISCHARGE_PENDING = ("DISCHARGE_PENDING", "Discharge Pending")
    DISCHARGED = ("DISCHARGED", "Discharged")
    FOLLOW_UP = ("FOLLOW_UP", "Follow-up")


class MedicalHistoryType(DisplayEnum):
    DIAGNOSIS = ("DIAGNOSIS", "Diagnosis")
    SURGERY = ("SURGERY", "Surgery")
    INJURY = ("INJURY", "Injury")
    ALLERGY = ("ALLERGY", "Allergy")
    CHRONIC_CONDITION = ("CHRONIC_CONDITION", "Chronic Condition")
    LAB_RESULT = ("LAB_RESULT", "Lab Result")


class DocumentType(DisplayEnum):
    REPORT = ("REPORT", "Report")
    SCAN = ("SCAN", "Scan")
    CONSENT = ("CONSENT", "Consent")
    INSURANCE = ("INSURANCE", "Insurance")
    DISCHARGE_SUMMARY = ("DISCHARGE_SUMMARY", "Discharge Summary")


# ---------------------------------------------------------------------------
# Scheduling and clinical
# ---------------------------------------------------------------------------


class AppointmentStatus(DisplayEnum):
    SCHEDULED = ("SCHEDULED", "Scheduled")
    CHECKED_IN = ("CHECKED_IN", "Waiting")
    IN_PROGRESS = ("IN_PROGRESS", "In Consultation")
    COMPLETED = ("COMPLETED", "Completed")
    FOLLOW_UP = ("FOLLOW_UP", "Follow-up")
    CANCELLED = ("CANCELLED", "Cancelled")
    NO_SHOW = ("NO_SHOW", "No Show")


class AppointmentType(DisplayEnum):
    NEW_CONSULTATION = ("NEW_CONSULTATION", "New Consultation")
    FOLLOW_UP = ("FOLLOW_UP", "Follow-up")
    THERAPY_REVIEW = ("THERAPY_REVIEW", "Therapy Review")
    POST_OP_REVIEW = ("POST_OP_REVIEW", "Post-op Review")
    ASSESSMENT = ("ASSESSMENT", "Assessment")
    WALK_IN = ("WALK_IN", "Walk-in")


class LabFlag(DisplayEnum):
    NORMAL = ("NORMAL", "Normal")
    ABNORMAL = ("ABNORMAL", "Abnormal")
    CRITICAL = ("CRITICAL", "Critical")


# ---------------------------------------------------------------------------
# Rehabilitation and therapy
# ---------------------------------------------------------------------------


class RehabTrend(DisplayEnum):
    """Plan trajectory. Derived by the service layer in a later step."""

    ON_TRACK = ("ON_TRACK", "On Track")
    AHEAD_OF_PLAN = ("AHEAD_OF_PLAN", "Ahead of Plan")
    PLATEAUED = ("PLATEAUED", "Plateaued")
    AT_RISK = ("AT_RISK", "At Risk")
    COMPLETED = ("COMPLETED", "Completed")


class RehabPlanStatus(DisplayEnum):
    ACTIVE = ("ACTIVE", "Active")
    COMPLETED = ("COMPLETED", "Completed")
    ON_HOLD = ("ON_HOLD", "On Hold")
    CANCELLED = ("CANCELLED", "Cancelled")


class MilestoneStatus(DisplayEnum):
    PENDING = ("PENDING", "Pending")
    ACHIEVED = ("ACHIEVED", "Achieved")
    MISSED = ("MISSED", "Missed")


class TherapyType(DisplayEnum):
    PHYSIOTHERAPY = ("PHYSIOTHERAPY", "Physiotherapy")
    OCCUPATIONAL_THERAPY = ("OCCUPATIONAL_THERAPY", "Occupational Therapy")
    SPEECH_THERAPY = ("SPEECH_THERAPY", "Speech Therapy")
    NEURO_REHABILITATION = ("NEURO_REHABILITATION", "Neuro Rehabilitation")
    PHYSICAL_REHABILITATION = ("PHYSICAL_REHABILITATION", "Physical Rehabilitation")
    HYDROTHERAPY = ("HYDROTHERAPY", "Hydrotherapy")
    CARDIAC_REHABILITATION = ("CARDIAC_REHABILITATION", "Cardiac Rehabilitation")


class TherapySessionStatus(DisplayEnum):
    SCHEDULED = ("SCHEDULED", "Scheduled")
    IN_PROGRESS = ("IN_PROGRESS", "In Progress")
    COMPLETED = ("COMPLETED", "Completed")
    MISSED = ("MISSED", "Missed")


class AttendanceStatus(DisplayEnum):
    ATTENDED = ("ATTENDED", "Attended")
    LATE = ("LATE", "Late")
    NO_SHOW = ("NO_SHOW", "No Show")
    CANCELLED = ("CANCELLED", "Cancelled")


# ---------------------------------------------------------------------------
# Wards, beds, nursing
# ---------------------------------------------------------------------------


class BedType(DisplayEnum):
    GENERAL = ("GENERAL", "General")
    SEMI_PRIVATE = ("SEMI_PRIVATE", "Semi-Private")
    PRIVATE = ("PRIVATE", "Private")
    ICU = ("ICU", "ICU")
    REHAB_SUITE = ("REHAB_SUITE", "Rehab Suite")


class BedStatus(DisplayEnum):
    AVAILABLE = ("AVAILABLE", "Available")
    OCCUPIED = ("OCCUPIED", "Occupied")
    RESERVED = ("RESERVED", "Reserved")
    CLEANING = ("CLEANING", "Cleaning")


class AdmissionStatus(DisplayEnum):
    ADMITTED = ("ADMITTED", "Admitted")
    DISCHARGE_PENDING = ("DISCHARGE_PENDING", "Discharge Pending")
    DISCHARGED = ("DISCHARGED", "Discharged")


class NursingTaskType(DisplayEnum):
    VITALS = ("VITALS", "Vitals")
    MEDICATION = ("MEDICATION", "Medication")
    DOCTOR_INSTRUCTION = ("DOCTOR_INSTRUCTION", "Doctor Instruction")
    CARE_TASK = ("CARE_TASK", "Care Task")
    THERAPY_PREP = ("THERAPY_PREP", "Therapy Prep")


class TaskPriority(DisplayEnum):
    ROUTINE = ("ROUTINE", "Routine")
    HIGH = ("HIGH", "High")
    CRITICAL = ("CRITICAL", "Critical")


# ---------------------------------------------------------------------------
# Pharmacy
# ---------------------------------------------------------------------------


class StockStatus(DisplayEnum):
    """Never stored — derived from batch quantity, reorder level and expiry.

    Declared here so the API layer has one definition of the vocabulary.
    """

    IN_STOCK = ("IN_STOCK", "In Stock")
    LOW_STOCK = ("LOW_STOCK", "Low Stock")
    NEAR_EXPIRY = ("NEAR_EXPIRY", "Near Expiry")
    OUT_OF_STOCK = ("OUT_OF_STOCK", "Out of Stock")


class PrescriptionStatus(DisplayEnum):
    PENDING = ("PENDING", "Pending")
    PARTIALLY_DISPENSED = ("PARTIALLY_DISPENSED", "Partially Dispensed")
    DISPENSED = ("DISPENSED", "Dispensed")
    CANCELLED = ("CANCELLED", "Cancelled")


class PrescriptionPriority(DisplayEnum):
    ROUTINE = ("ROUTINE", "Routine")
    URGENT = ("URGENT", "Urgent")


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------


class InvoiceDepartment(DisplayEnum):
    OPD = ("OPD", "OPD")
    IPD = ("IPD", "IPD")
    PHARMACY = ("PHARMACY", "Pharmacy")
    THERAPY = ("THERAPY", "Therapy")
    DIAGNOSTICS = ("DIAGNOSTICS", "Diagnostics")


class InvoiceStatus(DisplayEnum):
    PAID = ("PAID", "Paid")
    PARTIALLY_PAID = ("PARTIALLY_PAID", "Partially Paid")
    UNPAID = ("UNPAID", "Unpaid")
    OVERDUE = ("OVERDUE", "Overdue")


class PaymentMethod(DisplayEnum):
    CASH = ("CASH", "Cash")
    UPI = ("UPI", "UPI")
    CARD = ("CARD", "Card")
    BANK_TRANSFER = ("BANK_TRANSFER", "Bank Transfer")
    INSURANCE = ("INSURANCE", "Insurance")


class PaymentStatus(DisplayEnum):
    SETTLED = ("SETTLED", "Settled")
    PROCESSING = ("PROCESSING", "Processing")
    FAILED = ("FAILED", "Failed")


class ExpenseCategory(DisplayEnum):
    SALARIES = ("SALARIES", "Salaries")
    PHARMACY_PURCHASE = ("PHARMACY_PURCHASE", "Pharmacy Purchase")
    EQUIPMENT = ("EQUIPMENT", "Equipment")
    UTILITIES = ("UTILITIES", "Utilities")
    MAINTENANCE = ("MAINTENANCE", "Maintenance")
    MARKETING = ("MARKETING", "Marketing")
    UNCATEGORISED = ("UNCATEGORISED", "Uncategorised")


class ExpenseStatus(DisplayEnum):
    RECORDED = ("RECORDED", "Recorded")
    PENDING_CATEGORISATION = ("PENDING_CATEGORISATION", "Pending Categorisation")
    APPROVED = ("APPROVED", "Approved")


# ---------------------------------------------------------------------------
# Notifications and audit
# ---------------------------------------------------------------------------


class NotificationIcon(DisplayEnum):
    CLINICAL = ("CLINICAL", "clinical")
    STOCK = ("STOCK", "stock")
    FINANCE = ("FINANCE", "finance")
    THERAPY = ("THERAPY", "therapy")
    SYSTEM = ("SYSTEM", "system")
    PATIENT = ("PATIENT", "patient")


class NotificationSeverity(DisplayEnum):
    INFO = ("INFO", "info")
    WARNING = ("WARNING", "warning")
    CRITICAL = ("CRITICAL", "critical")
    SUCCESS = ("SUCCESS", "success")


class AIAgentType(DisplayEnum):
    """The five agents. One value per capability, not one per prompt."""

    PATIENT_RECAP = ("PATIENT_RECAP", "Patient Recap")
    CLINICAL_DOCUMENTATION = ("CLINICAL_DOCUMENTATION", "Clinical Documentation")
    BILLING_ACCURACY = ("BILLING_ACCURACY", "Billing Accuracy")
    FOLLOW_UP = ("FOLLOW_UP", "Follow-up")
    FINANCE_INSIGHTS = ("FINANCE_INSIGHTS", "Finance Insights")


class AIRunStatus(DisplayEnum):
    """How an agent run ended.

    ``DEGRADED`` is its own outcome rather than a failure: the deterministic
    half produced a real answer while the model was unavailable, and a reader
    of the trail needs to tell that apart from both success and error.
    """

    SUCCEEDED = ("SUCCEEDED", "Succeeded")
    DEGRADED = ("DEGRADED", "Degraded")
    INVALID_OUTPUT = ("INVALID_OUTPUT", "Invalid output")
    FAILED = ("FAILED", "Failed")
    RATE_LIMITED = ("RATE_LIMITED", "Rate limited")


class AIReviewStatus(DisplayEnum):
    """Where a suggestion sits in the human-approval workflow."""

    PENDING = ("PENDING", "Pending review")
    APPROVED = ("APPROVED", "Approved")
    REJECTED = ("REJECTED", "Rejected")


class DocumentKind(DisplayEnum):
    """Document types the documentation agent structures."""

    PRESCRIPTION = ("PRESCRIPTION", "Prescription")
    DOCTOR_NOTE = ("DOCTOR_NOTE", "Doctor note")
    DISCHARGE_NOTE = ("DISCHARGE_NOTE", "Discharge note")
    REFERRAL = ("REFERRAL", "Referral")
    LAB_DOCUMENT = ("LAB_DOCUMENT", "Lab document")
    THERAPY_NOTE = ("THERAPY_NOTE", "Therapy note")
    UNKNOWN = ("UNKNOWN", "Unclassified")


class MessageChannel(DisplayEnum):
    SMS = ("SMS", "SMS")
    WHATSAPP = ("WHATSAPP", "WhatsApp")


class MessageStatus(DisplayEnum):
    """A provider accepting a request is not delivery — those are separate."""

    DRAFT = ("DRAFT", "Draft")
    #: Approved, but no gateway took it yet — including "no gateway configured".
    PENDING = ("PENDING", "Pending")
    SENT = ("SENT", "Sent")
    DELIVERED = ("DELIVERED", "Delivered")
    #: A person decided not to send it. Distinct from FAILED, which is the
    #: gateway's verdict; reporting one as the other would blame the network
    #: for a clinical judgement, or the reverse.
    REJECTED = ("REJECTED", "Rejected")
    FAILED = ("FAILED", "Failed")


class AuditCategory(DisplayEnum):
    AUTH = ("AUTH", "auth")
    STAFF = ("STAFF", "staff")
    PATIENT = ("PATIENT", "patient")
    PHARMACY = ("PHARMACY", "pharmacy")
    BILLING = ("BILLING", "billing")
    SYSTEM = ("SYSTEM", "system")


class PermissionGroup(DisplayEnum):
    """Groups mirror the sections on the admin Roles & Permissions screen."""

    PATIENTS = ("PATIENTS", "Patient records")
    SCHEDULING = ("SCHEDULING", "Scheduling")
    CLINICAL = ("CLINICAL", "Clinical workflow")
    REHAB = ("REHAB", "Rehabilitation")
    PHARMACY = ("PHARMACY", "Pharmacy")
    FINANCE = ("FINANCE", "Finance")
    OPERATIONS = ("OPERATIONS", "Operations & analytics")
    SYSTEM = ("SYSTEM", "System administration")


#: Every vocabulary the API layer maps between DB value and frontend label.
ALL_DISPLAY_ENUMS: tuple[type[DisplayEnum], ...] = (
    UserRole,
    UserStatus,
    DepartmentType,
    Gender,
    PatientStatus,
    MedicalHistoryType,
    DocumentType,
    AppointmentStatus,
    AppointmentType,
    LabFlag,
    RehabTrend,
    RehabPlanStatus,
    MilestoneStatus,
    TherapyType,
    TherapySessionStatus,
    AttendanceStatus,
    BedType,
    BedStatus,
    AdmissionStatus,
    NursingTaskType,
    TaskPriority,
    StockStatus,
    PrescriptionStatus,
    PrescriptionPriority,
    InvoiceDepartment,
    InvoiceStatus,
    PaymentMethod,
    PaymentStatus,
    ExpenseCategory,
    ExpenseStatus,
    NotificationIcon,
    NotificationSeverity,
    AIAgentType,
    AIRunStatus,
    AIReviewStatus,
    DocumentKind,
    MessageChannel,
    MessageStatus,
    AuditCategory,
    PermissionGroup,
)
