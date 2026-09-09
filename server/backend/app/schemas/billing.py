"""Invoices, line items, payments and expenses.

Field names mirror the frontend's `Invoice`, `PaymentRecord` and `Expense`
types in `src/types/index.ts`. Three things there shape everything here:

* an invoice carries `amount` and `paid` as flat numbers, and the screens
  derive the balance from them. Both are produced by the server — `paid` is the
  sum of settled payments, never a figure a client may set;
* a line item is `{label, qty, rate}`. There is no per-item discount or tax in
  either the frontend or the database, so none is invented here;
* a payment has its own status — Settled, Processing, Failed — and the mock's
  own collection figures exclude Failed. Revenue follows that rule rather than
  counting every row in the table.

Every money field is a `Decimal`, bound to `NUMERIC(12,2)`. No float touches a
rupee anywhere in this module.
"""

from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.enums import (
    ExpenseCategory,
    ExpenseStatus,
    InvoiceDepartment,
    InvoiceStatus,
    PaymentMethod,
    PaymentStatus,
)

#: Rupee amounts. Twelve digits with two decimals, matching the columns.
_MONEY = {"max_digits": 12, "decimal_places": 2}


# ---------------------------------------------------------------------------
# Invoice items
# ---------------------------------------------------------------------------


class InvoiceItemOut(BaseModel):
    """One billed line, in the frontend's own field names."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    qty: int
    rate: Decimal
    #: `qty × rate`, computed by the server on every write.
    amount: Decimal


class InvoiceItemIn(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    qty: int = Field(gt=0, le=10_000)
    rate: Decimal = Field(ge=0, **_MONEY)


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------


class InvoiceResponse(BaseModel):
    """Matches the frontend's ``Invoice`` interface."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["INV-2026-04412"])
    uuid: str
    patientId: str = Field(description="Patient code, e.g. PT-10248")
    patientUuid: str
    patientName: str
    date: date_type
    dueDate: date_type | None = None

    #: The grand total. `paid` is the sum of settled payments against it.
    amount: Decimal
    paid: Decimal
    #: `amount - paid`, floored at zero — what the screens call the balance.
    balance: Decimal

    subtotal: Decimal
    discount: Decimal
    tax: Decimal

    status: InvoiceStatus
    department: InvoiceDepartment
    items: list[InvoiceItemOut] = Field(default_factory=list)
    #: The method of the most recent settled payment, which is what the
    #: invoice list shows. Absent until something has been collected.
    method: PaymentMethod | None = None

    branch: str | None = None
    createdBy: str = ""
    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class InvoiceCreate(BaseModel):
    """Raise an invoice.

    Totals are absent by design: the server computes them from the lines. A
    client that sends one is not refused, it is simply not believed — the field
    does not exist to be sent.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "patientId": "PT-10248",
                "department": "OPD",
                "items": [{"label": "Consultation — Dr. Arjun Sharma", "qty": 1, "rate": "1000.00"}],
                "dueDate": "2026-09-08",
            }
        }
    )

    patientId: str = Field(description="Patient UUID or PT-##### code")
    department: InvoiceDepartment = InvoiceDepartment.OPD
    items: list[InvoiceItemIn] = Field(min_length=1, max_length=100)

    date: date_type | None = Field(default=None, description="Defaults to today")
    dueDate: date_type | None = Field(default=None, description="Defaults to 15 days out")
    discount: Decimal = Field(default=Decimal("0.00"), ge=0, **_MONEY)
    tax: Decimal = Field(default=Decimal("0.00"), ge=0, **_MONEY)

    @model_validator(mode="after")
    def _due_after_issue(self) -> "InvoiceCreate":
        if self.date and self.dueDate and self.dueDate < self.date:
            raise ValueError("The due date cannot be before the invoice date.")
        return self


class InvoiceUpdate(BaseModel):
    """Amend an invoice.

    Status is absent: it is derived from the payments recorded against the
    invoice, so accepting it here would let a client mark an unpaid bill Paid.
    Replacing `items` re-computes every total from the new lines.
    """

    department: InvoiceDepartment | None = None
    dueDate: date_type | None = None
    items: list[InvoiceItemIn] | None = Field(default=None, min_length=1, max_length=100)
    discount: Decimal | None = Field(default=None, ge=0, **_MONEY)
    tax: Decimal | None = Field(default=None, ge=0, **_MONEY)


class InvoicePage(BaseModel):
    items: list[InvoiceResponse]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


class PaymentResponse(BaseModel):
    """Matches the frontend's ``PaymentRecord`` interface."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["PAY-9901"])
    uuid: str
    invoiceId: str = Field(description="Invoice code, e.g. INV-2026-04412")
    invoiceUuid: str
    patientId: str
    patientName: str
    amount: Decimal
    method: PaymentMethod
    date: date_type
    collectedBy: str = ""
    status: PaymentStatus
    reference: str | None = None
    paidAt: datetime | None = None


class PaymentCreate(BaseModel):
    """Record money received against an invoice.

    Only the amount, how it arrived and its reference come from the client.
    The invoice, the collector, the timestamp, the resulting balance and the
    invoice's new status are all the server's to decide.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {"amount": "5000.00", "method": "UPI", "reference": "TXN123"}
        }
    )

    amount: Decimal = Field(gt=0, **_MONEY)
    method: PaymentMethod
    #: A UPI, card or bank reference. Never card numbers — see the module note
    #: in `billing_service`.
    reference: str | None = Field(default=None, max_length=120)
    #: Bank transfers clear later, so the till may record one as Processing.
    status: PaymentStatus = PaymentStatus.SETTLED
    date: date_type | None = Field(default=None, description="Defaults to today")

    @field_validator("reference")
    @classmethod
    def _trim(cls, value: str | None) -> str | None:
        return value.strip() or None if value else None


class PaymentStatusUpdate(BaseModel):
    """Settle or fail a payment that was taken as Processing.

    The amount cannot be edited. A wrong amount is corrected by failing the
    payment and taking a new one, so the ledger keeps both facts.
    """

    status: PaymentStatus


class PaymentPage(BaseModel):
    items: list[PaymentResponse]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


class ExpenseResponse(BaseModel):
    """Matches the frontend's ``Expense`` interface."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["EXP-3301"])
    uuid: str
    date: date_type
    vendor: str
    category: ExpenseCategory
    amount: Decimal
    method: PaymentMethod | None = None
    status: ExpenseStatus
    reference: str = ""

    description: str | None = None
    branch: str | None = None
    branchId: str | None = None
    recordedBy: str = ""
    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class ExpenseCreate(BaseModel):
    vendor: str = Field(min_length=1, max_length=200)
    amount: Decimal = Field(gt=0, **_MONEY)
    category: ExpenseCategory = ExpenseCategory.UNCATEGORISED
    date: date_type | None = Field(default=None, description="Defaults to today")
    method: PaymentMethod | None = None
    reference: str | None = Field(default=None, max_length=120)
    description: str | None = None
    #: Defaults to the caller's own branch. An organisation-wide user who
    #: names none files an organisation-wide cost — payroll belongs to no one
    #: campus.
    branchId: str | None = None


class ExpenseUpdate(BaseModel):
    """Amend an expense, including categorising one the bank feed could not.

    ``status`` is settable because the frontend's own workflow moves an entry
    from Pending Categorisation to Recorded once a category is chosen.
    """

    vendor: str | None = Field(default=None, min_length=1, max_length=200)
    amount: Decimal | None = Field(default=None, gt=0, **_MONEY)
    category: ExpenseCategory | None = None
    date: date_type | None = None
    method: PaymentMethod | None = None
    reference: str | None = Field(default=None, max_length=120)
    description: str | None = None
    status: ExpenseStatus | None = None


class ExpensePage(BaseModel):
    items: list[ExpenseResponse]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Dashboard and reports
# ---------------------------------------------------------------------------


class MethodTotal(BaseModel):
    """One slice of the payment-breakdown donut."""

    method: PaymentMethod
    amount: Decimal


class CategoryTotal(BaseModel):
    """One slice of the expense donut."""

    category: ExpenseCategory
    amount: Decimal


class MonthTotal(BaseModel):
    """One column of the profit-and-loss chart."""

    #: The label the chart renders, e.g. "Aug 26".
    month: str
    revenue: Decimal
    expenses: Decimal
    profit: Decimal


class DepartmentTotal(BaseModel):
    department: InvoiceDepartment
    revenue: Decimal
    #: Percentage of the period's invoiced revenue, to one decimal.
    share: float


class AgeingBucket(BaseModel):
    """One bar of the outstanding-ageing chart, in the frontend's own buckets."""

    bucket: str
    amount: Decimal
    count: int


class BillingDashboard(BaseModel):
    """Every figure the finance screens show, aggregated in PostgreSQL."""

    #: Collections settled today — the frontend's "Today's Collections".
    todayRevenue: Decimal
    #: How many payments made it up, excluding failures.
    todayPaymentCount: int

    #: Settled collections for the calendar month to date.
    monthlyRevenue: Decimal
    #: Expenses recorded in the same window.
    totalExpenses: Decimal
    #: `monthlyRevenue - totalExpenses`. Negative is shown, never hidden.
    netRevenue: Decimal

    #: Unsettled balance across every open invoice.
    outstandingAmount: Decimal
    outstandingInvoices: int

    paidInvoices: int
    pendingInvoices: int
    overdueInvoices: int

    #: Payments that failed and need chasing.
    failedPayments: int
    failedAmount: Decimal
    #: Expenses still awaiting a category.
    pendingExpenses: int
    pendingExpenseAmount: Decimal

    #: Today's collections split by how they arrived.
    paymentBreakdown: list[MethodTotal] = Field(default_factory=list)
