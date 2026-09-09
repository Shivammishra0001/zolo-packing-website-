"""Medicines, batches, inventory, dispensing and the point of sale.

Field names mirror the frontend's `Medicine` type in `src/types/index.ts` and
the POS screen in `pages/pharmacist/POS.tsx`. Two things there drive the shape
of everything here:

* the frontend's `Medicine` is a **flat** row — one name, one quantity, one
  batch, one expiry — while the database is batch-based. The inventory
  endpoints aggregate batches into that flat shape so the screens need no
  reshaping;
* the POS charges **MRP**, not the batch's selling price. That is what the cart
  has always totalled, so it is what the till charges.
"""

from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.enums import PaymentMethod, PrescriptionStatus, StockStatus

# ---------------------------------------------------------------------------
# Medicines and batches
# ---------------------------------------------------------------------------


class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    batchNumber: str
    quantity: int
    purchasePrice: Decimal
    sellingPrice: Decimal
    mrp: Decimal | None = None
    expiry: date_type
    receivedOn: date_type | None = None
    #: Derived per request, never stored.
    expired: bool = False
    daysToExpiry: int = 0


class BatchCreate(BaseModel):
    batchNumber: str = Field(min_length=1, max_length=60)
    quantity: int = Field(ge=0, le=1_000_000)
    purchasePrice: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    sellingPrice: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    mrp: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    expiry: date_type
    receivedOn: date_type | None = None


class BatchUpdate(BaseModel):
    """Correct a batch. The medicine it belongs to is fixed at creation.

    ``quantity`` is accepted so a stock count can be corrected, and every such
    correction is audited — it is the one path that changes stock without a
    dispense or a sale behind it.
    """

    batchNumber: str | None = Field(default=None, min_length=1, max_length=60)
    quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    purchasePrice: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    sellingPrice: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    mrp: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    expiry: date_type | None = None
    receivedOn: date_type | None = None


class MedicineResponse(BaseModel):
    """The flat shape the frontend's ``Medicine`` interface expects.

    ``quantity``, ``batch``, ``expiry``, ``unitPrice``, ``mrp`` and ``status``
    are all aggregated from batches per request — the medicine row itself holds
    no stock.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["MED-2001"])
    uuid: str
    name: str
    genericName: str = ""
    category: str = ""
    manufacturer: str = ""
    rackLocation: str = ""

    #: Total across every batch with stock.
    quantity: int
    #: The frontend calls the reorder level a threshold.
    threshold: int
    #: The batch the next unit would come from (FEFO), for the flat display.
    batch: str = ""
    expiry: date_type | None = None
    unitPrice: Decimal = Decimal("0")
    mrp: Decimal = Decimal("0")

    status: StockStatus
    isActive: bool = True

    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class MedicineDetail(MedicineResponse):
    """One medicine with the batches behind its aggregate figures."""

    batches: list[BatchOut] = Field(default_factory=list)
    #: Stock value across batches, at cost and at retail. Both are given because
    #: the two answer different questions and the UI labels which it shows.
    stockValueAtCost: Decimal = Decimal("0")
    stockValueAtRetail: Decimal = Decimal("0")


class MedicineCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "Paracetamol 650 mg",
                "genericName": "Paracetamol",
                "category": "Analgesic",
                "manufacturer": "Cipla",
                "rackLocation": "A-1-03",
                "threshold": 60,
            }
        }
    )

    name: str = Field(min_length=1, max_length=200)
    genericName: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, max_length=120)
    manufacturer: str | None = Field(default=None, max_length=160)
    rackLocation: str | None = Field(default=None, max_length=60)
    #: Reorder level. Never negative — a threshold below zero is meaningless.
    threshold: int = Field(default=0, ge=0, le=1_000_000)
    #: An opening batch, so a medicine can be added with its first delivery.
    batch: BatchCreate | None = None


class MedicineUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    genericName: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, max_length=120)
    manufacturer: str | None = Field(default=None, max_length=160)
    rackLocation: str | None = Field(default=None, max_length=60)
    threshold: int | None = Field(default=None, ge=0, le=1_000_000)
    #: Retiring a medicine keeps it on historical records but removes it from
    #: the catalogue — nothing is deleted.
    isActive: bool | None = None


class MedicinePage(BaseModel):
    items: list[MedicineResponse]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Dispensing
# ---------------------------------------------------------------------------


class DispenseLine(BaseModel):
    """One line to dispense.

    Only the item and a quantity are accepted. Which batches satisfy it, at what
    price, is decided by the backend — a client cannot choose to draw from a
    cheaper or an expired batch.
    """

    prescriptionItemId: str
    quantity: int = Field(gt=0, le=100_000)


class DispenseRequest(BaseModel):
    items: list[DispenseLine] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _no_duplicate_lines(self) -> "DispenseRequest":
        seen = [line.prescriptionItemId for line in self.items]
        if len(seen) != len(set(seen)):
            raise ValueError("The same prescription item appears more than once.")
        return self


class DispenseRecordOut(BaseModel):
    """Where one unit of stock actually went — the audit trail."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    medicine: str
    batchNumber: str
    quantity: int
    dispensedBy: str = ""
    dispensedAt: datetime


class DispenseResult(BaseModel):
    prescriptionId: str
    status: PrescriptionStatus
    records: list[DispenseRecordOut] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Point of sale
# ---------------------------------------------------------------------------


class SaleLineCreate(BaseModel):
    """One cart line. Price is never accepted — the till decides it."""

    medicineId: str = Field(description="Medicine UUID or MED-#### code")
    quantity: int = Field(gt=0, le=10_000)


class SaleCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "items": [{"medicineId": "MED-2001", "quantity": 2}],
                "discountPercent": 5,
                "paymentMethod": "UPI",
            }
        }
    )

    items: list[SaleLineCreate] = Field(min_length=1, max_length=60)
    #: A percentage, matching the POS screen's discount control.
    discountPercent: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    paymentMethod: PaymentMethod = PaymentMethod.CASH
    #: Omitted for a walk-in customer — the pharmacy does not require a
    #: hospital registration to sell over the counter.
    patientId: str | None = None
    customerName: str | None = Field(default=None, max_length=160)


class SaleItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    medicineId: str | None = None
    medicine: str
    batchNumber: str = ""
    quantity: int
    unitPrice: Decimal
    lineTotal: Decimal


class SaleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["POS-9001"])
    uuid: str
    patientId: str | None = None
    patientName: str | None = None
    customerName: str | None = None
    soldBy: str = ""

    items: list[SaleItemOut] = Field(default_factory=list)
    subtotal: Decimal
    discountPercent: Decimal
    discount: Decimal
    taxPercent: Decimal
    tax: Decimal
    total: Decimal
    paymentMethod: PaymentMethod

    createdAt: datetime


class SalePage(BaseModel):
    items: list[SaleResponse]
    page: int
    limit: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class SalesTrendPoint(BaseModel):
    day: str
    sales: Decimal
    orders: int


class PharmacyDashboard(BaseModel):
    """Every figure the pharmacy dashboard shows, counted in PostgreSQL."""

    pendingPrescriptions: int
    dispensedToday: int
    itemsDispensedToday: int

    salesToday: Decimal
    ordersToday: int
    averageOrderValue: Decimal
    #: Yesterday's figures, so the cards' "vs yesterday" deltas are real.
    salesYesterday: Decimal
    ordersYesterday: int

    lowStock: int
    outOfStock: int
    nearExpiry: int
    inStock: int

    #: Both valuations, so the UI can label which one it shows rather than the
    #: API guessing what "inventory value" means.
    inventoryValueAtCost: Decimal
    inventoryValueAtRetail: Decimal

    salesTrend: list[SalesTrendPoint] = Field(default_factory=list)
