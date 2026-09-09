"""Reports, CSV exports and the invoice PDF.

Reports answer aggregates, never rows. That is what stops one from becoming a
back door into records the caller could not read through the module that owns
them — there is no shape in `schemas/report.py` that can carry a patient's
notes or an invoice's line items.

Series are zero-filled across their whole window before they are returned. A
chart with a month missing reads as a collapse rather than as no activity, and
the frontend should not have to reconstruct the calendar to find out which.
"""

from __future__ import annotations

import calendar
import csv
import io
import logging
from datetime import date as date_type, datetime, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User
from app.repositories import report_repository as repo
from app.schemas.report import (
    AppointmentReport,
    DayCount,
    IpdReport,
    MethodBreakdown,
    OccupancyPoint,
    PatientReport,
    PatientVolumePoint,
    PaymentReport,
    ReportWindow,
    StatusCount,
    TherapistLoad,
    TherapyReport,
    TherapyWeekPoint,
)
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

ZERO = Decimal("0.00")

#: How far back a report looks when the caller names no window. Six months
#: matches every chart the frontend draws.
DEFAULT_MONTHS = 6


def _today() -> date_type:
    """The clinic's date, not the server's."""
    return datetime.now(settings.clinic_tz).date()


def _window(start: date_type | None, end: date_type | None, months: int = DEFAULT_MONTHS) -> ReportWindow:
    finish = end or _today()
    if start is not None:
        return ReportWindow(start=start, end=finish)

    first = finish.replace(day=1)
    for _ in range(max(0, months - 1)):
        first = (first - timedelta(days=1)).replace(day=1)
    return ReportWindow(start=first, end=finish)


def _months_between(start: date_type, end: date_type) -> list[date_type]:
    cursor = start.replace(day=1)
    out: list[date_type] = []
    while cursor <= end:
        out.append(cursor)
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out


def _month_label(day: date_type) -> str:
    """"Aug 26" — the format every chart in this application uses."""
    return f"{calendar.month_abbr[day.month]} {day:%y}"


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


def patient_report(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    start: date_type | None = None,
    end: date_type | None = None,
) -> PatientReport:
    branch_ids = visible_branch_ids(db, user, permissions)
    window = _window(start, end)

    counted = {
        month: (new, returning)
        for month, new, returning in repo.patient_volume_by_month(
            db, branch_ids, window.start, window.end
        )
    }

    return PatientReport(
        window=window,
        totalPatients=repo.count_patients(db, branch_ids),
        volume=[
            PatientVolumePoint(
                month=_month_label(month),
                newPatients=counted.get(month, (0, 0))[0],
                returning=counted.get(month, (0, 0))[1],
            )
            for month in _months_between(window.start, window.end)
        ],
    )


def appointment_report(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    start: date_type | None = None,
    end: date_type | None = None,
    doctor_id=None,
) -> AppointmentReport:
    branch_ids = visible_branch_ids(db, user, permissions)
    window = _window(start, end, months=1)

    by_status = repo.appointments_by_status(db, branch_ids, window.start, window.end, doctor_id)
    by_day = repo.appointments_by_day(db, branch_ids, window.start, window.end)

    return AppointmentReport(
        window=window,
        total=sum(count for _, count in by_status),
        byStatus=[StatusCount(status=status, count=count) for status, count in by_status],
        byDay=[DayCount(date=day, count=count) for day, count in by_day],
    )


def therapy_report(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    start: date_type | None = None,
    end: date_type | None = None,
) -> TherapyReport:
    branch_ids = visible_branch_ids(db, user, permissions)
    window = _window(start, end, months=2)

    weeks = repo.therapy_by_week(db, branch_ids, window.start, window.end)
    load = repo.therapist_workload(db, branch_ids, window.start, window.end)

    return TherapyReport(
        window=window,
        byWeek=[
            TherapyWeekPoint(week=f"Wk {index + 1}", sessions=done, capacity=booked)
            for index, (_start, done, booked) in enumerate(weeks)
        ],
        workload=[
            TherapistLoad(therapist=name, booked=booked, completed=done)
            for name, booked, done in load
        ],
    )


def ipd_report(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    start: date_type | None = None,
    end: date_type | None = None,
) -> IpdReport:
    branch_ids = visible_branch_ids(db, user, permissions)
    today = _today()
    # The occupancy chart shows a week, so that is the default window.
    window = ReportWindow(start=start or today - timedelta(days=6), end=end or today)

    total, occupied = repo.bed_totals(db, branch_ids)
    trend = repo.occupancy_by_day(db, branch_ids, window.start, window.end)

    return IpdReport(
        window=window,
        totalBeds=total,
        occupiedNow=occupied,
        occupancyRate=round(occupied / total * 100) if total else 0,
        trend=[
            OccupancyPoint(
                date=day,
                # "Mon" — what the chart's x-axis renders.
                day=day.strftime("%a"),
                occupancy=count,
                capacity=total,
            )
            for day, count in trend
        ],
    )


def payment_report(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    start: date_type | None = None,
    end: date_type | None = None,
) -> PaymentReport:
    branch_ids = visible_branch_ids(db, user, permissions)
    today = _today()
    window = ReportWindow(start=start or today, end=end or today)

    rows = repo.payments_by_method(db, branch_ids, window.start, window.end)
    return PaymentReport(
        window=window,
        total=sum((amount for _, amount, _c in rows), ZERO),
        byMethod=[
            MethodBreakdown(method=method, amount=amount, count=count)
            for method, amount, count in rows
        ],
    )


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------


def to_csv(headers: list[str], rows: list[list]) -> str:
    """Render a table as CSV.

    `QUOTE_MINIMAL` with the default dialect, so a value containing a comma or
    a newline — a vendor name, an address — is quoted rather than shifting
    every column after it. Written through `csv` rather than joined by hand for
    exactly that reason.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return buffer.getvalue()


def export_filename(kind: str, window: ReportWindow) -> str:
    """A filename that says what the file is and what it covers."""
    if window.start == window.end:
        return f"{kind}-{window.start:%Y-%m-%d}.csv"
    return f"{kind}-{window.start:%Y-%m-%d}-to-{window.end:%Y-%m-%d}.csv"
