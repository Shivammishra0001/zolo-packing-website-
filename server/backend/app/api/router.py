"""Central API router.

Domain routers are registered here as each module is implemented, so
``main.py`` never needs to change again. The commented block is the planned
surface from the frontend analysis — it is intentionally not implemented yet.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api import (
    admin,
    ai,
    appointments,
    auth,
    billing,
    consultations,
    health,
    labs,
    notifications,
    nursing,
    patients,
    pharmacy,
    reports,
    prescriptions,
    rehab,
    therapy,
)

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(patients.router, prefix="/patients", tags=["Patients"])
api_router.include_router(
    appointments.router, prefix="/appointments", tags=["Appointments"]
)
api_router.include_router(
    consultations.router, prefix="/consultations", tags=["Consultations"]
)
api_router.include_router(labs.router, prefix="/labs", tags=["Labs"])
api_router.include_router(
    prescriptions.router, prefix="/prescriptions", tags=["Prescriptions"]
)
api_router.include_router(rehab.router, prefix="/rehab", tags=["Rehabilitation"])
api_router.include_router(therapy.router, prefix="/therapy", tags=["Therapy"])
# The exercise library is its own top-level resource, not a therapy sub-path.
api_router.include_router(therapy.exercises, prefix="/exercises", tags=["Exercise Library"])
api_router.include_router(pharmacy.router, prefix="/pharmacy", tags=["Pharmacy"])
# Medicines are a top-level resource, not a pharmacy sub-path.
api_router.include_router(pharmacy.medicines, prefix="/medicines", tags=["Pharmacy"])
api_router.include_router(
    pharmacy.batches, prefix="/medicine-batches", tags=["Pharmacy"]
)
# Dispensing hangs off the prescription it fulfils.
api_router.include_router(
    pharmacy.dispensing, prefix="/prescriptions", tags=["Pharmacy"]
)

api_router.include_router(nursing.router, prefix="/nursing", tags=["Nursing"])
api_router.include_router(nursing.wards, prefix="/wards", tags=["Wards & Beds"])
api_router.include_router(nursing.beds, prefix="/beds", tags=["Wards & Beds"])
# Admissions are their own resource: reception admits, the ward discharges.
api_router.include_router(nursing.admissions, prefix="/admissions", tags=["Admissions"])

api_router.include_router(billing.router, prefix="/billing", tags=["Billing"])
# Invoices, payments and expenses are top-level resources, not billing sub-paths:
# reception raises a bill, the accountant owns the ledger behind it.
api_router.include_router(billing.invoices, prefix="/invoices", tags=["Invoices"])
api_router.include_router(billing.payments, prefix="/payments", tags=["Payments"])
api_router.include_router(billing.expenses, prefix="/expenses", tags=["Expenses"])

api_router.include_router(admin.router, prefix="/admin", tags=["Administration"])
api_router.include_router(admin.users, prefix="/users", tags=["Staff"])
api_router.include_router(admin.roles, prefix="/roles", tags=["Roles & Permissions"])
api_router.include_router(admin.branches, prefix="/branches", tags=["Branches"])
api_router.include_router(admin.settings_router, prefix="/settings", tags=["Settings"])
api_router.include_router(admin.audit, prefix="/audit-logs", tags=["Audit"])

api_router.include_router(
    notifications.router, prefix="/notifications", tags=["Notifications"]
)
# Search is a top-level verb, not a sub-resource of anything.
api_router.include_router(notifications.search_router, prefix="/search", tags=["Search"])

api_router.include_router(reports.router, prefix="/reports", tags=["Reports"])

# The AI layer is mounted last because nothing else depends on it. Removing
# this one line disables every AI feature and leaves the rest of the API
# working exactly as before.
api_router.include_router(ai.router, prefix="/ai", tags=["AI"])

# Registered in later steps, in this order:
#
#   api_router.include_router(dashboard.router,     prefix="/dashboard",     tags=["Dashboard"])
#   api_router.include_router(reports.router,       prefix="/reports",       tags=["Reports"])
#   api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
#   api_router.include_router(audit.router,         prefix="/audit",         tags=["Audit"])
