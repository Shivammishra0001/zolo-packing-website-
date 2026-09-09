"""Medicines, batch-level stock, prescriptions and dispensing records.

Stock is batch-based: quantity, price and expiry live on ``medicine_batches``,
not on ``medicines``. The frontend's flat medicine view is produced by
aggregating batches in the API layer — the frontend model is not redesigned.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import PaymentMethod, PrescriptionPriority, PrescriptionStatus, pg_enum
from app.models.base import Base, CreatedAtMixin, TimestampMixin, UUIDMixin, short_code

if TYPE_CHECKING:
    from app.models.consultation import Consultation
    from app.models.patient import Patient
    from app.models.user import User


class Medicine(UUIDMixin, TimestampMixin, Base):
    """Catalogue entry. Carries no quantity — that lives on batches."""

    __tablename__ = "medicines"
    __table_args__ = (
        Index("ix_medicines_category", "category"),
        Index("ix_medicines_is_active", "is_active"),
        CheckConstraint("reorder_level >= 0", name="reorder_level_non_negative"),
    )

    #: Human-readable code, e.g. MED-2001.
    medicine_number: Mapped[str] = short_code(16)

    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    generic_name: Mapped[str | None] = mapped_column(String(200))
    category: Mapped[str | None] = mapped_column(String(120))
    manufacturer: Mapped[str | None] = mapped_column(String(160))
    rack_location: Mapped[str | None] = mapped_column(String(60))
    #: Stock at or below this is reported as Low Stock.
    reorder_level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    batches: Mapped[list["MedicineBatch"]] = relationship(
        back_populates="medicine", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def total_quantity(self) -> int:
        """Stock on hand across every batch. Computed, never stored."""
        return sum(batch.quantity for batch in self.batches)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Medicine {self.name!r}>"


class MedicineBatch(UUIDMixin, TimestampMixin, Base):
    """A received batch with its own price and expiry.

    ``quantity >= 0`` is a database constraint, so no dispensing bug can drive
    stock negative even if the service layer is wrong.
    """

    __tablename__ = "medicine_batches"
    __table_args__ = (
        UniqueConstraint("medicine_id", "batch_number", name="uq_medicine_batches_medicine_batch"),
        Index("ix_medicine_batches_medicine_id", "medicine_id"),
        Index("ix_medicine_batches_expiry_date", "expiry_date"),
        CheckConstraint("quantity >= 0", name="quantity_non_negative"),
        CheckConstraint("purchase_price >= 0", name="purchase_price_non_negative"),
        CheckConstraint("selling_price >= 0", name="selling_price_non_negative"),
    )

    medicine_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("medicines.id", ondelete="CASCADE"), nullable=False
    )
    batch_number: Mapped[str] = mapped_column(String(60), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    selling_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    #: Printed MRP, which can differ from the price actually charged.
    mrp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    received_on: Mapped[date | None] = mapped_column(Date)

    medicine: Mapped["Medicine"] = relationship(back_populates="batches")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<MedicineBatch {self.batch_number} qty={self.quantity}>"


class Prescription(UUIDMixin, TimestampMixin, Base):
    """A prescription written during a consultation."""

    __tablename__ = "prescriptions"
    __table_args__ = (
        Index("ix_prescriptions_patient_id", "patient_id"),
        Index("ix_prescriptions_doctor_id", "doctor_id"),
        Index("ix_prescriptions_status", "status"),
    )

    #: Human-readable code, e.g. RX-7712.
    prescription_number: Mapped[str] = short_code(16)

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    consultation_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("consultations.id", ondelete="SET NULL")
    )

    status: Mapped[PrescriptionStatus] = mapped_column(
        pg_enum(PrescriptionStatus, "prescription_status"),
        nullable=False,
        default=PrescriptionStatus.PENDING,
    )
    priority: Mapped[PrescriptionPriority] = mapped_column(
        pg_enum(PrescriptionPriority, "prescription_priority"),
        nullable=False,
        default=PrescriptionPriority.ROUTINE,
    )

    patient: Mapped["Patient"] = relationship(back_populates="prescriptions")
    doctor: Mapped["User | None"] = relationship()
    consultation: Mapped["Consultation | None"] = relationship(back_populates="prescriptions")
    items: Mapped[list["PrescriptionItem"]] = relationship(
        back_populates="prescription", cascade="all, delete-orphan", passive_deletes=True
    )
    dispense_records: Mapped[list["DispenseRecord"]] = relationship(back_populates="prescription")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Prescription {self.prescription_number} {self.status}>"


class PrescriptionItem(UUIDMixin, Base):
    """One prescribed medicine line.

    ``quantity_dispensed`` can never exceed ``quantity`` — enforced in the
    database, so a partial-dispense bug cannot over-issue stock.
    """

    __tablename__ = "prescription_items"
    __table_args__ = (
        Index("ix_prescription_items_prescription_id", "prescription_id"),
        Index("ix_prescription_items_medicine_id", "medicine_id"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("quantity_dispensed >= 0", name="dispensed_non_negative"),
        CheckConstraint("quantity_dispensed <= quantity", name="dispensed_within_prescribed"),
    )

    prescription_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("prescriptions.id", ondelete="CASCADE"), nullable=False
    )
    medicine_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("medicines.id", ondelete="RESTRICT")
    )

    strength: Mapped[str | None] = mapped_column(String(80))
    dosage: Mapped[str | None] = mapped_column(String(120))
    frequency: Mapped[str | None] = mapped_column(String(120))
    duration: Mapped[str | None] = mapped_column(String(80))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_dispensed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    instructions: Mapped[str | None] = mapped_column(Text)

    prescription: Mapped["Prescription"] = relationship(back_populates="items")
    medicine: Mapped["Medicine | None"] = relationship()
    dispense_records: Mapped[list["DispenseRecord"]] = relationship(back_populates="item")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<PrescriptionItem qty={self.quantity_dispensed}/{self.quantity}>"


class DispenseRecord(UUIDMixin, Base):
    """Which batch satisfied which prescription line, and how much of it.

    Needed because stock is batch-based: dispensing one line can draw from
    several batches (FEFO), and each draw is auditable.
    """

    __tablename__ = "dispense_records"
    __table_args__ = (
        Index("ix_dispense_records_prescription_id", "prescription_id"),
        Index("ix_dispense_records_batch_id", "medicine_batch_id"),
        Index("ix_dispense_records_dispensed_at", "dispensed_at"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
    )

    prescription_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("prescriptions.id", ondelete="RESTRICT"), nullable=False
    )
    prescription_item_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("prescription_items.id", ondelete="RESTRICT"), nullable=False
    )
    medicine_batch_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("medicine_batches.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    dispensed_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    dispensed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    prescription: Mapped["Prescription"] = relationship(back_populates="dispense_records")
    item: Mapped["PrescriptionItem"] = relationship(back_populates="dispense_records")
    batch: Mapped["MedicineBatch"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<DispenseRecord qty={self.quantity}>"


class PharmacySale(UUIDMixin, CreatedAtMixin, Base):
    """One over-the-counter sale at the pharmacy till.

    Deliberately separate from ``invoices``: a POS sale is a completed
    counter transaction, not an account receivable. The general billing module
    will later reference these rows rather than replace them, which is why the
    money is stored here in full rather than derived from the items.

    A walk-in customer has no ``patient_id`` — the pharmacy does not require a
    hospital registration to sell a strip of paracetamol.
    """

    __tablename__ = "pharmacy_sales"
    __table_args__ = (
        Index("ix_pharmacy_sales_created_at", "created_at"),
        Index("ix_pharmacy_sales_patient_id", "patient_id"),
        CheckConstraint("subtotal >= 0", name="subtotal_non_negative"),
        CheckConstraint("discount >= 0", name="discount_non_negative"),
        CheckConstraint("tax >= 0", name="tax_non_negative"),
        CheckConstraint("total >= 0", name="total_non_negative"),
        CheckConstraint(
            "discount_percent >= 0 AND discount_percent <= 100", name="discount_percent_range"
        ),
    )

    #: Human-readable code, e.g. POS-9001.
    sale_number: Mapped[str] = short_code(16)

    #: Null for a walk-in customer.
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="SET NULL")
    )
    #: Shown on the receipt when the buyer is not a registered patient.
    customer_name: Mapped[str | None] = mapped_column(String(160))

    sold_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("branches.id", ondelete="SET NULL")
    )

    # Money is NUMERIC throughout — never floating point.
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    #: The GST rate applied, stored so a historical receipt reprints correctly
    #: even after the rate changes.
    tax_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)

    payment_method: Mapped[PaymentMethod] = mapped_column(
        pg_enum(PaymentMethod, "payment_method"), nullable=False
    )

    patient: Mapped["Patient | None"] = relationship()
    seller: Mapped["User | None"] = relationship()
    items: Mapped[list["PharmacySaleItem"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<PharmacySale {self.sale_number} {self.total}>"


class PharmacySaleItem(UUIDMixin, Base):
    """One line on a counter sale, drawn from one batch.

    A line that spans several batches (FEFO) becomes several rows, so the sale
    stays as auditable as a prescription dispense.
    """

    __tablename__ = "pharmacy_sale_items"
    __table_args__ = (
        Index("ix_pharmacy_sale_items_sale_id", "sale_id"),
        Index("ix_pharmacy_sale_items_batch_id", "medicine_batch_id"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("unit_price >= 0", name="unit_price_non_negative"),
        CheckConstraint("line_total >= 0", name="line_total_non_negative"),
    )

    sale_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("pharmacy_sales.id", ondelete="CASCADE"), nullable=False
    )
    medicine_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("medicines.id", ondelete="RESTRICT")
    )
    medicine_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("medicine_batches.id", ondelete="RESTRICT")
    )
    #: Kept alongside the FK so an old receipt stays readable if the catalogue
    #: entry is later renamed or retired.
    medicine_name: Mapped[str] = mapped_column(String(200), nullable=False)

    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    #: The price actually charged, captured at the till — never recomputed later.
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    sale: Mapped["PharmacySale"] = relationship(back_populates="items")
    medicine: Mapped["Medicine | None"] = relationship()
    batch: Mapped["MedicineBatch | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<PharmacySaleItem {self.medicine_name} x{self.quantity}>"
