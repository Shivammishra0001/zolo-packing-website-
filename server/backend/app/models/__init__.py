"""SQLAlchemy models.

Every model module is imported here so ``Base.metadata`` is fully populated
before Alembic autogenerates a migration — otherwise autogenerate sees an empty
schema and writes a migration that drops your tables.
"""

from __future__ import annotations

from app.core.database import Base
from app.models.ai import AIApproval, AIAuditLog, AIDocument, MessageDraft
from app.models.appointment import Appointment
from app.models.audit import AuditLog
from app.models.billing import Expense, Invoice, InvoiceItem, Payment
from app.models.consultation import Consultation
from app.models.lab import LabResult, LabResultValue
from app.models.notification import Notification
from app.models.organisation import Branch, ConsultationFee, Department, Setting
from app.models.patient import MedicalHistoryEntry, Patient, PatientDocument
from app.models.pharmacy import (
    DispenseRecord,
    Medicine,
    MedicineBatch,
    PharmacySale,
    PharmacySaleItem,
    Prescription,
    PrescriptionItem,
)
from app.models.rehab import RehabMilestone, RehabPlan, RehabProgressPoint
from app.models.therapy import ExerciseLibrary, TherapySession, TherapySessionExercise
from app.models.user import Permission, RolePermission, User
from app.models.vitals import Vitals
from app.models.ward import (
    Admission,
    Bed,
    DischargeChecklistItem,
    NursingTask,
    Ward,
)

__all__ = [
    "Base",
    # Organisation
    "Branch",
    "Department",
    "Setting",
    "ConsultationFee",
    # Identity and access
    "User",
    "Permission",
    "RolePermission",
    # Patients
    "Patient",
    "MedicalHistoryEntry",
    "PatientDocument",
    "Vitals",
    # Scheduling and clinical
    "Appointment",
    "Consultation",
    "LabResult",
    "LabResultValue",
    # Rehabilitation and therapy
    "RehabPlan",
    "RehabMilestone",
    "RehabProgressPoint",
    "ExerciseLibrary",
    "TherapySession",
    "TherapySessionExercise",
    # Wards and nursing
    "Ward",
    "Bed",
    "Admission",
    "NursingTask",
    "DischargeChecklistItem",
    # Pharmacy
    "Medicine",
    "MedicineBatch",
    "PharmacySale",
    "PharmacySaleItem",
    "Prescription",
    "PrescriptionItem",
    "DispenseRecord",
    # Billing
    "Invoice",
    "InvoiceItem",
    "Payment",
    "Expense",
    # Platform
    "Notification",
    "AuditLog",
    # AI layer
    "AIApproval",
    "AIAuditLog",
    "AIDocument",
    "MessageDraft",
]
