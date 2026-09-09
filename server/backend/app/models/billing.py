"""Invoices, line items, payments and expenses.

All money is ``NUMERIC(12,2)``. Totals are recomputed server-side by the
billing service in a later step — the columns here are the persisted result of
that calculation, never a figure accepted from a client.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import (
    ExpenseCategory,
    ExpenseStatus,
    InvoiceDepartment,
    InvoiceStatus,
    PaymentMethod,
    PaymentStatus,
    pg_enum,
)
from app.models.base import Base, CreatedAtMixin, TimestampMixin, UUIDMixin, money, short_code

if TYPE_CHECKING:
    from app.models.organisation import Branch
    from app.models.patient import Patient
    from app.models.user import User


class Invoice(UUIDMixin, TimestampMixin, Base):
    """A bill raised against a patient."""

    __tablename__ = "invoices"
    __table_args__ = (
        Index("ix_invoices_patient_id", "patient_id"),
        Index("ix_invoices_status", "status"),
        Index("ix_invoices_due_date", "due_date"),
        Index("ix_invoices_branch_id", "branch_id"),
        CheckConstraint("subtotal >= 0", name="subtotal_non_negative"),
        CheckConstraint("discount >= 0", name="discount_non_negative"),
        CheckConstraint("tax >= 0", name="tax_non_negative"),
        CheckConstraint("total >= 0", name="total_non_negative"),
    )

    #: Human-readable code, e.g. INV-2026-4412.
    invoice_number: Mapped[str] = short_code(24)

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("branches.id", ondelete="SET NULL")
    )
    department: Mapped[InvoiceDepartment] = mapped_column(
        pg_enum(InvoiceDepartment, "invoice_department"), nullable=False
    )

    subtotal: Mapped[Decimal] = money()
    discount: Mapped[Decimal] = money()
    tax: Mapped[Decimal] = money()
    total: Mapped[Decimal] = money()

    status: Mapped[InvoiceStatus] = mapped_column(
        pg_enum(InvoiceStatus, "invoice_status"), nullable=False, default=InvoiceStatus.UNPAID
    )
    issued_on: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    patient: Mapped["Patient"] = relationship(back_populates="invoices")
    branch: Mapped["Branch | None"] = relationship()
    items: Mapped[list["InvoiceItem"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan", passive_deletes=True
    )
    payments: Mapped[list["Payment"]] = relationship(back_populates="invoice")

    @property
    def amount_paid(self) -> Decimal:
        """Settled payments only. Computed, never stored."""
        return sum(
            (p.amount for p in self.payments if p.status == PaymentStatus.SETTLED),
            Decimal("0.00"),
        )

    @property
    def balance(self) -> Decimal:
        return self.total - self.amount_paid

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Invoice {self.invoice_number} total={self.total}>"


class InvoiceItem(UUIDMixin, Base):
    """One billed line."""

    __tablename__ = "invoice_items"
    __table_args__ = (
        Index("ix_invoice_items_invoice_id", "invoice_id"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("rate >= 0", name="rate_non_negative"),
        CheckConstraint("amount >= 0", name="amount_non_negative"),
    )

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(nullable=False, default=1)
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    #: quantity * rate, recomputed by the billing service.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    invoice: Mapped["Invoice"] = relationship(back_populates="items")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<InvoiceItem {self.label!r} {self.amount}>"


class Payment(UUIDMixin, CreatedAtMixin, Base):
    """Money received against an invoice."""

    __tablename__ = "payments"
    __table_args__ = (
        Index("ix_payments_invoice_id", "invoice_id"),
        Index("ix_payments_paid_at", "paid_at"),
        Index("ix_payments_status", "status"),
        CheckConstraint("amount > 0", name="amount_positive"),
    )

    #: Human-readable code, e.g. PAY-9901.
    payment_number: Mapped[str] = short_code(16)

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    method: Mapped[PaymentMethod] = mapped_column(
        pg_enum(PaymentMethod, "payment_method"), nullable=False
    )
    status: Mapped[PaymentStatus] = mapped_column(
        pg_enum(PaymentStatus, "payment_status"), nullable=False, default=PaymentStatus.SETTLED
    )
    transaction_reference: Mapped[str | None] = mapped_column(String(120))
    collected_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    paid_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    invoice: Mapped["Invoice"] = relationship(back_populates="payments")
    collector: Mapped["User | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Payment {self.payment_number} {self.amount} {self.method}>"


class Expense(UUIDMixin, TimestampMixin, Base):
    """Operating cost recorded against a branch."""

    __tablename__ = "expenses"
    __table_args__ = (
        Index("ix_expenses_branch_id", "branch_id"),
        Index("ix_expenses_status", "status"),
        Index("ix_expenses_expense_date", "expense_date"),
        Index("ix_expenses_category", "category"),
        CheckConstraint("amount >= 0", name="amount_non_negative"),
    )

    #: Human-readable code, e.g. EXP-3301.
    expense_number: Mapped[str] = short_code(16)

    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("branches.id", ondelete="SET NULL")
    )
    vendor: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[ExpenseCategory] = mapped_column(
        pg_enum(ExpenseCategory, "expense_category"),
        nullable=False,
        default=ExpenseCategory.UNCATEGORISED,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    method: Mapped[PaymentMethod | None] = mapped_column(pg_enum(PaymentMethod, "payment_method"))
    status: Mapped[ExpenseStatus] = mapped_column(
        pg_enum(ExpenseStatus, "expense_status"), nullable=False, default=ExpenseStatus.RECORDED
    )
    reference: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)

    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    branch: Mapped["Branch | None"] = relationship(back_populates="expenses")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Expense {self.vendor!r} {self.amount}>"
