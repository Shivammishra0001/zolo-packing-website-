"""Aggregates behind the reports screens.

Every figure here is a `GROUP BY` in PostgreSQL. A report covering a year of
appointments or therapy sessions would be the worst possible thing to compute
by pulling rows into Python, and these are exactly the queries that grow with
the clinic.

Nothing in this module returns a row: reports answer counts, sums and averages,
so a report can never become a way to read records the caller could not read
through the module that owns them.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import DateTime, Select, func, select
from sqlalchemy.orm import Session

from app.core.enums import (
    AppointmentStatus,
    PaymentMethod,
    PaymentStatus,
    TherapySessionStatus,
)
from app.models.appointment import Appointment
from app.models.billing import Payment
from app.models.patient import Patient
from app.models.therapy import TherapySession
from app.models.user import User
from app.models.ward import Admission, Bed, Ward

ZERO = Decimal("0.00")


def _money(value) -> Decimal:
    return Decimal(value) if value is not None else ZERO


def _patient_scoped(stmt: Select, model, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    if branch_ids is None:
        return stmt
    stmt = stmt.join(Patient, model.patient_id == Patient.id)
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Patient.branch_id.in_(branch_ids))


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------


def patient_volume_by_month(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> list[tuple[date_type, int, int]]:
    """New registrations against returning patients, month by month.

    "New" is a patient whose registration falls in that month; "returning" is
    anyone else who had an appointment in it. A patient registered and seen in
    the same month counts once, as new — otherwise the two series would
    double-count every first visit.
    """
    bucket = func.date_trunc("month", func.cast(Appointment.appointment_date, DateTime))

    seen = _patient_scoped(
        select(
            bucket.label("month"),
            Appointment.patient_id.label("patient_id"),
        ),
        Appointment,
        branch_ids,
    ).where(
        Appointment.appointment_date >= start,
        Appointment.appointment_date <= end,
    )
    if branch_ids is None:
        seen = seen.join(Patient, Appointment.patient_id == Patient.id)
    seen = seen.add_columns(Patient.registration_date.label("registered")).distinct().subquery()

    stmt = select(
        seen.c.month,
        func.count().filter(
            func.date_trunc("month", func.cast(seen.c.registered, DateTime)) == seen.c.month
        ),
        func.count().filter(
            func.date_trunc("month", func.cast(seen.c.registered, DateTime)) != seen.c.month
        ),
    ).group_by(seen.c.month)

    return [(row[0].date(), int(row[1]), int(row[2])) for row in db.execute(stmt).all()]


def count_patients(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> int:
    stmt = select(func.count(Patient.id))
    if branch_ids is not None:
        if not branch_ids:
            return 0
        stmt = stmt.where(Patient.branch_id.in_(branch_ids))
    return int(db.execute(stmt).scalar_one())


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------


def appointments_by_status(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
    doctor_id: uuid_lib.UUID | None = None,
) -> list[tuple[AppointmentStatus, int]]:
    stmt = _patient_scoped(
        select(Appointment.status, func.count(Appointment.id)), Appointment, branch_ids
    ).where(Appointment.appointment_date >= start, Appointment.appointment_date <= end)
    if doctor_id is not None:
        stmt = stmt.where(Appointment.doctor_id == doctor_id)
    return [(status, int(count)) for status, count in db.execute(stmt.group_by(Appointment.status)).all()]


def appointments_by_day(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> list[tuple[date_type, int]]:
    stmt = (
        _patient_scoped(
            select(Appointment.appointment_date, func.count(Appointment.id)),
            Appointment,
            branch_ids,
        )
        .where(Appointment.appointment_date >= start, Appointment.appointment_date <= end)
        .group_by(Appointment.appointment_date)
        .order_by(Appointment.appointment_date)
    )
    return [(day, int(count)) for day, count in db.execute(stmt).all()]


# ---------------------------------------------------------------------------
# Therapy
# ---------------------------------------------------------------------------


def therapy_by_week(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> list[tuple[date_type, int, int]]:
    """Sessions delivered against sessions scheduled, week by week."""
    bucket = func.date_trunc("week", func.cast(TherapySession.session_date, DateTime))
    stmt = (
        _patient_scoped(
            select(
                bucket,
                func.count(TherapySession.id).filter(
                    TherapySession.status == TherapySessionStatus.COMPLETED
                ),
                func.count(TherapySession.id),
            ),
            TherapySession,
            branch_ids,
        )
        .where(TherapySession.session_date >= start, TherapySession.session_date <= end)
        .group_by(bucket)
        .order_by(bucket)
    )
    return [(row[0].date(), int(row[1]), int(row[2])) for row in db.execute(stmt).all()]


def therapist_workload(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> list[tuple[str, int, int]]:
    """Sessions booked and completed per therapist over the window."""
    stmt = (
        _patient_scoped(
            select(
                User.first_name + " " + User.last_name,
                func.count(TherapySession.id),
                func.count(TherapySession.id).filter(
                    TherapySession.status == TherapySessionStatus.COMPLETED
                ),
            ),
            TherapySession,
            branch_ids,
        )
        .join(User, TherapySession.therapist_id == User.id)
        .where(TherapySession.session_date >= start, TherapySession.session_date <= end)
        .group_by(User.first_name, User.last_name)
        .order_by(func.count(TherapySession.id).desc())
    )
    return [(name, int(booked), int(done)) for name, booked, done in db.execute(stmt).all()]


# ---------------------------------------------------------------------------
# Beds and occupancy
# ---------------------------------------------------------------------------


def bed_totals(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> tuple[int, int]:
    """Beds in service, and how many are occupied right now."""
    stmt = select(func.count(Bed.id), func.count(Bed.id).filter(Bed.patient_id.is_not(None)))
    if branch_ids is not None:
        if not branch_ids:
            return 0, 0
        stmt = stmt.join(Ward, Bed.ward_id == Ward.id).where(Ward.branch_id.in_(branch_ids))
    total, occupied = db.execute(stmt).one()
    return int(total), int(occupied)


def occupancy_by_day(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> list[tuple[date_type, int]]:
    """How many beds were occupied on each day of the window.

    A stay covers a range, so this counts admissions whose span contains the
    day rather than admissions that started on it — otherwise a fortnight-long
    stay would show as one occupied bed on one day and none thereafter.
    """
    # generate_series with a day interval has no clean ORM spelling, and the
    # join it drives is the whole query — so this one is written as SQL.
    from sqlalchemy import text

    scope = ""
    params: dict = {"start": start, "end": end}
    if branch_ids is not None:
        if not branch_ids:
            return []
        scope = " AND p.branch_id = ANY(:branches)"
        params["branches"] = [str(b) for b in branch_ids]

    rows = db.execute(
        text(
            f"""
            SELECT CAST(d.day AS date) AS day, COUNT(a.id) AS occupied
            -- CAST rather than ::, which psycopg would read as a bind parameter.
            FROM generate_series(CAST(:start AS date), CAST(:end AS date), '1 day') AS d(day)
            LEFT JOIN admissions a
              ON a.admission_date <= d.day
             AND (a.discharge_date IS NULL OR a.discharge_date >= d.day)
            LEFT JOIN patients p ON p.id = a.patient_id
            WHERE TRUE{scope}
            GROUP BY d.day
            ORDER BY d.day
            """
        ),
        params,
    ).all()
    return [(row[0], int(row[1])) for row in rows]


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


def payments_by_method(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> list[tuple[PaymentMethod, Decimal, int]]:
    """Settled money by how it arrived, with the transaction count."""
    from app.models.billing import Invoice

    stmt = select(
        Payment.method, func.sum(Payment.amount), func.count(Payment.id)
    ).where(
        Payment.status == PaymentStatus.SETTLED,
        func.date(Payment.paid_at) >= start,
        func.date(Payment.paid_at) <= end,
    )
    if branch_ids is not None:
        if not branch_ids:
            return []
        stmt = stmt.join(Invoice, Payment.invoice_id == Invoice.id).join(
            Patient, Invoice.patient_id == Patient.id
        ).where(Patient.branch_id.in_(branch_ids))
    return [
        (method, _money(amount), int(count))
        for method, amount, count in db.execute(stmt.group_by(Payment.method)).all()
    ]
