"""Invoices, payments, expenses and the finance dashboard.

Three rules shape this module.

**Money is never a float.** Every amount is a `Decimal` bound to
``NUMERIC(12,2)``. Line totals, subtotals, tax and balances are all computed
here from the stored lines; a total arriving in a request is not rejected so
much as never read, because no request schema has the field.

**An invoice's status is a consequence, not an input.** It is derived from the
payments recorded against it, which is why `InvoiceUpdate` has no status field.
That makes the forbidden `Paid -> Unpaid` transition structurally impossible
rather than merely guarded: there is no code path that accepts it.

**Collected money is counted once.** Revenue reads from settled payments, plus
pharmacy counter takings from their own table. A POS sale never becomes an
invoice — Step 9 kept the two apart deliberately, and a walk-in customer has no
patient to bill — so the two sources cannot overlap.

Card numbers, CVVs and any other payment credential are never accepted, stored
or logged. A payment carries only a reference string that the acquirer already
made public to the payer.
"""

from __future__ import annotations

import calendar
import logging
import uuid as uuid_lib
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import (
    AuditCategory,
    NotificationIcon,
    NotificationSeverity,
    UserRole,
    ExpenseCategory,
    ExpenseStatus,
    InvoiceStatus,
    PaymentMethod,
    PaymentStatus,
)
from app.core.errors import ConflictError, NotFoundError, UnprocessableError
from app.core.ids import INVOICE, PAYMENT, EXPENSE
from app.models.audit import AuditLog
from app.models.billing import Expense, Invoice, InvoiceItem, Payment
from app.models.organisation import Branch
from app.models.user import User
from app.repositories import billing_repository as repo
from app.schemas.billing import (
    AgeingBucket,
    BillingDashboard,
    CategoryTotal,
    DepartmentTotal,
    ExpenseCreate,
    ExpensePage,
    ExpenseResponse,
    ExpenseUpdate,
    InvoiceCreate,
    InvoiceItemOut,
    InvoicePage,
    InvoiceResponse,
    InvoiceUpdate,
    MethodTotal,
    MonthTotal,
    PaymentCreate,
    PaymentPage,
    PaymentResponse,
    PaymentStatusUpdate,
)
from app.services import notification_service as notifications
from app.services.consultation_service import resolve_patient
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

ZERO = Decimal("0.00")

#: How long a patient has to settle a bill. The mock's invoices are all issued
#: fifteen days before they fall due.
DEFAULT_TERMS_DAYS = 15

#: The ageing bands on the outstanding screen, taken from `BUCKETS` in
#: `src/pages/accountant/Outstanding.tsx`.
AGEING_BUCKETS = (
    ("Not yet due", -999, 0),
    ("1–15 days", 1, 15),
    ("16–30 days", 16, 30),
    ("30+ days", 31, 9999),
)

#: The donut on the finance dashboard shows these four, in this order.
#: Insurance is a valid method on an invoice but is not one of the till's slices.
BREAKDOWN_METHODS = (
    PaymentMethod.CASH,
    PaymentMethod.UPI,
    PaymentMethod.CARD,
    PaymentMethod.BANK_TRANSFER,
)


# ---------------------------------------------------------------------------
# Money and time
# ---------------------------------------------------------------------------


def _money(value: Decimal) -> Decimal:
    """Round to paise, half-up.

    Banker's rounding is the Python default and would round a half-paise down
    as often as up; an invoice is expected to round the way a till does.
    """
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _today() -> date_type:
    """The clinic's date, not the server's."""
    return datetime.now(settings.clinic_tz).date()


def _month_bounds(day: date_type) -> tuple[date_type, date_type]:
    last = calendar.monthrange(day.year, day.month)[1]
    return day.replace(day=1), day.replace(day=last)


def _staff_name(user: User | None) -> str:
    return user.full_name if user else ""


# ---------------------------------------------------------------------------
# Totals and status
# ---------------------------------------------------------------------------


def _line_amount(quantity: int, rate: Decimal) -> Decimal:
    return _money(Decimal(quantity) * Decimal(rate))


def compute_totals(
    items, discount: Decimal, tax: Decimal
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    """Subtotal, discount, tax and grand total, from the lines alone.

    Returns the discount clamped to the subtotal: a discount larger than the
    bill would otherwise produce a negative total, which the database's
    ``total >= 0`` check would refuse with a 503 rather than a clear error.
    """
    subtotal = _money(sum((_line_amount(i.qty, i.rate) for i in items), ZERO))
    discount = _money(discount or ZERO)
    tax = _money(tax or ZERO)

    if discount > subtotal:
        raise UnprocessableError(
            f"The discount ({discount}) is larger than the invoice subtotal ({subtotal}).",
            code="discount_exceeds_subtotal",
        )

    total = _money(subtotal - discount + tax)
    return subtotal, discount, tax, total


def derive_status(total: Decimal, paid: Decimal, due_date: date_type | None, today: date_type):
    """The status the frontend expects, from money and the calendar.

    Reproduces the vocabulary the mock uses: a fully settled bill is Paid; an
    unsettled one past its due date is Overdue whether or not part of it has
    been collected; otherwise it is Partially Paid or Unpaid. There is no
    Cancelled status anywhere in this system, so none is produced here.
    """
    if paid >= total:
        return InvoiceStatus.PAID
    if due_date is not None and due_date < today:
        return InvoiceStatus.OVERDUE
    if paid > ZERO:
        return InvoiceStatus.PARTIALLY_PAID
    return InvoiceStatus.UNPAID


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------


def invoice_out(row: Invoice, today: date_type | None = None) -> InvoiceResponse:
    today = today or _today()
    paid = _money(row.amount_paid)
    balance = max(ZERO, _money(row.total - paid))

    # The list shows how the bill was most recently settled.
    settled = [p for p in row.payments if p.status is PaymentStatus.SETTLED]
    latest = max(settled, key=lambda p: p.paid_at, default=None)

    return InvoiceResponse(
        id=row.invoice_number,
        uuid=str(row.id),
        patientId=row.patient.patient_number,
        patientUuid=str(row.patient_id),
        patientName=row.patient.full_name,
        date=row.issued_on,
        dueDate=row.due_date,
        amount=row.total,
        paid=paid,
        balance=balance,
        subtotal=row.subtotal,
        discount=row.discount,
        tax=row.tax,
        # Derived rather than read from the column: Overdue arrives with the
        # calendar, not with a write, so a stored value goes stale on its own.
        status=derive_status(row.total, paid, row.due_date, today),
        department=row.department,
        items=[
            InvoiceItemOut(
                id=str(item.id),
                label=item.label,
                qty=item.quantity,
                rate=item.rate,
                amount=item.amount,
            )
            for item in row.items
        ],
        method=latest.method if latest else None,
        branch=row.branch.name if row.branch else None,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def payment_out(row: Payment) -> PaymentResponse:
    invoice = row.invoice
    patient = invoice.patient
    paid_at = row.paid_at
    if paid_at is not None and paid_at.tzinfo is None:
        paid_at = paid_at.replace(tzinfo=timezone.utc)

    return PaymentResponse(
        id=row.payment_number,
        uuid=str(row.id),
        invoiceId=invoice.invoice_number,
        invoiceUuid=str(row.invoice_id),
        patientId=patient.patient_number,
        patientName=patient.full_name,
        amount=row.amount,
        method=row.method,
        date=paid_at.astimezone(settings.clinic_tz).date() if paid_at else _today(),
        collectedBy=_staff_name(row.collector),
        status=row.status,
        reference=row.transaction_reference,
        paidAt=paid_at,
    )


def expense_out(row: Expense) -> ExpenseResponse:
    return ExpenseResponse(
        id=row.expense_number,
        uuid=str(row.id),
        date=row.expense_date,
        vendor=row.vendor,
        category=row.category,
        amount=row.amount,
        method=row.method,
        status=row.status,
        reference=row.reference or "",
        description=row.description,
        branch=row.branch.name if row.branch else None,
        branchId=str(row.branch_id) if row.branch_id else None,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


# ---------------------------------------------------------------------------
# Resolution and audit
# ---------------------------------------------------------------------------


def _uuid_or_none(value: str | None) -> uuid_lib.UUID | None:
    try:
        return uuid_lib.UUID(value)  # type: ignore[arg-type]
    except (ValueError, AttributeError, TypeError):
        return None


def _visible(branch_ids, branch_id) -> bool:
    return branch_ids is None or branch_id in branch_ids


def _resolve_invoice(db: Session, identifier: str, branch_ids) -> Invoice:
    row = (
        repo.get_invoice_by_number(db, identifier)
        if INVOICE.matches(identifier)
        else repo.get_invoice(db, _uuid_or_none(identifier)) if _uuid_or_none(identifier) else None
    )
    if row is None or not _visible(branch_ids, row.patient.branch_id):
        # 404 rather than 403 — a 403 would confirm the invoice exists.
        raise NotFoundError("Invoice not found.")
    return row


def _resolve_payment(db: Session, identifier: str, branch_ids) -> Payment:
    row = (
        repo.get_payment_by_number(db, identifier)
        if PAYMENT.matches(identifier)
        else repo.get_payment(db, _uuid_or_none(identifier)) if _uuid_or_none(identifier) else None
    )
    if row is None or not _visible(branch_ids, row.invoice.patient.branch_id):
        raise NotFoundError("Payment not found.")
    return row


def _resolve_expense(db: Session, identifier: str, branch_ids) -> Expense:
    row = (
        repo.get_expense_by_number(db, identifier)
        if EXPENSE.matches(identifier)
        else repo.get_expense(db, _uuid_or_none(identifier)) if _uuid_or_none(identifier) else None
    )
    if row is None or not _visible(branch_ids, row.branch_id):
        raise NotFoundError("Expense not found.")
    return row


def _audit(
    db: Session,
    user: User,
    action: str,
    target_type: str,
    target_id,
    summary: str,
    ip: str | None,
    category: AuditCategory = AuditCategory.BILLING,
) -> None:
    """Record that money moved, never how it was tendered.

    Summaries carry codes and amounts. A card number, a CVV or any other
    payment credential is never accepted by this module, so none can reach
    here.
    """
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=category,
            target_type=target_type,
            target_id=target_id,
            summary=summary,
            ip_address=ip,
        )
    )


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------


def list_invoices(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int = 1,
    limit: int = 50,
    patient: str | None = None,
    status=None,
    department=None,
    outstanding_only: bool = False,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    search: str | None = None,
) -> InvoicePage:
    branch_ids = visible_branch_ids(db, user, permissions)
    patient_id = resolve_patient(db, patient, user, permissions).id if patient else None

    rows, total = repo.list_invoices(
        db,
        branch_ids=branch_ids,
        patient_id=patient_id,
        status=status,
        department=department,
        outstanding_only=outstanding_only,
        date_from=date_from,
        date_to=date_to,
        search=search,
        offset=(page - 1) * limit,
        limit=limit,
    )
    today = _today()
    return InvoicePage(
        items=[invoice_out(row, today) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def get_invoice(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> InvoiceResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    return invoice_out(_resolve_invoice(db, identifier, branch_ids))


def resolve_invoice(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> Invoice:
    """The `Invoice` row behind a number or an id, under this caller's scope.

    Public because the AI layer's billing check needs exactly this resolution
    and exactly this 404-not-403 rule. Two implementations of "may this person
    see this invoice" would eventually disagree, and the disagreement would be
    a way to read another branch's billing.
    """
    return _resolve_invoice(db, identifier, visible_branch_ids(db, user, permissions))


def invoices_for_patient(db: Session, patient_id: uuid_lib.UUID) -> list[InvoiceResponse]:
    """Patient 360's billing tab. Access is checked by the caller."""
    today = _today()
    return [invoice_out(row, today) for row in repo.invoices_for_patient(db, patient_id)]


def _write_items(db: Session, invoice: Invoice, items) -> None:
    for line in items:
        db.add(
            InvoiceItem(
                invoice_id=invoice.id,
                label=line.label.strip(),
                quantity=line.qty,
                rate=_money(line.rate),
                # Never the client's figure — recomputed from quantity and rate.
                amount=_line_amount(line.qty, line.rate),
            )
        )


def create_invoice(
    db: Session,
    *,
    payload: InvoiceCreate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> InvoiceResponse:
    """Raise an invoice and its lines in one transaction.

    The number is allocated under an advisory lock held for the rest of the
    transaction, so two tills billing at the same instant cannot be handed the
    same code. Every total is computed from the lines; nothing about the money
    comes from the request beyond the quantities and rates themselves.
    """
    patient = resolve_patient(db, payload.patientId, user, permissions)

    issued_on = payload.date or _today()
    due_date = payload.dueDate or issued_on + timedelta(days=DEFAULT_TERMS_DAYS)
    if due_date < issued_on:
        raise UnprocessableError("The due date cannot be before the invoice date.")

    subtotal, discount, tax, total = compute_totals(payload.items, payload.discount, payload.tax)

    invoice = Invoice(
        invoice_number=INVOICE.format(
            repo.next_invoice_number(db, issued_on.year), year=issued_on.year
        ),
        patient_id=patient.id,
        branch_id=patient.branch_id,
        department=payload.department,
        subtotal=subtotal,
        discount=discount,
        tax=tax,
        total=total,
        # Nothing has been collected yet, so the status follows from that.
        status=derive_status(total, ZERO, due_date, issued_on),
        issued_on=issued_on,
        due_date=due_date,
        created_by=user.id,
    )
    db.add(invoice)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        logger.warning("Invoice rejected by a uniqueness constraint")
        raise ConflictError(
            "That invoice number was taken while this bill was being raised.",
            code="invoice_number_taken",
        ) from None

    _write_items(db, invoice, payload.items)

    _audit(
        db,
        user,
        "INVOICE_CREATED",
        "invoices",
        invoice.id,
        f"{invoice.invoice_number}: {total} for {patient.patient_number}",
        ip,
    )

    # One commit for the invoice, its lines and the audit entry.
    db.commit()
    db.refresh(invoice)

    logger.info("Invoice %s raised for %s", invoice.invoice_number, patient.patient_number)
    return invoice_out(invoice)


def update_invoice(
    db: Session,
    *,
    identifier: str,
    payload: InvoiceUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> InvoiceResponse:
    """Amend an invoice and re-derive every figure on it.

    A bill that has already been collected against cannot have its lines
    rewritten: the money received would no longer match what was charged, and
    this module has no reversal workflow to reconcile the difference.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    invoice = _resolve_invoice(db, identifier, branch_ids)

    paid = repo.settled_total(db, invoice.id)
    rewriting = payload.items is not None or payload.discount is not None or payload.tax is not None
    if rewriting and paid > ZERO:
        raise ConflictError(
            f"{invoice.invoice_number} has {paid} collected against it and can no longer be "
            "re-costed.",
            code="invoice_has_payments",
        )

    if payload.department is not None:
        invoice.department = payload.department
    if payload.dueDate is not None:
        if payload.dueDate < invoice.issued_on:
            raise UnprocessableError("The due date cannot be before the invoice date.")
        invoice.due_date = payload.dueDate

    if payload.items is not None:
        repo.clear_invoice_items(db, invoice)
        _write_items(db, invoice, payload.items)

    if rewriting:
        lines = payload.items if payload.items is not None else [
            _StoredLine(item) for item in invoice.items
        ]
        subtotal, discount, tax, total = compute_totals(
            lines,
            invoice.discount if payload.discount is None else payload.discount,
            invoice.tax if payload.tax is None else payload.tax,
        )
        invoice.subtotal, invoice.discount, invoice.tax, invoice.total = (
            subtotal,
            discount,
            tax,
            total,
        )

    invoice.status = derive_status(invoice.total, paid, invoice.due_date, _today())

    _audit(
        db, user, "INVOICE_UPDATED", "invoices", invoice.id, invoice.invoice_number, ip
    )
    db.commit()
    db.refresh(invoice)
    return invoice_out(invoice)


class _StoredLine:
    """Adapts a persisted line to the shape `compute_totals` reads."""

    __slots__ = ("qty", "rate")

    def __init__(self, item: InvoiceItem) -> None:
        self.qty = item.quantity
        self.rate = item.rate


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


def list_payments(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int = 1,
    limit: int = 50,
    invoice: str | None = None,
    patient: str | None = None,
    method=None,
    status=None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
) -> PaymentPage:
    branch_ids = visible_branch_ids(db, user, permissions)
    invoice_id = _resolve_invoice(db, invoice, branch_ids).id if invoice else None
    patient_id = resolve_patient(db, patient, user, permissions).id if patient else None

    rows, total = repo.list_payments(
        db,
        branch_ids=branch_ids,
        invoice_id=invoice_id,
        patient_id=patient_id,
        method=method,
        status=status,
        date_from=date_from,
        date_to=date_to,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return PaymentPage(
        items=[payment_out(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def get_payment(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> PaymentResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    return payment_out(_resolve_payment(db, identifier, branch_ids))


def record_payment(
    db: Session,
    *,
    identifier: str,
    payload: PaymentCreate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> PaymentResponse:
    """Take money against an invoice, atomically.

    The whole sequence runs in one transaction with the invoice row locked::

        BEGIN -> lock invoice -> sum settled payments -> validate against the
        outstanding balance -> insert the payment -> re-derive the invoice
        status -> COMMIT

    The lock is what makes the overpayment rule hold under concurrency. Two
    tills each taking the last ₹5,000 of a ₹5,000 balance serialise on it: the
    first commits, the second re-reads a zero balance and is refused. Without
    it both would read ₹5,000 outstanding, both would pass the check, and the
    invoice would end up ₹5,000 over-collected with no way to tell which
    payment was the mistake.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    invoice = _resolve_invoice(db, identifier, branch_ids)

    locked = repo.lock_invoice(db, invoice.id)
    if locked is None:  # pragma: no cover - resolved a moment ago
        raise NotFoundError("Invoice not found.")

    amount = _money(payload.amount)
    if amount <= ZERO:
        raise UnprocessableError("A payment must be for more than zero.", code="amount_not_positive")

    # Read under the lock, so a payment committed by another till is either
    # fully visible here or has not happened yet.
    paid = repo.settled_total(db, locked.id)
    outstanding = _money(locked.total - paid)

    # Only settled money reduces the balance, so a Processing payment is not
    # checked against it — the bank has not moved anything yet.
    if payload.status is PaymentStatus.SETTLED:
        if outstanding <= ZERO:
            raise ConflictError(
                f"{invoice.invoice_number} is already settled in full.",
                code="invoice_settled",
            )
        if amount > outstanding:
            raise ConflictError(
                f"That is more than the {outstanding} outstanding on "
                f"{invoice.invoice_number}. Overpayments are not accepted.",
                code="amount_exceeds_outstanding",
            )

    paid_on = payload.date or _today()
    paid_at = datetime.combine(
        paid_on, datetime.now(settings.clinic_tz).timetz()
    ).astimezone(timezone.utc)

    payment = Payment(
        payment_number=PAYMENT.format(repo.next_payment_number(db)),
        invoice_id=locked.id,
        amount=amount,
        method=payload.method,
        status=payload.status,
        transaction_reference=payload.reference,
        # Never taken from the request — the collector is the caller.
        collected_by=user.id,
        paid_at=paid_at,
    )
    db.add(payment)
    db.flush()

    # Re-derive from the database rather than adding to the figure read above.
    settled = repo.settled_total(db, locked.id)
    locked.status = derive_status(locked.total, settled, locked.due_date, _today())

    # Only settled money is worth announcing — a transfer still clearing has
    # not arrived yet. The collector is excluded: they just took it.
    if payment.status is PaymentStatus.SETTLED:
        notifications.notify_roles(
            db,
            roles=(UserRole.ACCOUNTANT,),
            branch_id=invoice.patient.branch_id,
            title=f"Payment received — {amount}",
            body=f"{invoice.invoice_number} · {payment.method.display}",
            icon=NotificationIcon.FINANCE,
            severity=NotificationSeverity.SUCCESS,
            href="/accountant/payments",
            exclude=user.id,
        )

    _audit(
        db,
        user,
        "PAYMENT_CREATED",
        "payments",
        payment.id,
        f"{payment.payment_number}: {amount} against {invoice.invoice_number}",
        ip,
    )
    db.commit()
    db.refresh(payment)

    logger.info(
        "Payment %s of %s recorded against %s by %s",
        payment.payment_number,
        amount,
        invoice.invoice_number,
        user.id,
    )
    return payment_out(payment)


def set_payment_status(
    db: Session,
    *,
    identifier: str,
    payload: PaymentStatusUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> PaymentResponse:
    """Settle or fail a payment that was taken as Processing.

    Settling one re-checks the balance under the invoice lock, because the
    money it represents was never counted against the invoice while it was in
    flight — another till may have collected the rest in the meantime.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    payment = _resolve_payment(db, identifier, branch_ids)

    locked = repo.lock_invoice(db, payment.invoice_id)
    if locked is None:  # pragma: no cover - resolved a moment ago
        raise NotFoundError("Invoice not found.")

    if payment.status is payload.status:
        return payment_out(payment)

    if payment.status is PaymentStatus.SETTLED and payload.status is PaymentStatus.PROCESSING:
        raise ConflictError(
            "Settled money cannot be put back in flight.", code="already_settled"
        )

    if payload.status is PaymentStatus.SETTLED:
        paid = repo.settled_total(db, locked.id)
        outstanding = _money(locked.total - paid)
        if _money(payment.amount) > outstanding:
            raise ConflictError(
                f"Settling this would exceed the {outstanding} outstanding on "
                f"{locked.invoice_number}.",
                code="amount_exceeds_outstanding",
            )

    payment.status = payload.status
    db.flush()

    settled = repo.settled_total(db, locked.id)
    locked.status = derive_status(locked.total, settled, locked.due_date, _today())

    _audit(
        db,
        user,
        "PAYMENT_STATUS_CHANGED",
        "payments",
        payment.id,
        f"{payment.payment_number} -> {payload.status.display}",
        ip,
    )
    db.commit()
    db.refresh(payment)
    return payment_out(payment)


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


def list_expenses(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int = 1,
    limit: int = 50,
    category=None,
    status=None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
) -> ExpensePage:
    branch_ids = visible_branch_ids(db, user, permissions)
    rows, total = repo.list_expenses(
        db,
        branch_ids=branch_ids,
        category=category,
        status=status,
        date_from=date_from,
        date_to=date_to,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return ExpensePage(
        items=[expense_out(row) for row in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def get_expense(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> ExpenseResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    return expense_out(_resolve_expense(db, identifier, branch_ids))


def create_expense(
    db: Session,
    *,
    payload: ExpenseCreate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> ExpenseResponse:
    branch_ids = visible_branch_ids(db, user, permissions)

    branch_id = _uuid_or_none(payload.branchId) if payload.branchId else user.branch_id
    if branch_id is not None:
        if not _visible(branch_ids, branch_id):
            # The branch is real but out of scope; say the same thing either way.
            raise NotFoundError("Branch not found.")
        if db.get(Branch, branch_id) is None:
            raise NotFoundError("Branch not found.")
    elif branch_ids is not None:
        # A branch-bound user with no branch of their own has nowhere to file it.
        raise UnprocessableError("An expense needs a branch, and you are not assigned to one.")
    # Otherwise the cost is organisation-wide — payroll and group insurance are
    # not one campus's, and forcing them onto an arbitrary branch would make
    # every per-branch figure wrong.

    expense = Expense(
        expense_number=EXPENSE.format(repo.next_expense_number(db)),
        branch_id=branch_id,
        vendor=payload.vendor.strip(),
        category=payload.category,
        amount=_money(payload.amount),
        method=payload.method,
        # An entry filed without a category is exactly what the accountant's
        # review queue exists for.
        status=(
            ExpenseStatus.PENDING_CATEGORISATION
            if payload.category is ExpenseCategory.UNCATEGORISED
            else ExpenseStatus.RECORDED
        ),
        reference=payload.reference,
        description=payload.description,
        expense_date=payload.date or _today(),
        recorded_by=user.id,
    )
    db.add(expense)
    db.flush()

    _audit(
        db,
        user,
        "EXPENSE_CREATED",
        "expenses",
        expense.id,
        f"{expense.expense_number}: {expense.amount} to {expense.vendor}",
        ip,
    )
    db.commit()
    db.refresh(expense)
    return expense_out(expense)


def update_expense(
    db: Session,
    *,
    identifier: str,
    payload: ExpenseUpdate,
    user: User,
    permissions: list[str],
    ip: str | None,
) -> ExpenseResponse:
    branch_ids = visible_branch_ids(db, user, permissions)
    expense = _resolve_expense(db, identifier, branch_ids)

    if payload.vendor is not None:
        expense.vendor = payload.vendor.strip()
    if payload.amount is not None:
        expense.amount = _money(payload.amount)
    if payload.date is not None:
        expense.expense_date = payload.date
    if payload.method is not None:
        expense.method = payload.method
    if payload.reference is not None:
        expense.reference = payload.reference.strip() or None
    if payload.description is not None:
        expense.description = payload.description

    if payload.category is not None:
        expense.category = payload.category
        # Categorising a bank-feed entry is what clears it from the queue.
        if (
            payload.status is None
            and expense.status is ExpenseStatus.PENDING_CATEGORISATION
            and payload.category is not ExpenseCategory.UNCATEGORISED
        ):
            expense.status = ExpenseStatus.RECORDED

    if payload.status is not None:
        expense.status = payload.status
        if payload.status is ExpenseStatus.APPROVED:
            expense.approved_by = user.id

    _audit(
        db,
        user,
        "EXPENSE_UPDATED",
        "expenses",
        expense.id,
        f"{expense.expense_number}: {expense.amount}",
        ip,
    )
    db.commit()
    db.refresh(expense)
    return expense_out(expense)


# ---------------------------------------------------------------------------
# Dashboard and reports
# ---------------------------------------------------------------------------


def dashboard(db: Session, *, user: User, permissions: list[str]) -> BillingDashboard:
    """Every figure the finance screens show, aggregated in PostgreSQL.

    Revenue is collected money, not billed money: an unpaid invoice is a claim
    on the future, and counting it as income would overstate every figure on
    the page. Pharmacy counter takings are added from their own table, once —
    a POS sale is never mirrored into `invoices`, so the two cannot overlap.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    today = _today()
    month_start, month_end = _month_bounds(today)

    today_invoices = repo.collected_between(db, branch_ids, today, today)
    today_counter = repo.pharmacy_counter_takings(db, branch_ids, today, today)

    month_invoices = repo.collected_between(db, branch_ids, month_start, month_end)
    month_counter = repo.pharmacy_counter_takings(db, branch_ids, month_start, month_end)
    month_revenue = _money(month_invoices + month_counter)

    expenses = repo.expenses_between(db, branch_ids, month_start, month_end)
    outstanding, outstanding_count = repo.outstanding_total(db, branch_ids)
    failed_count, failed_amount = repo.failed_payments(db, branch_ids)
    pending_count, pending_amount = repo.pending_expenses(db, branch_ids)

    by_method = dict(repo.collections_by_method(db, branch_ids, today, today))

    return BillingDashboard(
        todayRevenue=_money(today_invoices + today_counter),
        # Settled, to match the figure above it. The mock counted every payment
        # that had not outright failed while labelling the result "settled
        # payments"; the label is the honest half of that pair.
        todayPaymentCount=repo.count_payments_between(
            db, branch_ids, today, today, status=PaymentStatus.SETTLED
        ),
        monthlyRevenue=month_revenue,
        totalExpenses=expenses,
        # Shown as it falls, negative included.
        netRevenue=_money(month_revenue - expenses),
        outstandingAmount=outstanding,
        outstandingInvoices=outstanding_count,
        paidInvoices=repo.count_invoices(db, branch_ids, [InvoiceStatus.PAID]),
        pendingInvoices=repo.count_invoices(
            db, branch_ids, [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID]
        ),
        overdueInvoices=repo.count_invoices(db, branch_ids, [InvoiceStatus.OVERDUE]),
        failedPayments=failed_count,
        failedAmount=failed_amount,
        pendingExpenses=pending_count,
        pendingExpenseAmount=pending_amount,
        paymentBreakdown=[
            MethodTotal(method=method, amount=by_method.get(method, ZERO))
            for method in BREAKDOWN_METHODS
        ],
    )


def ageing(db: Session, *, user: User, permissions: list[str]) -> list[AgeingBucket]:
    """Outstanding money by how long it has been overdue."""
    branch_ids = visible_branch_ids(db, user, permissions)
    rows = repo.ageing_buckets(db, branch_ids, _today(), AGEING_BUCKETS)
    return [AgeingBucket(bucket=label, amount=amount, count=count) for label, amount, count in rows]


def revenue_report(
    db: Session, *, user: User, permissions: list[str], months: int = 6
) -> list[MonthTotal]:
    """Collections against expenses, month by month.

    Both series come from one query each and are then zipped, so a month with
    no activity still appears as a zero column rather than shifting the chart.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    today = _today()

    first = today.replace(day=1)
    for _ in range(max(0, months - 1)):
        first = (first - timedelta(days=1)).replace(day=1)
    last = _month_bounds(today)[1]

    collections = repo.revenue_by_month(db, branch_ids, first, last)
    outgoings = repo.expenses_by_month(db, branch_ids, first, last)

    series: list[MonthTotal] = []
    cursor = first
    while cursor <= last:
        revenue = _money(
            collections.get(cursor, ZERO)
            + repo.pharmacy_counter_takings(db, branch_ids, *_month_bounds(cursor))
        )
        spent = outgoings.get(cursor, ZERO)
        series.append(
            MonthTotal(
                # The chart's own label format, e.g. "Aug 26".
                month=f"{calendar.month_abbr[cursor.month]} {cursor:%y}",
                revenue=revenue,
                expenses=spent,
                profit=_money(revenue - spent),
            )
        )
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    return series


def expense_report(
    db: Session, *, user: User, permissions: list[str], months: int = 1
) -> list[CategoryTotal]:
    """Expenses by category over the trailing window."""
    branch_ids = visible_branch_ids(db, user, permissions)
    today = _today()

    first = today.replace(day=1)
    for _ in range(max(0, months - 1)):
        first = (first - timedelta(days=1)).replace(day=1)

    rows = repo.expenses_by_category(db, branch_ids, first, _month_bounds(today)[1])
    return [CategoryTotal(category=category, amount=amount) for category, amount in rows]


def department_report(
    db: Session, *, user: User, permissions: list[str], months: int = 1
) -> list[DepartmentTotal]:
    """Collected revenue by the department that raised the bill."""
    branch_ids = visible_branch_ids(db, user, permissions)
    today = _today()

    first = today.replace(day=1)
    for _ in range(max(0, months - 1)):
        first = (first - timedelta(days=1)).replace(day=1)

    rows = repo.revenue_by_department(db, branch_ids, first, _month_bounds(today)[1])
    total = sum((amount for _, amount in rows), ZERO)
    return [
        DepartmentTotal(
            department=department,
            revenue=amount,
            share=round(float(amount / total * 100), 1) if total else 0.0,
        )
        for department, amount in rows
    ]
