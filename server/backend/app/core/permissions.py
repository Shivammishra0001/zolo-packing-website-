"""Permission catalogue and the role matrix.

Generated from the existing frontend so the keys, labels and groupings match
``src/lib/permissions.ts`` and ``src/pages/admin/Roles.tsx`` exactly. The
database is the source of truth at runtime; this module only seeds it.
"""

from __future__ import annotations

from app.core.enums import PermissionGroup, UserRole

#: (key, label, group) for each of the 33 permission codes.
PERMISSION_CATALOGUE: tuple[tuple[str, str, PermissionGroup], ...] = (
    # Patient records — Who can see and change patient demographics and clinical notes.
    ("patient.view", "View patients", PermissionGroup.PATIENTS),
    ("patient.create", "Register patients", PermissionGroup.PATIENTS),
    ("patient.edit", "Edit patient details", PermissionGroup.PATIENTS),
    ("patient.clinical.view", "View clinical records", PermissionGroup.PATIENTS),
    ("patient.clinical.edit", "Edit clinical records", PermissionGroup.PATIENTS),
    # Scheduling — Appointment booking and front-desk check-in.
    ("appointment.view", "View appointments", PermissionGroup.SCHEDULING),
    ("appointment.create", "Book appointments", PermissionGroup.SCHEDULING),
    ("appointment.checkin", "Check patients in", PermissionGroup.SCHEDULING),
    # Clinical workflow — Consultations, prescriptions, vitals and nursing tasks.
    ("consultation.manage", "Record consultations", PermissionGroup.CLINICAL),
    ("prescription.create", "Write prescriptions", PermissionGroup.CLINICAL),
    ("vitals.record", "Record vitals", PermissionGroup.CLINICAL),
    ("nursing.tasks", "Manage nursing tasks", PermissionGroup.CLINICAL),
    # Rehabilitation — Rehab plans, therapy sessions and progress tracking.
    ("rehab.plan.view", "View rehab plans", PermissionGroup.REHAB),
    ("rehab.plan.manage", "Create & edit rehab plans", PermissionGroup.REHAB),
    ("therapy.session.manage", "Record therapy sessions", PermissionGroup.REHAB),
    ("therapy.progress.view", "View therapy progress", PermissionGroup.REHAB),
    # Pharmacy — Inventory, dispensing and point of sale.
    ("prescription.dispense", "Dispense prescriptions", PermissionGroup.PHARMACY),
    ("pharmacy.inventory", "Manage inventory", PermissionGroup.PHARMACY),
    ("pharmacy.pos", "Operate point of sale", PermissionGroup.PHARMACY),
    # Finance — Invoices, payments, expenses and financial reporting.
    ("billing.view", "View billing", PermissionGroup.FINANCE),
    ("billing.manage", "Create & edit invoices", PermissionGroup.FINANCE),
    ("payments.manage", "Record payments", PermissionGroup.FINANCE),
    ("expenses.manage", "Manage expenses", PermissionGroup.FINANCE),
    ("finance.reports", "Financial reports", PermissionGroup.FINANCE),
    # Operations & analytics — Bed management and business intelligence.
    ("beds.view", "View beds", PermissionGroup.OPERATIONS),
    ("beds.manage", "Assign beds", PermissionGroup.OPERATIONS),
    ("analytics.business", "Business analytics", PermissionGroup.OPERATIONS),
    ("analytics.operational", "Operational analytics", PermissionGroup.OPERATIONS),
    # System administration — Accounts, roles, branches, audit and configuration.
    ("staff.manage", "Manage staff accounts", PermissionGroup.SYSTEM),
    ("roles.manage", "Manage roles", PermissionGroup.SYSTEM),
    ("branches.manage", "Manage branches", PermissionGroup.SYSTEM),
    ("audit.view", "View audit log", PermissionGroup.SYSTEM),
    ("settings.manage", "System configuration", PermissionGroup.SYSTEM),
)

#: role -> permission keys, mirroring ROLE_PERMISSIONS in the frontend.
ROLE_MATRIX: dict[UserRole, tuple[str, ...]] = {
    UserRole.OWNER: (
        "patient.view",
        "appointment.view",
        "rehab.plan.view",
        "therapy.progress.view",
        "billing.view",
        "finance.reports",
        "beds.view",
        "analytics.business",
        "analytics.operational",
        "audit.view",
    ),
    UserRole.ADMIN: (
        "patient.view",
        "patient.create",
        "patient.edit",
        "appointment.view",
        "appointment.create",
        "rehab.plan.view",
        "therapy.progress.view",
        "pharmacy.inventory",
        "billing.view",
        "billing.manage",
        "finance.reports",
        "beds.view",
        "beds.manage",
        "analytics.business",
        "analytics.operational",
        "staff.manage",
        "roles.manage",
        "branches.manage",
        "audit.view",
        "settings.manage",
    ),
    UserRole.DOCTOR: (
        "patient.view",
        "patient.edit",
        "patient.clinical.view",
        "patient.clinical.edit",
        "appointment.view",
        "appointment.create",
        "consultation.manage",
        "prescription.create",
        "rehab.plan.view",
        "rehab.plan.manage",
        "therapy.progress.view",
        "beds.view",
        "analytics.operational",
    ),
    UserRole.THERAPIST: (
        "patient.view",
        "patient.clinical.view",
        "appointment.view",
        "rehab.plan.view",
        "rehab.plan.manage",
        "therapy.session.manage",
        "therapy.progress.view",
        "analytics.operational",
    ),
    UserRole.NURSE: (
        "patient.view",
        "patient.clinical.view",
        "appointment.view",
        "vitals.record",
        "nursing.tasks",
        "rehab.plan.view",
        "beds.view",
        "beds.manage",
    ),
    UserRole.PHARMACIST: (
        "patient.view",
        "prescription.dispense",
        "pharmacy.inventory",
        "pharmacy.pos",
        "billing.view",
    ),
    UserRole.RECEPTIONIST: (
        "patient.view",
        "patient.create",
        "patient.edit",
        "appointment.view",
        "appointment.create",
        "appointment.checkin",
        "billing.view",
        "billing.manage",
        "beds.view",
    ),
    UserRole.ACCOUNTANT: (
        "patient.view",
        "billing.view",
        "billing.manage",
        "payments.manage",
        "expenses.manage",
        "finance.reports",
        "analytics.business",
    ),
}

ALL_PERMISSION_KEYS = tuple(key for key, _, _ in PERMISSION_CATALOGUE)
