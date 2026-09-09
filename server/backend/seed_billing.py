"""Development billing seed: invoices, line items, payments and expenses.

Everything current comes from the frontend's original sample data — ``INVOICES``,
``PAYMENTS`` and ``EXPENSES`` in ``src/data/billing.ts`` — so the finance
screens look as they did against mocks.

    python seed_billing.py            # create or update
    python seed_billing.py --reset    # delete seeded financial rows first

DEVELOPMENT / DEMO ONLY. Run ``seed.py`` and ``seed_patients.py`` first.

Two things shape this script.

The first is that **an invoice's totals come from its lines**, exactly as
``billing_service`` computes them. Where the mock's stated ``amount`` disagrees
with its own line items, the lines win and the run says so — a seeded invoice
that does not add up is worse than one that differs from the mock by ₹400.

The second is that **an invoice's paid figure comes from its payments**. Only
settled money counts, so a payment the mock leaves Processing does not reduce a
balance here. Where the mock shows money collected with no payment behind it,
an opening receipt is written for the difference rather than the figure being
asserted directly.

The chart on the profit-and-loss screen covers a year, which no amount of
current data can fill, so a run also lays down eleven months of closed monthly
billing and operating costs. Those are summary rows, one per department and
category per month, not invented patient histories.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.enums import (
    ExpenseCategory,
    ExpenseStatus,
    InvoiceDepartment,
    PaymentMethod,
    PaymentStatus,
    UserRole,
)
from app.core.ids import EXPENSE, INVOICE, PAYMENT
from app.core.logging_config import configure_logging
from app.models import Branch, Expense, Invoice, InvoiceItem, Patient, Payment, User
from app.repositories import billing_repository as repo
from app.services.billing_service import compute_totals, derive_status

configure_logging()
logger = logging.getLogger("seed-billing")

DEPARTMENT = {
    "OPD": InvoiceDepartment.OPD,
    "IPD": InvoiceDepartment.IPD,
    "Pharmacy": InvoiceDepartment.PHARMACY,
    "Therapy": InvoiceDepartment.THERAPY,
    "Diagnostics": InvoiceDepartment.DIAGNOSTICS,
}
METHOD = {
    "Cash": PaymentMethod.CASH,
    "UPI": PaymentMethod.UPI,
    "Card": PaymentMethod.CARD,
    "Bank Transfer": PaymentMethod.BANK_TRANSFER,
    "Insurance": PaymentMethod.INSURANCE,
}
PAYMENT_STATE = {
    "Settled": PaymentStatus.SETTLED,
    "Processing": PaymentStatus.PROCESSING,
    "Failed": PaymentStatus.FAILED,
}
CATEGORY = {
    "Salaries": ExpenseCategory.SALARIES,
    "Pharmacy Purchase": ExpenseCategory.PHARMACY_PURCHASE,
    "Equipment": ExpenseCategory.EQUIPMENT,
    "Utilities": ExpenseCategory.UTILITIES,
    "Maintenance": ExpenseCategory.MAINTENANCE,
    "Marketing": ExpenseCategory.MARKETING,
    "Uncategorised": ExpenseCategory.UNCATEGORISED,
}
EXPENSE_STATE = {
    "Recorded": ExpenseStatus.RECORDED,
    "Approved": ExpenseStatus.APPROVED,
    "Pending Categorisation": ExpenseStatus.PENDING_CATEGORISATION,
}

# (number, patient, issued, due, stated amount, paid, department, [(label, qty, rate)])
INVOICES = (
    ("INV-2026-4412", "PT-10356", "2026-07-14", "2026-07-29", 128_900, 60_000, "IPD", (
        ("Hemiarthroplasty — surgical package", 1, 92_000),
        ("Private room (12 days)", 12, 2_400),
        ("Physiotherapy sessions", 7, 1_100),
    )),
    ("INV-2026-4438", "PT-10302", "2026-07-28", "2026-08-12", 87_300, 30_000, "IPD", (
        ("Total knee replacement package", 1, 74_000),
        ("Semi-private room (6 days)", 6, 1_800),
        ("Rehabilitation sessions", 5, 500),
    )),
    ("INV-2026-4455", "PT-10263", "2026-08-02", "2026-08-17", 96_500, 53_750, "IPD", (
        ("Neuro rehabilitation package (36 sessions)", 1, 60_000),
        ("General ward (22 days)", 22, 1_400),
        ("Speech therapy sessions", 6, 950),
    )),
    ("INV-2026-4471", "PT-10284", "2026-08-12", "2026-08-27", 74_200, 43_000, "IPD", (
        ("Cardiac rehabilitation phase II package", 1, 54_000),
        ("Private room (8 days)", 8, 2_400),
        ("Cardiac monitoring charges", 1, 1_000),
    )),
    ("INV-2026-4488", "PT-10248", "2026-08-18", "2026-09-02", 46_400, 28_000, "Therapy", (
        ("Ortho rehab package (24 sessions)", 1, 30_000),
        ("Semi-private room (6 days)", 6, 1_800),
        ("Hydrotherapy add-on", 4, 1_400),
    )),
    ("INV-2026-4492", "PT-10315", "2026-08-19", "2026-09-03", 24_800, 12_400, "Therapy", (
        ("Balance & gait programme (32 sessions)", 1, 22_400),
        ("Assistive device fitting", 1, 2_400),
    )),
    ("INV-2026-4501", "PT-10290", "2026-08-20", "2026-09-04", 19_600, 9_800, "Therapy", (
        ("Shoulder mobilisation programme (28 sessions)", 1, 16_800),
        ("Thermotherapy add-on", 4, 700),
    )),
    ("INV-2026-4510", "PT-10367", "2026-08-21", "2026-09-05", 22_400, 16_800, "Therapy", (
        ("Paediatric speech programme (40 sessions)", 1, 20_000),
        ("Parent coaching sessions", 3, 800),
    )),
    ("INV-2026-4516", "PT-10251", "2026-08-22", "2026-09-06", 14_200, 8_000, "OPD", (
        ("Cervical rehabilitation (20 sessions)", 1, 12_000),
        ("Consultation — Dr. Priya Nair", 2, 1_100),
    )),
    ("INV-2026-4520", "PT-10341", "2026-08-23", "2026-09-07", 11_400, 8_000, "OPD", (
        ("Hand therapy programme (14 sessions)", 1, 9_800),
        ("Night splints (pair)", 1, 1_600),
    )),
    ("INV-2026-4523", "PT-10277", "2026-08-24", "2026-09-08", 9_600, 9_600, "OPD", (
        ("Core stabilisation programme (16 sessions)", 1, 8_000),
        ("Consultation — Dr. Arjun Sharma", 1, 1_600),
    )),
    ("INV-2026-4524", "PT-10372", "2026-08-24", "2026-09-08", 6_300, 4_200, "Pharmacy", (
        ("Methotrexate 15 mg (12 tablets)", 12, 29),
        ("Adaptive kitchen tool set", 1, 3_800),
        ("Resting splints (pair)", 1, 2_152),
    )),
    ("INV-2026-4525", "PT-10328", "2026-08-12", "2026-08-27", 18_000, 18_000, "Therapy", (
        ("Ankle rehabilitation programme (18 sessions)", 1, 16_200),
        ("Return-to-sport assessment", 1, 1_800),
    )),
    ("INV-2026-4526", "PT-10388", "2026-07-30", "2026-08-14", 31_200, 31_200, "Therapy", (
        ("Rotator cuff rehabilitation (26 sessions)", 1, 28_600),
        ("Discharge assessment", 1, 2_600),
    )),
)

# (number, invoice, amount, method, date, collected by, status)
PAYMENTS = (
    ("PAY-9901", "INV-2026-4523", 9_600, "UPI", "2026-08-24", "Sneha Patil", "Settled"),
    ("PAY-9902", "INV-2026-4524", 4_200, "Card", "2026-08-24", "Sneha Patil", "Settled"),
    ("PAY-9903", "INV-2026-4488", 28_000, "UPI", "2026-08-24", "Kiran Rao", "Settled"),
    ("PAY-9904", "INV-2026-4520", 8_000, "Cash", "2026-08-24", "Sneha Patil", "Settled"),
    ("PAY-9905", "INV-2026-4471", 43_000, "Bank Transfer", "2026-08-24", "Kiran Rao", "Processing"),
    ("PAY-9906", "INV-2026-4516", 8_000, "UPI", "2026-08-24", "Divya Menon", "Settled"),
    ("PAY-9907", "INV-2026-4510", 16_800, "Card", "2026-08-24", "Sneha Patil", "Settled"),
    ("PAY-9908", "INV-2026-4501", 9_800, "UPI", "2026-08-24", "Divya Menon", "Settled"),
    ("PAY-9909", "INV-2026-4492", 12_400, "Card", "2026-08-24", "Sneha Patil", "Settled"),
    ("PAY-9910", "INV-2026-4455", 25_000, "Bank Transfer", "2026-08-24", "Kiran Rao", "Failed"),
)

# (number, date, vendor, category, amount, method, status, reference)
EXPENSES = (
    ("EXP-3301", "2026-08-24", "MedSupply Distributors", "Pharmacy Purchase", 214_500, "Bank Transfer", "Recorded", "PO-2026-8841"),
    ("EXP-3302", "2026-08-24", "Adani Electricity", "Utilities", 86_400, "Bank Transfer", "Approved", "BILL-AUG-2026"),
    ("EXP-3303", "2026-08-23", "PhysioTech Equipment", "Equipment", 342_000, "Bank Transfer", "Pending Categorisation", "INV-PT-11209"),
    ("EXP-3304", "2026-08-23", "Sparkle Facility Services", "Maintenance", 48_000, "Bank Transfer", "Recorded", "SFS-AUG-04"),
    ("EXP-3305", "2026-08-22", "Staff Payroll — August", "Salaries", 2_840_000, "Bank Transfer", "Approved", "PAY-AUG-2026"),
    ("EXP-3306", "2026-08-22", "Google Ads India", "Marketing", 62_500, "Card", "Pending Categorisation", "GADS-8827"),
    ("EXP-3307", "2026-08-21", "AquaPure Systems", "Maintenance", 27_800, "UPI", "Recorded", "APS-2291"),
    ("EXP-3308", "2026-08-20", "Unknown UPI Credit", "Uncategorised", 15_400, "UPI", "Pending Categorisation", "UPI-77120934"),
    ("EXP-3309", "2026-08-19", "Cipla Distribution", "Pharmacy Purchase", 178_900, "Bank Transfer", "Approved", "PO-2026-8829"),
    ("EXP-3310", "2026-08-18", "Mahanagar Gas", "Utilities", 19_200, "Bank Transfer", "Recorded", "MGL-AUG-2026"),
)

#: Closed months behind the current one, from `MONTHLY_PNL` and `REVENUE_TREND`
#: in `src/data/analytics.ts`. The profit-and-loss chart covers a year, which no
#: amount of live data can fill, so the history is laid down as summary rows.
HISTORY = (
    ("2025-09", 5_820_000, 4_310_000),
    ("2025-10", 6_140_000, 4_480_000),
    ("2025-11", 5_960_000, 4_520_000),
    ("2025-12", 6_780_000, 4_690_000),
    ("2026-01", 7_120_000, 5_010_000),
    ("2026-02", 6_640_000, 4_870_000),
    ("2026-03", 7_460_000, 5_140_000),
    ("2026-04", 7_180_000, 5_260_000),
    ("2026-05", 7_690_000, 5_320_000),
    ("2026-06", 8_040_000, 5_480_000),
    ("2026-07", 8_310_000, 5_610_000),
)

#: How a month's revenue splits across departments, from `DEPARTMENT_REVENUE`.
DEPARTMENT_SHARE = (
    ("Therapy", Decimal("0.455")),
    ("IPD", Decimal("0.271")),
    ("OPD", Decimal("0.154")),
    ("Pharmacy", Decimal("0.120")),
)

#: How a month's costs split, from `EXPENSE_BREAKDOWN`.
CATEGORY_SHARE = (
    ("Salaries", Decimal("0.744")),
    ("Pharmacy Purchase", Decimal("0.103")),
    ("Equipment", Decimal("0.090")),
    ("Utilities", Decimal("0.028")),
    ("Maintenance", Decimal("0.020")),
    ("Marketing", Decimal("0.015")),
)

#: The patient a closed month's summary invoice is raised against, and the desk
#: that took the money. Both must already exist.
HISTORY_PATIENT = "PT-10248"
HISTORY_COLLECTOR = "Kiran Rao"
HISTORY_METHODS = (
    PaymentMethod.BANK_TRANSFER,
    PaymentMethod.UPI,
    PaymentMethod.CARD,
    PaymentMethod.CASH,
)


#: The day the frontend's sample data calls "today". Every payment it lists is
#: dated to it, and the dashboard's collections tile reads today's takings — so
#: a run re-dates those to its own today rather than leaving the tile at zero
#: for every day but one.
MOCK_TODAY = date(2026, 8, 24)


def as_today(day: date, today: date) -> date:
    return today if day == MOCK_TODAY else day


def at_local(day: date, clock: str = "11:30") -> datetime:
    """A clinic-local wall-clock time, stored as the UTC instant it names."""
    hour, minute = (int(part) for part in clock.split(":"))
    return datetime.combine(day, time(hour, minute), tzinfo=settings.clinic_tz).astimezone(
        timezone.utc
    )


class Line:
    """Adapts a seed tuple to the shape `compute_totals` reads."""

    __slots__ = ("qty", "rate")

    def __init__(self, qty: int, rate) -> None:
        self.qty = qty
        self.rate = Decimal(rate)


def month_range(key: str) -> tuple[date, date]:
    year, month = (int(part) for part in key.split("-"))
    first = date(year, month, 1)
    last = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return first, last


# ---------------------------------------------------------------------------
# Current invoices, payments and expenses
# ---------------------------------------------------------------------------


def seed_invoices(
    db: Session, patients: dict[str, Patient], author: User | None
) -> tuple[dict[str, Invoice], int, list[str]]:
    created = 0
    mismatched: list[str] = []
    rows: dict[str, Invoice] = {}

    for number, patient_code, issued, due, stated, _paid, department, items in INVOICES:
        patient = patients.get(patient_code)
        if patient is None:
            logger.warning("Skipping %s — patient %s is not registered", number, patient_code)
            continue

        subtotal, discount, tax, total = compute_totals(
            [Line(qty, rate) for _label, qty, rate in items], Decimal("0"), Decimal("0")
        )
        if total != Decimal(stated):
            mismatched.append(f"{number} (mock {stated:,}, lines {total:,.0f})")

        invoice = db.execute(
            select(Invoice).where(Invoice.invoice_number == number)
        ).scalar_one_or_none()
        if invoice is None:
            invoice = Invoice(invoice_number=number)
            db.add(invoice)
            created += 1

        invoice.patient_id = patient.id
        invoice.branch_id = patient.branch_id
        invoice.department = DEPARTMENT[department]
        invoice.subtotal = subtotal
        invoice.discount = discount
        invoice.tax = tax
        invoice.total = total
        invoice.issued_on = date.fromisoformat(issued)
        invoice.due_date = date.fromisoformat(due)
        invoice.created_by = author.id if author else None
        db.flush()

        # Rewritten each run so a changed rate cannot leave a stale line behind.
        invoice.items.clear()
        db.flush()
        for label, qty, rate in items:
            db.add(
                InvoiceItem(
                    invoice_id=invoice.id,
                    label=label,
                    quantity=qty,
                    rate=Decimal(rate),
                    amount=Decimal(qty) * Decimal(rate),
                )
            )
        rows[number] = invoice

    db.flush()
    return rows, created, mismatched


def seed_payments(
    db: Session, invoices: dict[str, Invoice], staff: dict[str, User], today: date
) -> tuple[int, list[str]]:
    """The mock's payment rows, then an opening receipt for anything unexplained.

    An invoice the mock shows as part-collected but has no payment behind it
    needs one, or the balance would be wrong. Only settled money counts towards
    that difference — a transfer still in flight has not paid anything yet.
    """
    created = 0
    for number, invoice_number, amount, method, day, collector, state in PAYMENTS:
        invoice = invoices.get(invoice_number)
        if invoice is None:
            continue
        payment = db.execute(
            select(Payment).where(Payment.payment_number == number)
        ).scalar_one_or_none()
        if payment is None:
            payment = Payment(payment_number=number)
            db.add(payment)
            created += 1

        staff_member = staff.get(collector)
        payment.invoice_id = invoice.id
        payment.amount = Decimal(amount)
        payment.method = METHOD[method]
        payment.status = PAYMENT_STATE[state]
        payment.collected_by = staff_member.id if staff_member else None
        payment.paid_at = at_local(as_today(date.fromisoformat(day), today), "15:40")
    db.flush()

    opening: list[str] = []
    collector = staff.get(HISTORY_COLLECTOR)
    for number, _code, issued, _due, _stated, paid, _department, _items in INVOICES:
        invoice = invoices.get(number)
        if invoice is None or not paid:
            continue

        # Money already explained by a payment row, whether or not it has
        # cleared. A *failed* transfer explains nothing, which is why it is not
        # counted here — the invoice still needs a receipt for that money.
        explained = sum(
            (
                Decimal(amount)
                for _n, target, amount, _m, _d, _c, state in PAYMENTS
                if target == number and state in ("Settled", "Processing")
            ),
            Decimal("0"),
        )
        shortfall = min(Decimal(paid), invoice.total) - explained
        if shortfall <= 0:
            continue

        receipt_number = f"{number.replace('INV-', 'OPN-')}"
        payment = db.execute(
            select(Payment).where(Payment.payment_number == receipt_number)
        ).scalar_one_or_none()
        if payment is None:
            payment = Payment(payment_number=receipt_number)
            db.add(payment)
            created += 1

        payment.invoice_id = invoice.id
        payment.amount = shortfall
        payment.method = PaymentMethod.BANK_TRANSFER
        payment.status = PaymentStatus.SETTLED
        payment.collected_by = collector.id if collector else None
        payment.paid_at = at_local(date.fromisoformat(issued) + timedelta(days=2), "12:15")
        opening.append(f"{number} (INR {shortfall:,.0f})")

    db.flush()
    return created, opening


def seed_expenses(db: Session, branch: Branch, author: User | None, today: date) -> int:
    created = 0
    for number, day, vendor, category, amount, method, state, reference in EXPENSES:
        expense = db.execute(
            select(Expense).where(Expense.expense_number == number)
        ).scalar_one_or_none()
        if expense is None:
            expense = Expense(expense_number=number)
            db.add(expense)
            created += 1

        expense.branch_id = branch.id
        expense.vendor = vendor
        expense.category = CATEGORY[category]
        expense.amount = Decimal(amount)
        expense.method = METHOD[method]
        expense.status = EXPENSE_STATE[state]
        expense.reference = reference
        expense.expense_date = as_today(date.fromisoformat(day), today)
        expense.recorded_by = author.id if author else None
    db.flush()
    return created


# ---------------------------------------------------------------------------
# Closed months
# ---------------------------------------------------------------------------


def seed_history(
    db: Session, patient: Patient, branch: Branch, collector: User | None, author: User | None
) -> tuple[int, int]:
    """Closed monthly billing and operating costs, one row per split.

    Summary rows rather than invented patient histories: the profit-and-loss
    chart needs a year of shape, and fabricating thousands of consultations to
    produce it would put fiction into the clinical tables to draw a graph.
    """
    invoices = 0
    expenses = 0

    for index, (key, revenue, spend) in enumerate(HISTORY):
        first, last = month_range(key)
        issued = last

        for slot, (department, share) in enumerate(DEPARTMENT_SHARE):
            amount = (Decimal(revenue) * share).quantize(Decimal("0.01"))
            number = f"INV-{first.year}-9{first.month:02d}{slot}"

            invoice = db.execute(
                select(Invoice).where(Invoice.invoice_number == number)
            ).scalar_one_or_none()
            if invoice is None:
                invoice = Invoice(invoice_number=number)
                db.add(invoice)
                invoices += 1

            invoice.patient_id = patient.id
            invoice.branch_id = branch.id
            invoice.department = DEPARTMENT[department]
            invoice.subtotal = amount
            invoice.discount = Decimal("0.00")
            invoice.tax = Decimal("0.00")
            invoice.total = amount
            invoice.issued_on = issued
            invoice.due_date = issued
            invoice.created_by = author.id if author else None
            db.flush()

            invoice.items.clear()
            db.flush()
            db.add(
                InvoiceItem(
                    invoice_id=invoice.id,
                    label=f"{department} billing — {first:%B %Y}",
                    quantity=1,
                    rate=amount,
                    amount=amount,
                )
            )

            receipt = f"PAY-9{first.year % 100:02d}{first.month:02d}{slot}"
            payment = db.execute(
                select(Payment).where(Payment.payment_number == receipt)
            ).scalar_one_or_none()
            if payment is None:
                payment = Payment(payment_number=receipt)
                db.add(payment)

            payment.invoice_id = invoice.id
            payment.amount = amount
            # Rotated so the method donut has more than one slice in history.
            payment.method = HISTORY_METHODS[(index + slot) % len(HISTORY_METHODS)]
            payment.status = PaymentStatus.SETTLED
            payment.collected_by = collector.id if collector else None
            payment.paid_at = at_local(issued, "17:00")

            invoice.status = derive_status(amount, amount, issued, issued)

        for slot, (category, share) in enumerate(CATEGORY_SHARE):
            amount = (Decimal(spend) * share).quantize(Decimal("0.01"))
            number = f"EXP-9{first.year % 100:02d}{first.month:02d}{slot}"

            expense = db.execute(
                select(Expense).where(Expense.expense_number == number)
            ).scalar_one_or_none()
            if expense is None:
                expense = Expense(expense_number=number)
                db.add(expense)
                expenses += 1

            expense.branch_id = branch.id
            expense.vendor = f"{category} — {first:%B %Y}"
            expense.category = CATEGORY[category]
            expense.amount = amount
            expense.method = PaymentMethod.BANK_TRANSFER
            expense.status = ExpenseStatus.APPROVED
            expense.reference = f"{key}-{slot}"
            expense.expense_date = last
            expense.recorded_by = author.id if author else None

    db.flush()
    return invoices, expenses


def refresh_statuses(db: Session, today: date) -> None:
    """Bring every invoice's stored status in line with its payments."""
    for invoice in db.execute(select(Invoice)).scalars():
        paid = repo.settled_total(db, invoice.id)
        invoice.status = derive_status(invoice.total, paid, invoice.due_date, today)
    db.flush()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reset", action="store_true", help="delete seeded financial rows first"
    )
    args = parser.parse_args()

    today = datetime.now(settings.clinic_tz).date()

    with SessionLocal() as db:
        try:
            patients = {p.patient_number: p for p in db.execute(select(Patient)).scalars()}
            staff = {u.full_name: u for u in db.execute(select(User)).scalars()}
            branch = db.execute(select(Branch).order_by(Branch.created_at)).scalars().first()

            if not patients or not staff or branch is None:
                logger.error(
                    "Run `python seed.py` and `python seed_patients.py` first — "
                    "patients, staff or branches are missing"
                )
                return 1

            if args.reset:
                logger.warning("Deleting existing payments, invoice items, invoices and expenses")
                db.execute(delete(Payment))
                db.execute(delete(InvoiceItem))
                db.execute(delete(Invoice))
                db.execute(delete(Expense))
                db.flush()

            author = next(
                (u for u in staff.values() if u.role is UserRole.ACCOUNTANT and u.branch_id), None
            )
            collector = staff.get(HISTORY_COLLECTOR)

            invoices, new_invoices, mismatched = seed_invoices(db, patients, author)
            new_payments, opening = seed_payments(db, invoices, staff, today)
            new_expenses = seed_expenses(db, branch, author, today)

            history_patient = patients.get(HISTORY_PATIENT)
            if history_patient is None:
                logger.error("The history summary needs %s to exist", HISTORY_PATIENT)
                return 1
            hist_invoices, hist_expenses = seed_history(
                db, history_patient, branch, collector, author
            )

            refresh_statuses(db, today)

            totals = {
                "invoices": db.execute(select(func.count(Invoice.id))).scalar_one(),
                "items": db.execute(select(func.count(InvoiceItem.id))).scalar_one(),
                "payments": db.execute(select(func.count(Payment.id))).scalar_one(),
                "expenses": db.execute(select(func.count(Expense.id))).scalar_one(),
            }
            outstanding, open_count = repo.outstanding_total(db, None)

            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Billing seeding failed — no changes were committed")
            return 1

    logger.info("Invoices:    %s (%s new, %s from closed months)", totals["invoices"], new_invoices, hist_invoices)
    logger.info("Line items:  %s", totals["items"])
    logger.info("Payments:    %s (%s new)", totals["payments"], new_payments)
    logger.info("Expenses:    %s (%s new, %s from closed months)", totals["expenses"], new_expenses, hist_expenses)
    logger.info("Outstanding: INR %s across %s open invoice(s)", f"{outstanding:,.2f}", open_count)
    logger.info("-" * 70)
    logger.info("Reconciled, because the frontend's sample data disagreed with itself:")
    if mismatched:
        logger.info(
            "  %s state a total their own line items do not add up to. The lines "
            "win, because that is how the billing service computes a bill and a "
            "seeded invoice that does not add up is worse than one that differs "
            "from the mock.",
            "; ".join(mismatched),
        )
    if opening:
        logger.info(
            "  Wrote an opening receipt for %s. The mock shows money collected "
            "against them with no payment row behind it, and a balance here is "
            "the sum of its payments rather than a figure asserted on the invoice.",
            "; ".join(opening),
        )
    logger.info(
        "  INV-2026-4471 reads Unpaid rather than Partially Paid: its only "
        "payment is a bank transfer still Processing, and money in flight has "
        "not settled anything. The dashboard's failed-and-processing tiles exist "
        "to surface exactly that."
    )
    logger.info(
        "Closed months are summary rows — one invoice per department and one "
        "expense per category per month — not invented patient histories."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
