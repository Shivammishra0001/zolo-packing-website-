"""Reports and exports.

Only the reports the frontend actually draws. There is no generic reporting
engine here and no query language — each endpoint answers one screen, with the
filters that screen already has.

Every response is an aggregate. None of these routes can return a record, which
is what stops a report from becoming a way around the permissions on the module
that owns the underlying rows.

Permission keys are the ones the frontend already defines. Financial reports
need `finance.reports`; clinical and operational ones need the same key the
module they summarise needs.
"""

from __future__ import annotations

from datetime import date as date_type
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.core.dependencies import (
    CurrentPermissions,
    DbSession,
    require_permission,
)
from app.models.user import User
from app.schemas.report import (
    AppointmentReport,
    IpdReport,
    PatientReport,
    PaymentReport,
    TherapyReport,
)
from app.services import report_service as service

router = APIRouter(tags=["Reports"])

_FORBIDDEN = {
    "description": "The caller lacks the permission this report's data needs",
    "content": {
        "application/json": {
            "example": {
                "detail": "You do not have permission to perform this action.",
                "code": "insufficient_permission",
            }
        }
    },
}

_WINDOW = "Defaults to the window the matching chart shows."


@router.get(
    "/patients",
    response_model=PatientReport,
    summary="Patient volume",
    description=(
        "New registrations against returning patients, month by month, plus the "
        "total on file.\n\n"
        "A patient registered and first seen in the same month counts once, as "
        "new — otherwise every first visit would appear in both series. Months "
        "with no activity are returned as zero columns rather than omitted."
    ),
    responses={403: _FORBIDDEN},
)
def patient_report(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("patient.view"))],
    start_date: Annotated[date_type | None, Query(description=_WINDOW)] = None,
    end_date: date_type | None = None,
) -> PatientReport:
    return service.patient_report(
        db, user=user, permissions=permissions, start=start_date, end=end_date
    )


@router.get(
    "/appointments",
    response_model=AppointmentReport,
    summary="Appointment activity",
    description="Counts by status and by day, aggregated in SQL.",
    responses={403: _FORBIDDEN},
)
def appointment_report(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("appointment.view"))],
    start_date: Annotated[date_type | None, Query(description=_WINDOW)] = None,
    end_date: date_type | None = None,
) -> AppointmentReport:
    return service.appointment_report(
        db, user=user, permissions=permissions, start=start_date, end=end_date
    )


@router.get(
    "/therapy",
    response_model=TherapyReport,
    summary="Therapy capacity and workload",
    description=(
        "Sessions delivered against sessions booked, week by week, and the same "
        "pair per therapist."
    ),
    responses={403: _FORBIDDEN},
)
def therapy_report(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("therapy.progress.view"))],
    start_date: Annotated[date_type | None, Query(description=_WINDOW)] = None,
    end_date: date_type | None = None,
) -> TherapyReport:
    return service.therapy_report(
        db, user=user, permissions=permissions, start=start_date, end=end_date
    )


@router.get(
    "/ipd",
    response_model=IpdReport,
    summary="Occupancy",
    description=(
        "Beds in service, how many are occupied now, and the daily trend.\n\n"
        "The trend counts stays whose span **contains** each day rather than "
        "stays that began on it — a fortnight-long admission occupies a bed for "
        "a fortnight, not for one afternoon."
    ),
    responses={403: _FORBIDDEN},
)
def ipd_report(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("beds.view"))],
    start_date: Annotated[date_type | None, Query(description=_WINDOW)] = None,
    end_date: date_type | None = None,
) -> IpdReport:
    return service.ipd_report(
        db, user=user, permissions=permissions, start=start_date, end=end_date
    )


@router.get(
    "/payments",
    response_model=PaymentReport,
    summary="Payment mix",
    description="Settled money by how it arrived. Defaults to today.",
    responses={403: _FORBIDDEN},
)
def payment_report(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("billing.view"))],
    start_date: Annotated[date_type | None, Query(description=_WINDOW)] = None,
    end_date: date_type | None = None,
) -> PaymentReport:
    return service.payment_report(
        db, user=user, permissions=permissions, start=start_date, end=end_date
    )


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------


@router.get(
    "/appointments/export",
    summary="Appointment activity as CSV",
    description=(
        "The same aggregate as the JSON report, as a downloadable file. Values "
        "are written through a CSV writer, so a name containing a comma is "
        "quoted rather than shifting every column after it."
    ),
    response_class=Response,
    responses={
        200: {"content": {"text/csv": {}}, "description": "A CSV file"},
        403: _FORBIDDEN,
    },
)
def export_appointments(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("appointment.view"))],
    start_date: date_type | None = None,
    end_date: date_type | None = None,
) -> Response:
    report = service.appointment_report(
        db, user=user, permissions=permissions, start=start_date, end=end_date
    )
    body = service.to_csv(
        ["Date", "Appointments"], [[row.date.isoformat(), row.count] for row in report.byDay]
    )
    return _csv_response(body, service.export_filename("appointments", report.window))


@router.get(
    "/payments/export",
    summary="Payment mix as CSV",
    response_class=Response,
    responses={
        200: {"content": {"text/csv": {}}, "description": "A CSV file"},
        403: _FORBIDDEN,
    },
)
def export_payments(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("finance.reports"))],
    start_date: date_type | None = None,
    end_date: date_type | None = None,
) -> Response:
    report = service.payment_report(
        db, user=user, permissions=permissions, start=start_date, end=end_date
    )
    body = service.to_csv(
        ["Method", "Amount", "Payments"],
        [[row.method.display, f"{row.amount:.2f}", row.count] for row in report.byMethod],
    )
    return _csv_response(body, service.export_filename("payments", report.window))


@router.get(
    "/therapy/export",
    summary="Therapist workload as CSV",
    response_class=Response,
    responses={
        200: {"content": {"text/csv": {}}, "description": "A CSV file"},
        403: _FORBIDDEN,
    },
)
def export_therapy(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("therapy.progress.view"))],
    start_date: date_type | None = None,
    end_date: date_type | None = None,
) -> Response:
    report = service.therapy_report(
        db, user=user, permissions=permissions, start=start_date, end=end_date
    )
    body = service.to_csv(
        ["Therapist", "Booked", "Completed"],
        [[row.therapist, row.booked, row.completed] for row in report.workload],
    )
    return _csv_response(body, service.export_filename("therapist-workload", report.window))


def _csv_response(body: str, filename: str) -> Response:
    """A real file download, not a JSON string a client has to unwrap."""
    return Response(
        content=body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
