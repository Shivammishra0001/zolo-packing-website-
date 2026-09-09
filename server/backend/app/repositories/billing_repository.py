"""Data access for invoices, payments and expenses.

Every figure the finance screens show is aggregated here in PostgreSQL rather
than by pulling rows into Python and summing them. A clinic's payment table
grows without bound; a dashboard that loads it to add up one day's takings gets
slower every week it runs.

Two scoping rules apply, and they differ because the two records differ. An
invoice belongs to a patient, so it scopes through the patient's branch like
every other clinical record. An expense belongs to a branch directly.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import date as date_type, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Integer, Select, and_, func, literal, or_, select, text
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.enums import (
    ExpenseCategory,
    ExpenseStatus,
    InvoiceDepartment,
    InvoiceStatus,
    PaymentMethod,
    PaymentStatus,
)
from app.models.billing import Expense, Invoice, InvoiceItem, Payment
from app.models.patient import Patient
from app.models.pharmacy import PharmacySale

ZERO = Decimal("0.00")

#: An invoice that is neither fully paid nor written off still owes money.
#: There is no Cancelled status in this system — the frontend has none — so
#: "open" simply means not yet Paid.
OPEN_STATUSES = (InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE)

#: Money that actually arrived. A failed bank transfer is not revenue, and the
#: frontend's own collection figures exclude it.
REALISED_STATUSES = (PaymentStatus.SETTLED,)


def _money(value) -> Decimal:
    """Coalesce a SUM that matched no rows into a real zero."""
    return Decimal(value) if value is not None else ZERO


# ---------------------------------------------------------------------------
# Code allocation
# ---------------------------------------------------------------------------


def _next_suffix(db: Session, column, prefix: str, start: int, part: int) -> int:
    """Next value of a code's numeric suffix, serialised by an advisory lock.

    MAX of the suffix rather than COUNT: a gap left by a rolled-back
    transaction would make COUNT+1 collide with a code already issued. The lock
    is held for the rest of the transaction, so two tills raising invoices at
    the same instant cannot be handed the same number.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"code:{prefix}"})
    current = db.execute(
        select(
            func.coalesce(
                func.max(func.cast(func.split_part(column, "-", part), Integer)), start
            )
        ).where(column.like(f"{prefix}-%"))
    ).scalar_one()
    return int(current) + 1


def next_invoice_number(db: Session, year: int) -> int:
    """Next invoice sequence within a year.

    Invoice codes are year-scoped (``INV-2026-04412``), so the lock key and the
    MAX are both narrowed to the year — a new year restarts the run without
    colliding with the last one.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"code:INV:{year}"}
    )
    current = db.execute(
        select(
            func.coalesce(
                func.max(func.cast(func.split_part(Invoice.invoice_number, "-", 3), Integer)),
                4400,
            )
        ).where(Invoice.invoice_number.like(f"INV-{year}-%"))
    ).scalar_one()
    return int(current) + 1


def next_payment_number(db: Session) -> int:
    return _next_suffix(db, Payment.payment_number, "PAY", 9900, 2)


def next_expense_number(db: Session) -> int:
    return _next_suffix(db, Expense.expense_number, "EXP", 3300, 2)


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------

_INVOICE_RELATIONS = (
    joinedload(Invoice.patient),
    joinedload(Invoice.branch),
    selectinload(Invoice.items),
    selectinload(Invoice.payments).joinedload(Payment.collector),
)


def _invoice_visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    """Scope through the patient, as every other patient-owned record does."""
    if branch_ids is None:
        return stmt
    stmt = stmt.join(Patient, Invoice.patient_id == Patient.id)
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Patient.branch_id.in_(branch_ids))


def get_invoice(db: Session, invoice_id: uuid_lib.UUID) -> Invoice | None:
    return (
        db.execute(select(Invoice).options(*_INVOICE_RELATIONS).where(Invoice.id == invoice_id))
        .unique()
        .scalar_one_or_none()
    )


def get_invoice_by_number(db: Session, number: str) -> Invoice | None:
    return (
        db.execute(
            select(Invoice)
            .options(*_INVOICE_RELATIONS)
            .where(func.upper(Invoice.invoice_number) == number.strip().upper())
        )
        .unique()
        .scalar_one_or_none()
    )


def lock_invoice(db: Session, invoice_id: uuid_lib.UUID) -> Invoice | None:
    """Read an invoice for update.

    Held until the transaction commits, so two tills taking the last of a
    balance serialise: the first wins, the second re-reads and finds nothing
    outstanding. No eager loads — PostgreSQL refuses ``FOR UPDATE`` against the
    nullable side of an outer join, which a joinedload of an optional
    relationship produces.
    """
    return db.execute(
        select(Invoice)
        .where(Invoice.id == invoice_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def list_invoices(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    patient_id: uuid_lib.UUID | None = None,
    status: InvoiceStatus | None = None,
    department: InvoiceDepartment | None = None,
    outstanding_only: bool = False,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Invoice], int]:
    stmt = _invoice_visible(select(Invoice), branch_ids)

    if patient_id is not None:
        stmt = stmt.where(Invoice.patient_id == patient_id)
    if status is not None:
        stmt = stmt.where(Invoice.status == status)
    if department is not None:
        stmt = stmt.where(Invoice.department == department)
    if outstanding_only:
        stmt = stmt.where(Invoice.status.in_(OPEN_STATUSES))
    if date_from is not None:
        stmt = stmt.where(Invoice.issued_on >= date_from)
    if date_to is not None:
        stmt = stmt.where(Invoice.issued_on <= date_to)
    if search:
        term = f"%{search.strip().lower()}%"
        if branch_ids is None:
            stmt = stmt.join(Patient, Invoice.patient_id == Patient.id)
        stmt = stmt.where(
            or_(
                func.lower(Invoice.invoice_number).like(term),
                func.lower(Patient.first_name + " " + Patient.last_name).like(term),
                func.lower(Patient.patient_number).like(term),
            )
        )

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(Invoice.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(
            stmt.options(*_INVOICE_RELATIONS)
            .order_by(Invoice.issued_on.desc(), Invoice.invoice_number.desc())
            .offset(offset)
            .limit(limit)
        )
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


def invoices_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[Invoice]:
    rows, _ = list_invoices(db, branch_ids=None, patient_id=patient_id, limit=200)
    return rows


def clear_invoice_items(db: Session, invoice: Invoice) -> None:
    """Drop an invoice's lines through the relationship.

    A bulk DELETE would leave the deleted instances sitting in the loaded
    collection, and the next access to `invoice.items` would raise.
    """
    invoice.items.clear()
    db.flush()


def settled_total(db: Session, invoice_id: uuid_lib.UUID) -> Decimal:
    """What has actually been collected against one invoice.

    Summed in PostgreSQL under whatever lock the caller holds, so a payment
    committed by another transaction is either visible or excluded — never
    half-counted.
    """
    return _money(
        db.execute(
            select(func.sum(Payment.amount)).where(
                Payment.invoice_id == invoice_id,
                Payment.status.in_(REALISED_STATUSES),
            )
        ).scalar_one()
    )


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

_PAYMENT_RELATIONS = (
    joinedload(Payment.invoice).joinedload(Invoice.patient),
    joinedload(Payment.collector),
)


def _payment_visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    if branch_ids is None:
        return stmt
    stmt = stmt.join(Invoice, Payment.invoice_id == Invoice.id).join(
        Patient, Invoice.patient_id == Patient.id
    )
    if not branch_ids:
        return stmt.where(func.false())
    return stmt.where(Patient.branch_id.in_(branch_ids))


def get_payment(db: Session, payment_id: uuid_lib.UUID) -> Payment | None:
    return (
        db.execute(select(Payment).options(*_PAYMENT_RELATIONS).where(Payment.id == payment_id))
        .unique()
        .scalar_one_or_none()
    )


def get_payment_by_number(db: Session, number: str) -> Payment | None:
    return (
        db.execute(
            select(Payment)
            .options(*_PAYMENT_RELATIONS)
            .where(func.upper(Payment.payment_number) == number.strip().upper())
        )
        .unique()
        .scalar_one_or_none()
    )


def list_payments(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    invoice_id: uuid_lib.UUID | None = None,
    patient_id: uuid_lib.UUID | None = None,
    method: PaymentMethod | None = None,
    status: PaymentStatus | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Payment], int]:
    stmt = _payment_visible(select(Payment), branch_ids)

    if invoice_id is not None:
        stmt = stmt.where(Payment.invoice_id == invoice_id)
    if patient_id is not None:
        if branch_ids is None:
            stmt = stmt.join(Invoice, Payment.invoice_id == Invoice.id)
        stmt = stmt.where(Invoice.patient_id == patient_id)
    if method is not None:
        stmt = stmt.where(Payment.method == method)
    if status is not None:
        stmt = stmt.where(Payment.status == status)
    if date_from is not None:
        stmt = stmt.where(func.date(Payment.paid_at) >= date_from)
    if date_to is not None:
        stmt = stmt.where(func.date(Payment.paid_at) <= date_to)

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(Payment.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(
            stmt.options(*_PAYMENT_RELATIONS)
            .order_by(Payment.paid_at.desc(), Payment.payment_number.desc())
            .offset(offset)
            .limit(limit)
        )
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------

_EXPENSE_RELATIONS = (joinedload(Expense.branch),)


def _expense_visible(stmt: Select, branch_ids: list[uuid_lib.UUID] | None) -> Select:
    """Scope on the branch directly — an expense has no patient."""
    if branch_ids is None:
        return stmt
    if not branch_ids:
        return stmt.where(func.false())
    # An expense with no branch is organisation-wide — payroll, group cover. A
    # branch-bound user is not shown it, because none of it is attributable to
    # their site; whoever can see the whole organisation sees it instead.
    return stmt.where(Expense.branch_id.in_(branch_ids))


def get_expense(db: Session, expense_id: uuid_lib.UUID) -> Expense | None:
    return (
        db.execute(select(Expense).options(*_EXPENSE_RELATIONS).where(Expense.id == expense_id))
        .unique()
        .scalar_one_or_none()
    )


def get_expense_by_number(db: Session, number: str) -> Expense | None:
    return (
        db.execute(
            select(Expense)
            .options(*_EXPENSE_RELATIONS)
            .where(func.upper(Expense.expense_number) == number.strip().upper())
        )
        .unique()
        .scalar_one_or_none()
    )


def list_expenses(
    db: Session,
    *,
    branch_ids: list[uuid_lib.UUID] | None,
    category: ExpenseCategory | None = None,
    status: ExpenseStatus | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Expense], int]:
    stmt = _expense_visible(select(Expense), branch_ids)

    if category is not None:
        stmt = stmt.where(Expense.category == category)
    if status is not None:
        stmt = stmt.where(Expense.status == status)
    if date_from is not None:
        stmt = stmt.where(Expense.expense_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Expense.expense_date <= date_to)

    total = db.execute(
        select(func.count()).select_from(stmt.with_only_columns(Expense.id).subquery())
    ).scalar_one()

    rows = (
        db.execute(
            stmt.options(*_EXPENSE_RELATIONS)
            .order_by(Expense.expense_date.desc(), Expense.expense_number.desc())
            .offset(offset)
            .limit(limit)
        )
        .unique()
        .scalars()
        .all()
    )
    return list(rows), total


# ---------------------------------------------------------------------------
# Aggregates — all computed in PostgreSQL
# ---------------------------------------------------------------------------


def collected_between(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> Decimal:
    """Settled payment money in a closed date range."""
    stmt = _payment_visible(select(func.sum(Payment.amount)), branch_ids).where(
        Payment.status.in_(REALISED_STATUSES),
        func.date(Payment.paid_at) >= start,
        func.date(Payment.paid_at) <= end,
    )
    return _money(db.execute(stmt).scalar_one())


def count_payments_between(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
    *,
    status: PaymentStatus | None = None,
    exclude_failed: bool = False,
) -> int:
    stmt = _payment_visible(select(func.count(Payment.id)), branch_ids).where(
        func.date(Payment.paid_at) >= start, func.date(Payment.paid_at) <= end
    )
    if status is not None:
        stmt = stmt.where(Payment.status == status)
    if exclude_failed:
        stmt = stmt.where(Payment.status != PaymentStatus.FAILED)
    return int(db.execute(stmt).scalar_one())


def failed_payments(
    db: Session, branch_ids: list[uuid_lib.UUID] | None
) -> tuple[int, Decimal]:
    stmt = _payment_visible(
        select(func.count(Payment.id), func.sum(Payment.amount)), branch_ids
    ).where(Payment.status == PaymentStatus.FAILED)
    count, amount = db.execute(stmt).one()
    return int(count), _money(amount)


def collections_by_method(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> list[tuple[PaymentMethod, Decimal]]:
    """Settled money grouped by how it arrived — the donut on the till screen."""
    stmt = (
        _payment_visible(select(Payment.method, func.sum(Payment.amount)), branch_ids)
        .where(
            Payment.status.in_(REALISED_STATUSES),
            func.date(Payment.paid_at) >= start,
            func.date(Payment.paid_at) <= end,
        )
        .group_by(Payment.method)
    )
    return [(method, _money(amount)) for method, amount in db.execute(stmt).all()]


def outstanding_total(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> tuple[Decimal, int]:
    """What is still owed, and across how many invoices.

    The balance is `total - settled payments` per invoice, evaluated as a
    correlated subquery so PostgreSQL does the arithmetic. A credit balance
    (an invoice somehow over-collected) is floored at zero rather than
    subtracting from someone else's debt.
    """
    paid = (
        select(func.coalesce(func.sum(Payment.amount), 0))
        .where(
            Payment.invoice_id == Invoice.id,
            Payment.status.in_(REALISED_STATUSES),
        )
        .correlate(Invoice)
        .scalar_subquery()
    )
    balance = func.greatest(Invoice.total - paid, 0)

    stmt = _invoice_visible(
        select(func.coalesce(func.sum(balance), 0), func.count(Invoice.id)), branch_ids
    ).where(Invoice.status.in_(OPEN_STATUSES), balance > 0)

    amount, count = db.execute(stmt).one()
    return _money(amount), int(count)


def ageing_buckets(
    db: Session, branch_ids: list[uuid_lib.UUID] | None, today: date_type, buckets
) -> list[tuple[str, Decimal, int]]:
    """Outstanding money split by how long it has been overdue.

    One query per bucket rather than one per invoice: the frontend defines four
    fixed bands, so four aggregates is the whole cost.
    """
    paid = (
        select(func.coalesce(func.sum(Payment.amount), 0))
        .where(Payment.invoice_id == Invoice.id, Payment.status.in_(REALISED_STATUSES))
        .correlate(Invoice)
        .scalar_subquery()
    )
    balance = func.greatest(Invoice.total - paid, 0)
    # Days overdue, floored at zero: an invoice not yet due is not late.
    # `date - date` is an integer number of days in PostgreSQL. An invoice with
    # no due date is never overdue, and one not yet due is floored at zero.
    overdue_days = func.greatest(
        func.coalesce(literal(today, Date) - Invoice.due_date, 0), 0
    )

    results = []
    for label, low, high in buckets:
        stmt = _invoice_visible(
            select(func.coalesce(func.sum(balance), 0), func.count(Invoice.id)), branch_ids
        ).where(
            Invoice.status.in_(OPEN_STATUSES),
            balance > 0,
            and_(overdue_days >= low, overdue_days <= high),
        )
        amount, count = db.execute(stmt).one()
        results.append((label, _money(amount), int(count)))
    return results


def count_invoices(
    db: Session, branch_ids: list[uuid_lib.UUID] | None, statuses
) -> int:
    stmt = _invoice_visible(select(func.count(Invoice.id)), branch_ids).where(
        Invoice.status.in_(statuses)
    )
    return int(db.execute(stmt).scalar_one())


def expenses_between(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
    *,
    statuses=None,
) -> Decimal:
    stmt = _expense_visible(select(func.sum(Expense.amount)), branch_ids).where(
        Expense.expense_date >= start, Expense.expense_date <= end
    )
    if statuses is not None:
        stmt = stmt.where(Expense.status.in_(statuses))
    return _money(db.execute(stmt).scalar_one())


def pending_expenses(db: Session, branch_ids: list[uuid_lib.UUID] | None) -> tuple[int, Decimal]:
    stmt = _expense_visible(
        select(func.count(Expense.id), func.sum(Expense.amount)), branch_ids
    ).where(Expense.status == ExpenseStatus.PENDING_CATEGORISATION)
    count, amount = db.execute(stmt).one()
    return int(count), _money(amount)


def expenses_by_category(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> list[tuple[ExpenseCategory, Decimal]]:
    stmt = (
        _expense_visible(select(Expense.category, func.sum(Expense.amount)), branch_ids)
        .where(Expense.expense_date >= start, Expense.expense_date <= end)
        .group_by(Expense.category)
        .order_by(func.sum(Expense.amount).desc())
    )
    return [(category, _money(amount)) for category, amount in db.execute(stmt).all()]


def revenue_by_month(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> dict[date_type, Decimal]:
    """Settled collections grouped by calendar month."""
    bucket = func.date_trunc("month", Payment.paid_at)
    stmt = (
        _payment_visible(select(bucket, func.sum(Payment.amount)), branch_ids)
        .where(
            Payment.status.in_(REALISED_STATUSES),
            func.date(Payment.paid_at) >= start,
            func.date(Payment.paid_at) <= end,
        )
        .group_by(bucket)
    )
    return {row[0].date(): _money(row[1]) for row in db.execute(stmt).all()}


def expenses_by_month(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> dict[date_type, Decimal]:
    # date_trunc needs a timestamp; the column is a bare date.
    bucket = func.date_trunc("month", func.cast(Expense.expense_date, DateTime))
    stmt = (
        _expense_visible(select(bucket, func.sum(Expense.amount)), branch_ids)
        .where(Expense.expense_date >= start, Expense.expense_date <= end)
        .group_by(bucket)
    )
    return {row[0].date(): _money(row[1]) for row in db.execute(stmt).all()}


def revenue_by_department(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> list[tuple[InvoiceDepartment, Decimal]]:
    """Collections grouped by the department that raised the invoice.

    Joined from payments rather than invoice totals, so an unpaid bill does not
    show up as departmental revenue.
    """
    stmt = (
        _payment_visible(select(Invoice.department, func.sum(Payment.amount)), branch_ids)
        .where(
            Payment.status.in_(REALISED_STATUSES),
            func.date(Payment.paid_at) >= start,
            func.date(Payment.paid_at) <= end,
        )
        .group_by(Invoice.department)
        .order_by(func.sum(Payment.amount).desc())
    )
    if branch_ids is None:
        stmt = stmt.join(Invoice, Payment.invoice_id == Invoice.id)
    return [(department, _money(amount)) for department, amount in db.execute(stmt).all()]


def pharmacy_counter_takings(
    db: Session,
    branch_ids: list[uuid_lib.UUID] | None,
    start: date_type,
    end: date_type,
) -> Decimal:
    """Money taken at the pharmacy till.

    Counter sales are not invoices — Step 9 kept them separate deliberately,
    and a walk-in has no patient to bill — so they are summed from their own
    table and added once. Nothing in `pharmacy_sales` is ever mirrored into
    `invoices`, which is what makes the two safe to add together.
    """
    stmt = select(func.sum(PharmacySale.total)).where(
        func.date(PharmacySale.created_at) >= start,
        func.date(PharmacySale.created_at) <= end,
    )
    if branch_ids is not None:
        if not branch_ids:
            return ZERO
        stmt = stmt.where(PharmacySale.branch_id.in_(branch_ids))
    return _money(db.execute(stmt).scalar_one())
