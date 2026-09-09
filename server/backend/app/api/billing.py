"""Invoices, payments, expenses and the finance dashboard.

Four routers, because they are four resources. Reception raises invoices and
takes money at the desk; the accountant owns expenses and the reports. Keeping
them apart lets each permission stay honest instead of hiding the whole of
finance behind one key.

There is no DELETE, and no cancellation endpoint. The frontend has no cancelled
state — its `Invoice` status is Paid, Partially Paid, Unpaid or Overdue — so
none is invented here. There is no refund endpoint either, for the same reason.

Permission keys are the ones the frontend already defines: `billing.view`,
`billing.manage`, `payments.manage`, `expenses.manage`, `finance.reports`.
"""

from __future__ import annotations

from datetime import date as date_type
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.core.dependencies import (
    CurrentPermissions,
    DbSession,
    client_ip,
    require_permission,
)
from app.core.enums import (
    ExpenseCategory,
    ExpenseStatus,
    InvoiceDepartment,
    InvoiceStatus,
    PaymentMethod,
    PaymentStatus,
)
from app.models.user import User
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
    InvoicePage,
    InvoiceResponse,
    InvoiceUpdate,
    MonthTotal,
    PaymentCreate,
    PaymentPage,
    PaymentResponse,
    PaymentStatusUpdate,
)
from app.services import billing_service as service
from app.services import pdf_service as pdf

#: The dashboard and the reports behind it.
router = APIRouter(tags=["Billing"])
invoices = APIRouter(tags=["Invoices"])
payments = APIRouter(tags=["Payments"])
expenses = APIRouter(tags=["Expenses"])

_FORBIDDEN = {
    "description": "The caller lacks the required financial permission",
    "content": {
        "application/json": {
            "example": {
                "detail": "You do not have permission to perform this action.",
                "code": "insufficient_permission",
            }
        }
    },
}
_NOT_FOUND = {
    "description": "No such invoice, payment or expense — or it belongs to another branch",
    "content": {
        "application/json": {"example": {"detail": "Invoice not found.", "code": "not_found"}}
    },
}
_PAYMENT_CONFLICT = {
    "description": "The payment would exceed what is outstanding",
    "content": {
        "application/json": {
            "example": {
                "detail": (
                    "That is more than the 500.00 outstanding on INV-2026-4523. "
                    "Overpayments are not accepted."
                ),
                "code": "amount_exceeds_outstanding",
            }
        }
    },
}


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------


@invoices.get(
    "",
    response_model=InvoicePage,
    summary="Invoices",
    description=(
        "Newest first. `outstanding=true` narrows to bills with money still on "
        "them, which is what the outstanding screen shows.\n\n"
        "`amount` is the grand total and `paid` is the sum of **settled** "
        "payments — a failed bank transfer never counts as collected."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def list_invoices(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("billing.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    patient: Annotated[str | None, Query(description="Patient UUID or PT-##### code")] = None,
    status_filter: Annotated[InvoiceStatus | None, Query(alias="status")] = None,
    department: InvoiceDepartment | None = None,
    outstanding: bool = False,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    search: Annotated[str | None, Query(max_length=120)] = None,
) -> InvoicePage:
    return service.list_invoices(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        patient=patient,
        status=status_filter,
        department=department,
        outstanding_only=outstanding,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )


@invoices.post(
    "",
    response_model=InvoiceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Raise an invoice",
    description=(
        "The invoice and its lines are written in one transaction.\n\n"
        "**Totals are computed here, never accepted.** Each line's amount is "
        "`qty × rate`; the subtotal, discount, tax and grand total follow from "
        "those. The request schema has no total field to send.\n\n"
        "The invoice number is allocated under an advisory lock held for the "
        "rest of the transaction, so two tills billing at the same instant "
        "cannot be issued the same code."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def create_invoice(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: InvoiceCreate,
    user: Annotated[User, Depends(require_permission("billing.manage"))],
) -> InvoiceResponse:
    return service.create_invoice(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )


@invoices.get(
    "/{identifier}",
    response_model=InvoiceResponse,
    summary="One invoice",
    description="Accepts a UUID or an `INV-YYYY-####` code.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_invoice(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("billing.view"))],
) -> InvoiceResponse:
    return service.get_invoice(db, identifier=identifier, user=user, permissions=permissions)


@invoices.put(
    "/{identifier}",
    response_model=InvoiceResponse,
    summary="Amend an invoice",
    description=(
        "Department, due date and the lines themselves.\n\n"
        "**Status is not settable.** It is derived from the payments recorded "
        "against the invoice, which is what makes `Paid → Unpaid` impossible "
        "rather than merely forbidden — there is no field to send.\n\n"
        "A bill with money already collected against it cannot be re-costed: "
        "the payments would no longer match the charge, and this module has no "
        "reversal workflow to reconcile the difference."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _PAYMENT_CONFLICT},
)
def update_invoice(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: InvoiceUpdate,
    user: Annotated[User, Depends(require_permission("billing.manage"))],
) -> InvoiceResponse:
    return service.update_invoice(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


@invoices.get(
    "/{identifier}/pdf",
    summary="Invoice as PDF",
    description=(
        "Rendered on the server so one canonical document exists — an invoice "
        "is a financial record, and two people printing it from different "
        "browsers must not get two different documents.\n\n"
        "Carries the charge and how it was settled. No clinical information "
        "appears on it."
    ),
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {}}, "description": "A PDF file"},
        403: _FORBIDDEN,
        404: _NOT_FOUND,
    },
)
def invoice_pdf(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("billing.view"))],
) -> Response:
    invoice = service.get_invoice(db, identifier=identifier, user=user, permissions=permissions)
    body = pdf.invoice_pdf(invoice)
    return Response(
        content=body,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{invoice.id}.pdf"'},
    )


@invoices.get(
    "/{identifier}/payments",
    response_model=PaymentPage,
    summary="Payments against one invoice",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def invoice_payments(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("billing.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> PaymentPage:
    return service.list_payments(
        db, user=user, permissions=permissions, page=page, limit=limit, invoice=identifier
    )


@invoices.post(
    "/{identifier}/payments",
    response_model=PaymentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a payment",
    description=(
        "One transaction with the invoice row locked: the outstanding balance "
        "is summed, the payment is validated against it, the row is written and "
        "the invoice's status is re-derived — or none of it happens.\n\n"
        "**Overpayments are refused.** Two tills each taking the last ₹5,000 of "
        "a ₹5,000 balance serialise on that lock: the first commits, the second "
        "re-reads a zero balance and gets a 409.\n\n"
        "The collector, the timestamp and the resulting invoice status are all "
        "the server's. Send only what was taken and how."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _PAYMENT_CONFLICT},
)
def record_payment(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: PaymentCreate,
    user: Annotated[User, Depends(require_permission("billing.manage"))],
) -> PaymentResponse:
    return service.record_payment(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


@payments.get(
    "",
    response_model=PaymentPage,
    summary="Payments",
    description="Newest first. Failed payments are included — the till needs to chase them.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def list_payments(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("billing.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    invoice: Annotated[str | None, Query(description="Invoice UUID or INV-YYYY-#### code")] = None,
    patient: Annotated[str | None, Query(description="Patient UUID or PT-##### code")] = None,
    method: PaymentMethod | None = None,
    status_filter: Annotated[PaymentStatus | None, Query(alias="status")] = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
) -> PaymentPage:
    return service.list_payments(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        invoice=invoice,
        patient=patient,
        method=method,
        status=status_filter,
        date_from=date_from,
        date_to=date_to,
    )


@payments.get(
    "/{identifier}",
    response_model=PaymentResponse,
    summary="One payment",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_payment(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("billing.view"))],
) -> PaymentResponse:
    return service.get_payment(db, identifier=identifier, user=user, permissions=permissions)


@payments.patch(
    "/{identifier}/status",
    response_model=PaymentResponse,
    summary="Settle or fail a payment",
    description=(
        "A bank transfer taken as Processing clears — or does not. Settling "
        "re-checks the balance under the invoice lock, because money in flight "
        "was never counted against the invoice and another till may have "
        "collected the rest meanwhile.\n\n"
        "The amount cannot be edited. A wrong figure is corrected by failing "
        "the payment and taking a new one, so the ledger keeps both facts."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _PAYMENT_CONFLICT},
)
def set_payment_status(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: PaymentStatusUpdate,
    user: Annotated[User, Depends(require_permission("payments.manage"))],
) -> PaymentResponse:
    return service.set_payment_status(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


@expenses.get(
    "",
    response_model=ExpensePage,
    summary="Expenses",
    description="Newest first, scoped to the branches the caller may see.",
    responses={403: _FORBIDDEN},
)
def list_expenses(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("billing.view"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    category: ExpenseCategory | None = None,
    status_filter: Annotated[ExpenseStatus | None, Query(alias="status")] = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
) -> ExpensePage:
    return service.list_expenses(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        category=category,
        status=status_filter,
        date_from=date_from,
        date_to=date_to,
    )


@expenses.post(
    "",
    response_model=ExpenseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record an expense",
    description=(
        "Belongs to the caller's own branch unless another is named and they "
        "can see it. An entry filed without a category lands in Pending "
        "Categorisation, which is what the accountant's review queue reads."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def create_expense(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: ExpenseCreate,
    user: Annotated[User, Depends(require_permission("expenses.manage"))],
) -> ExpenseResponse:
    return service.create_expense(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )


@expenses.get(
    "/{identifier}",
    response_model=ExpenseResponse,
    summary="One expense",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_expense(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("billing.view"))],
) -> ExpenseResponse:
    return service.get_expense(db, identifier=identifier, user=user, permissions=permissions)


@expenses.put(
    "/{identifier}",
    response_model=ExpenseResponse,
    summary="Amend an expense",
    description=(
        "Also how a bank-feed entry gets categorised: giving it a real category "
        "clears it out of the review queue."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def update_expense(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: ExpenseUpdate,
    user: Annotated[User, Depends(require_permission("expenses.manage"))],
) -> ExpenseResponse:
    return service.update_expense(
        db,
        identifier=identifier,
        payload=payload,
        user=user,
        permissions=permissions,
        ip=client_ip(request),
    )


# ---------------------------------------------------------------------------
# Dashboard and reports
# ---------------------------------------------------------------------------


@router.get(
    "/dashboard",
    response_model=BillingDashboard,
    summary="Finance dashboard",
    description=(
        "Every figure the finance screens show, aggregated in PostgreSQL.\n\n"
        "**Revenue is collected money, not billed money.** An unpaid invoice is "
        "a claim on the future; counting it as income would overstate the whole "
        "page. Pharmacy counter takings are added from their own table, exactly "
        "once — a POS sale is never mirrored into `invoices`, so the two sources "
        "cannot overlap.\n\n"
        "`netRevenue` is collections minus expenses for the month to date, and "
        "is returned negative when that is the truth."
    ),
    responses={403: _FORBIDDEN},
)
def dashboard(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("billing.view"))],
) -> BillingDashboard:
    return service.dashboard(db, user=user, permissions=permissions)


@router.get(
    "/ageing",
    response_model=list[AgeingBucket],
    summary="Outstanding by age",
    description="The four bands the outstanding screen draws, aggregated in SQL.",
    responses={403: _FORBIDDEN},
)
def ageing(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("billing.view"))],
) -> list[AgeingBucket]:
    return service.ageing(db, user=user, permissions=permissions)


@router.get(
    "/reports/revenue",
    response_model=list[MonthTotal],
    summary="Revenue and expenses by month",
    description=(
        "The profit-and-loss series. A month with no activity is returned as a "
        "zero column rather than omitted, so the chart keeps its shape."
    ),
    responses={403: _FORBIDDEN},
)
def revenue_report(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("finance.reports"))],
    months: Annotated[int, Query(ge=1, le=24)] = 6,
) -> list[MonthTotal]:
    return service.revenue_report(db, user=user, permissions=permissions, months=months)


@router.get(
    "/reports/expenses",
    response_model=list[CategoryTotal],
    summary="Expenses by category",
    responses={403: _FORBIDDEN},
)
def expense_report(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("finance.reports"))],
    months: Annotated[int, Query(ge=1, le=24)] = 1,
) -> list[CategoryTotal]:
    return service.expense_report(db, user=user, permissions=permissions, months=months)


@router.get(
    "/reports/departments",
    response_model=list[DepartmentTotal],
    summary="Revenue by department",
    description="Collected money, joined from payments — an unpaid bill is not revenue.",
    responses={403: _FORBIDDEN},
)
def department_report(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("finance.reports"))],
    months: Annotated[int, Query(ge=1, le=24)] = 1,
) -> list[DepartmentTotal]:
    return service.department_report(db, user=user, permissions=permissions, months=months)
