"""Pharmacy data access: catalogue, batches, stock and sales.

Stock lives on batches, never on the medicine. Every read that precedes a
deduction takes a row lock, so two tills cannot both spend the same units.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import date as date_type, datetime, timedelta
from decimal import Decimal

from sqlalchemy import Integer, Select, func, or_, select, text
from sqlalchemy.orm import Session, selectinload

from app.core.enums import PrescriptionStatus
from app.models.pharmacy import (
    Medicine,
    MedicineBatch,
    PharmacySale,
    PharmacySaleItem,
    Prescription,
)

#: A batch inside this window counts as near expiry.
#:
#: Taken from the frontend: `NEAR_EXPIRY_DAYS = 45` in the original
#: `src/data/medicines.ts`. Not the 30 days a fresh implementation would pick —
#: the screens were built against 45 and changing it would silently reclassify
#: stock the pharmacist already knows about.
NEAR_EXPIRY_DAYS = 45


def _with_batches(stmt: Select) -> Select:
    return stmt.options(selectinload(Medicine.batches))


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------


def get_medicine(db: Session, medicine_id: uuid_lib.UUID) -> Medicine | None:
    return (
        db.execute(_with_batches(select(Medicine)).where(Medicine.id == medicine_id))
        .unique()
        .scalar_one_or_none()
    )


def get_medicine_by_number(db: Session, number: str) -> Medicine | None:
    return (
        db.execute(
            _with_batches(select(Medicine)).where(Medicine.medicine_number == number.upper())
        )
        .unique()
        .scalar_one_or_none()
    )


def find_medicine_by_name(db: Session, name: str) -> Medicine | None:
    return (
        db.execute(
            _with_batches(select(Medicine)).where(func.lower(Medicine.name) == name.strip().lower())
        )
        .unique()
        .scalar_one_or_none()
    )


def list_medicines(
    db: Session,
    *,
    search: str | None = None,
    category: str | None = None,
    active: bool | None = True,
    offset: int = 0,
    limit: int = 100,
) -> tuple[list[Medicine], int]:
    """The catalogue, filtered in SQL — never loaded whole and filtered here.

    Search spans name, generic name, category and manufacturer, which is the
    set the pharmacy screens let a user type into.
    """
    stmt = select(Medicine)

    if search:
        term = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Medicine.name).like(term),
                func.lower(func.coalesce(Medicine.generic_name, "")).like(term),
                func.lower(func.coalesce(Medicine.category, "")).like(term),
                func.lower(func.coalesce(Medicine.manufacturer, "")).like(term),
            )
        )
    if category:
        stmt = stmt.where(func.lower(Medicine.category) == category.strip().lower())
    if active is not None:
        stmt = stmt.where(Medicine.is_active.is_(active))

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(Medicine.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(_with_batches(stmt).order_by(Medicine.name).offset(offset).limit(limit))
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


def all_medicines(db: Session, *, active: bool | None = True) -> list[Medicine]:
    """The whole catalogue with batches — for aggregate views and the dashboard."""
    rows, _ = list_medicines(db, active=active, limit=10_000)
    return rows


def categories(db: Session) -> list[str]:
    return [
        row
        for row in db.execute(
            select(Medicine.category)
            .where(Medicine.category.is_not(None), Medicine.is_active.is_(True))
            .distinct()
            .order_by(Medicine.category)
        )
        .scalars()
        .all()
    ]


def next_medicine_number(db: Session) -> int:
    """Next ``MED-####`` code, serialised so two additions cannot collide."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": "code:MED"})
    current = db.execute(
        select(
            func.coalesce(
                func.max(func.cast(func.split_part(Medicine.medicine_number, "-", 2), Integer)),
                2000,
            )
        ).where(Medicine.medicine_number.like("MED-%"))
    ).scalar_one()
    return int(current) + 1


# ---------------------------------------------------------------------------
# Batches
# ---------------------------------------------------------------------------


def get_batch(db: Session, batch_id: uuid_lib.UUID) -> MedicineBatch | None:
    return db.execute(
        select(MedicineBatch).where(MedicineBatch.id == batch_id)
    ).scalar_one_or_none()


def find_batch(db: Session, medicine_id: uuid_lib.UUID, batch_number: str) -> MedicineBatch | None:
    return db.execute(
        select(MedicineBatch).where(
            MedicineBatch.medicine_id == medicine_id,
            func.lower(MedicineBatch.batch_number) == batch_number.strip().lower(),
        )
    ).scalar_one_or_none()


def batches_for(db: Session, medicine_id: uuid_lib.UUID) -> list[MedicineBatch]:
    return list(
        db.execute(
            select(MedicineBatch)
            .where(MedicineBatch.medicine_id == medicine_id)
            .order_by(MedicineBatch.expiry_date)
        )
        .scalars()
        .all()
    )


def lock_dispensable_batches(
    db: Session, medicine_id: uuid_lib.UUID, on_date: date_type | None = None
) -> list[MedicineBatch]:
    """Batches this medicine can be issued from, locked and in FEFO order.

    ``FOR UPDATE`` is the whole point: it holds the rows until the transaction
    commits, so a second pharmacist reading the same stock blocks until the
    first has finished. Without it two tills can both see 10 units and both
    sell 8.

    Expired batches are excluded here rather than filtered later, so no code
    path can accidentally issue from one.
    """
    today = on_date or date_type.today()
    return list(
        db.execute(
            select(MedicineBatch)
            .where(
                MedicineBatch.medicine_id == medicine_id,
                MedicineBatch.quantity > 0,
                MedicineBatch.expiry_date >= today,
            )
            # First expiry, first out.
            .order_by(MedicineBatch.expiry_date, MedicineBatch.created_at)
            .with_for_update()
        )
        .scalars()
        .all()
    )


def available_stock(db: Session, medicine_id: uuid_lib.UUID, on_date: date_type | None = None) -> int:
    """Units that could actually be issued — excludes expired batches."""
    today = on_date or date_type.today()
    return int(
        db.execute(
            select(func.coalesce(func.sum(MedicineBatch.quantity), 0)).where(
                MedicineBatch.medicine_id == medicine_id,
                MedicineBatch.expiry_date >= today,
            )
        ).scalar_one()
    )


def has_expired_stock(db: Session, medicine_id: uuid_lib.UUID) -> bool:
    return bool(
        db.execute(
            select(func.count(MedicineBatch.id)).where(
                MedicineBatch.medicine_id == medicine_id,
                MedicineBatch.quantity > 0,
                MedicineBatch.expiry_date < date_type.today(),
            )
        ).scalar_one()
    )


# ---------------------------------------------------------------------------
# Prescriptions
# ---------------------------------------------------------------------------

_PRESCRIPTION_LOCK = (
    "SELECT id FROM prescriptions WHERE id = :id FOR UPDATE"
)


def lock_prescription(db: Session, prescription_id: uuid_lib.UUID) -> None:
    """Serialise dispensing of one prescription.

    Two pharmacists working the same prescription would otherwise each read
    ``quantity_dispensed`` before the other's write and both issue the
    remainder.
    """
    db.execute(text(_PRESCRIPTION_LOCK), {"id": str(prescription_id)})


def pending_prescription_count(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> int:
    from app.models.patient import Patient

    stmt = select(func.count(Prescription.id)).where(
        Prescription.status.in_(
            (PrescriptionStatus.PENDING, PrescriptionStatus.PARTIALLY_DISPENSED)
        )
    )
    if branch_ids is not None:
        stmt = stmt.join(Patient, Prescription.patient_id == Patient.id)
        if not branch_ids:
            return 0
        stmt = stmt.where(Patient.branch_id.in_(branch_ids))
    return int(db.execute(stmt).scalar_one())


def dispensed_today(db: Session, on_date: date_type) -> tuple[int, int]:
    """(prescriptions touched, units issued) for one day."""
    from app.models.pharmacy import DispenseRecord

    row = db.execute(
        select(
            func.count(func.distinct(DispenseRecord.prescription_id)),
            func.coalesce(func.sum(DispenseRecord.quantity), 0),
        ).where(func.date(DispenseRecord.dispensed_at) == on_date)
    ).one()
    return int(row[0]), int(row[1])


# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------

_SALE_RELATIONS = (selectinload(PharmacySale.items).selectinload(PharmacySaleItem.batch),)


def get_sale(db: Session, sale_id: uuid_lib.UUID) -> PharmacySale | None:
    return (
        db.execute(select(PharmacySale).options(*_SALE_RELATIONS).where(PharmacySale.id == sale_id))
        .unique()
        .scalar_one_or_none()
    )


def get_sale_by_number(db: Session, number: str) -> PharmacySale | None:
    return (
        db.execute(
            select(PharmacySale)
            .options(*_SALE_RELATIONS)
            .where(PharmacySale.sale_number == number.upper())
        )
        .unique()
        .scalar_one_or_none()
    )


def list_sales(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[PharmacySale], int]:
    stmt = select(PharmacySale)

    if branch_ids is not None:
        if not branch_ids:
            return [], 0
        # A walk-in sale has no patient, so scoping runs on the till's branch.
        stmt = stmt.where(
            or_(PharmacySale.branch_id.in_(branch_ids), PharmacySale.branch_id.is_(None))
        )
    if date_from is not None:
        stmt = stmt.where(func.date(PharmacySale.created_at) >= date_from)
    if date_to is not None:
        stmt = stmt.where(func.date(PharmacySale.created_at) <= date_to)

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(PharmacySale.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(
            stmt.options(*_SALE_RELATIONS)
            .order_by(PharmacySale.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


def sales_totals(db: Session, on_date: date_type) -> tuple[Decimal, int, int]:
    """(revenue, orders, units) for one day."""
    row = db.execute(
        select(
            func.coalesce(func.sum(PharmacySale.total), 0),
            func.count(PharmacySale.id),
        ).where(func.date(PharmacySale.created_at) == on_date)
    ).one()

    units = db.execute(
        select(func.coalesce(func.sum(PharmacySaleItem.quantity), 0))
        .join(PharmacySale, PharmacySaleItem.sale_id == PharmacySale.id)
        .where(func.date(PharmacySale.created_at) == on_date)
    ).scalar_one()

    return Decimal(row[0]), int(row[1]), int(units)


def sales_trend(db: Session, days: int, through: date_type) -> list[tuple[date_type, Decimal, int]]:
    """Daily revenue and order count over a window, oldest first."""
    start = through - timedelta(days=days - 1)
    rows = db.execute(
        select(
            func.date(PharmacySale.created_at).label("day"),
            func.coalesce(func.sum(PharmacySale.total), 0),
            func.count(PharmacySale.id),
        )
        .where(
            func.date(PharmacySale.created_at) >= start,
            func.date(PharmacySale.created_at) <= through,
        )
        .group_by(text("day"))
        .order_by(text("day"))
    ).all()
    return [(r[0], Decimal(r[1]), int(r[2])) for r in rows]


def next_sale_number(db: Session) -> int:
    """Next ``POS-####`` code, under an advisory lock."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": "code:POS"})
    current = db.execute(
        select(
            func.coalesce(
                func.max(func.cast(func.split_part(PharmacySale.sale_number, "-", 2), Integer)),
                9000,
            )
        ).where(PharmacySale.sale_number.like("POS-%"))
    ).scalar_one()
    return int(current) + 1
