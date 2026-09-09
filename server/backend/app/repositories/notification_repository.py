"""Data access for notifications and global search.

Both are ownership-scoped rather than branch-scoped, and in different ways. A
notification belongs to exactly one user, so every query here is filtered on
that user's id and there is no parameter to ask for anyone else's. Search is
scoped the way each underlying module already scopes itself.

Search runs entirely in PostgreSQL with a per-category `LIMIT`. The palette is
reachable from every screen and fires on each keystroke, so pulling rows into
Python to filter them would be the most-hit slow path in the application.
"""

from __future__ import annotations

import uuid as uuid_lib

from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session

from app.core.enums import UserRole, UserStatus
from app.models.billing import Invoice
from app.models.appointment import Appointment
from app.models.notification import Notification
from app.models.patient import Patient
from app.models.pharmacy import Medicine, Prescription
from app.models.user import User

#: No search ever returns more than this per category, whatever is asked for.
MAX_PER_CATEGORY = 20


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def list_for_user(
    db: Session,
    user_id: uuid_lib.UUID,
    *,
    unread_only: bool = False,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[Notification], int]:
    stmt = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        stmt = stmt.where(Notification.read.is_(False))

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(Notification.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(stmt.order_by(Notification.created_at.desc()).offset(offset).limit(limit))
        .scalars()
        .all()
    )
    return list(rows), total


def unread_count(db: Session, user_id: uuid_lib.UUID) -> int:
    """Served by `ix_notifications_user_read_created` — an index-only count."""
    return int(
        db.execute(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id, Notification.read.is_(False)
            )
        ).scalar_one()
    )


def get_for_user(
    db: Session, user_id: uuid_lib.UUID, notification_id: uuid_lib.UUID
) -> Notification | None:
    """Ownership is part of the lookup, not a check after it."""
    return db.execute(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user_id
        )
    ).scalar_one_or_none()


def mark_read(db: Session, user_id: uuid_lib.UUID, notification_id: uuid_lib.UUID) -> int:
    """Mark one as read. Returns how many rows actually changed.

    Filtered on `read is False` as well as the id, so marking an already-read
    alert reports zero rather than pretending to have done work. The user id is
    part of the WHERE clause, so one account cannot mark another's alerts read
    even with a valid notification id.

    There is no `read_at`: the table has no such column and nothing in the UI
    shows when an alert was acknowledged. Adding one would be schema nobody
    reads.
    """
    result = db.execute(
        Notification.__table__.update()
        .where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
            Notification.read.is_(False),
        )
        .values(read=True)
    )
    return int(result.rowcount or 0)


def mark_all_read(db: Session, user_id: uuid_lib.UUID) -> int:
    result = db.execute(
        Notification.__table__.update()
        .where(Notification.user_id == user_id, Notification.read.is_(False))
        .values(read=True)
    )
    return int(result.rowcount or 0)


# ---------------------------------------------------------------------------
# Global search
# ---------------------------------------------------------------------------


def _ranked(column, term: str, exact: str):
    """Order by how good the match is, not just that it matched.

    Exact code first, then exact name, then prefix, then anything containing the
    term. Someone typing a full patient number wants that patient at the top,
    not whichever row the planner happened to return first.
    """
    return case(
        (func.lower(column) == exact, 0),
        (func.lower(column).like(f"{exact}%"), 1),
        else_=2,
    )


def search_patients(
    db: Session, term: str, branch_ids: list[uuid_lib.UUID] | None, limit: int
) -> list[Patient]:
    exact = term.strip().lower()
    like = f"%{exact}%"
    full_name = func.lower(Patient.first_name + " " + Patient.last_name)

    stmt = select(Patient).where(
        or_(
            func.lower(Patient.patient_number).like(like),
            full_name.like(like),
            func.replace(func.coalesce(Patient.phone, ""), " ", "").like(
                f"%{exact.replace(' ', '')}%"
            ),
        )
    )
    if branch_ids is not None:
        if not branch_ids:
            return []
        stmt = stmt.where(Patient.branch_id.in_(branch_ids))

    # An exact patient number outranks everything else.
    rank = case(
        (func.lower(Patient.patient_number) == exact, 0),
        (full_name == exact, 1),
        (full_name.like(f"{exact}%"), 2),
        else_=3,
    )
    return list(
        db.execute(stmt.order_by(rank, full_name).limit(limit)).unique().scalars().all()
    )


def search_staff(
    db: Session, term: str, branch_ids: list[uuid_lib.UUID] | None, limit: int
) -> list[User]:
    exact = term.strip().lower()
    like = f"%{exact}%"
    full_name = func.lower(User.first_name + " " + User.last_name)

    stmt = select(User).where(
        User.status == UserStatus.ACTIVE,
        or_(full_name.like(like), func.lower(User.email).like(like), func.lower(User.user_number).like(like)),
    )
    if branch_ids is not None:
        if not branch_ids:
            return []
        stmt = stmt.where(User.branch_id.in_(branch_ids))

    return list(
        db.execute(stmt.order_by(_ranked(User.first_name + " " + User.last_name, like, exact), full_name).limit(limit))
        .unique()
        .scalars()
        .all()
    )


def search_medicines(db: Session, term: str, limit: int) -> list[Medicine]:
    exact = term.strip().lower()
    like = f"%{exact}%"
    stmt = select(Medicine).where(
        Medicine.is_active.is_(True),
        or_(
            func.lower(Medicine.name).like(like),
            func.lower(func.coalesce(Medicine.generic_name, "")).like(like),
            func.lower(Medicine.medicine_number).like(like),
        ),
    )
    return list(
        db.execute(stmt.order_by(_ranked(Medicine.name, like, exact), Medicine.name).limit(limit))
        .unique()
        .scalars()
        .all()
    )


def _patient_scoped(stmt: Select, model, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    if branch_ids is None:
        return stmt
    stmt = stmt.join(Patient, model.patient_id == Patient.id)
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Patient.branch_id.in_(branch_ids))


def search_appointments(
    db: Session, term: str, branch_ids: list[uuid_lib.UUID] | None, limit: int
) -> list[Appointment]:
    like = f"%{term.strip().lower()}%"
    stmt = _patient_scoped(select(Appointment), Appointment, branch_ids)
    if branch_ids is None:
        stmt = stmt.join(Patient, Appointment.patient_id == Patient.id)
    stmt = stmt.where(
        or_(
            func.lower(Appointment.appointment_number).like(like),
            func.lower(Patient.first_name + " " + Patient.last_name).like(like),
            func.lower(Patient.patient_number).like(like),
        )
    )
    return list(
        db.execute(stmt.order_by(Appointment.appointment_date.desc()).limit(limit))
        .unique()
        .scalars()
        .all()
    )


def search_prescriptions(
    db: Session, term: str, branch_ids: list[uuid_lib.UUID] | None, limit: int
) -> list[Prescription]:
    like = f"%{term.strip().lower()}%"
    stmt = _patient_scoped(select(Prescription), Prescription, branch_ids)
    if branch_ids is None:
        stmt = stmt.join(Patient, Prescription.patient_id == Patient.id)
    stmt = stmt.where(
        or_(
            func.lower(Prescription.prescription_number).like(like),
            func.lower(Patient.first_name + " " + Patient.last_name).like(like),
            func.lower(Patient.patient_number).like(like),
        )
    )
    return list(
        db.execute(stmt.order_by(Prescription.created_at.desc()).limit(limit))
        .unique()
        .scalars()
        .all()
    )


def search_invoices(
    db: Session, term: str, branch_ids: list[uuid_lib.UUID] | None, limit: int
) -> list[Invoice]:
    like = f"%{term.strip().lower()}%"
    stmt = _patient_scoped(select(Invoice), Invoice, branch_ids)
    if branch_ids is None:
        stmt = stmt.join(Patient, Invoice.patient_id == Patient.id)
    stmt = stmt.where(
        or_(
            func.lower(Invoice.invoice_number).like(like),
            func.lower(Patient.first_name + " " + Patient.last_name).like(like),
            func.lower(Patient.patient_number).like(like),
        )
    )
    return list(
        db.execute(stmt.order_by(Invoice.issued_on.desc()).limit(limit)).unique().scalars().all()
    )
