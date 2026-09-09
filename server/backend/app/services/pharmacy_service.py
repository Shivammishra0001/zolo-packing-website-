"""Pharmacy business rules: inventory, dispensing and the point of sale.

Three invariants hold everywhere in this module:

* **stock never goes negative.** Every deduction reads its batches with
  ``FOR UPDATE`` and checks the total before writing, so two tills cannot spend
  the same units;
* **expired stock is never issued.** Expired batches are excluded at the query
  that selects them, not filtered afterwards;
* **money is Decimal.** No total anywhere is computed in floating point, and no
  price is ever taken from the request.
"""

from __future__ import annotations

import logging
import uuid as uuid_lib
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.enums import (
    AuditCategory,
    PaymentMethod,
    PrescriptionStatus,
    StockStatus,
)
from app.core.errors import ConflictError, NotFoundError, UnprocessableError
from app.core.ids import MEDICINE, PRESCRIPTION
from app.models.audit import AuditLog
from app.models.pharmacy import (
    DispenseRecord,
    Medicine,
    MedicineBatch,
    PharmacySale,
    PharmacySaleItem,
    Prescription,
)
from app.models.user import User
from app.repositories import clinical_repository as clinical_repo
from app.repositories import pharmacy_repository as repo
from app.schemas.pharmacy import (
    BatchCreate,
    BatchOut,
    BatchUpdate,
    DispenseRecordOut,
    DispenseRequest,
    DispenseResult,
    MedicineCreate,
    MedicineDetail,
    MedicinePage,
    MedicineResponse,
    MedicineUpdate,
    PharmacyDashboard,
    SaleCreate,
    SaleItemOut,
    SalePage,
    SaleResponse,
    SalesTrendPoint,
)
from app.services.consultation_service import resolve_patient
from app.services.scoping import visible_branch_ids

logger = logging.getLogger(__name__)

#: GST charged at the till. 12% is what the POS screen has always applied.
GST_PERCENT = Decimal("12")

#: Rupees — the POS rounds every money figure to whole units, as its cart does.
MONEY = Decimal("1")


def _money(value: Decimal) -> Decimal:
    """Round to whole rupees, half up — matching the POS cart's arithmetic."""
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def _dispensable(batch: MedicineBatch, today: date_type) -> bool:
    return batch.quantity > 0 and batch.expiry_date >= today


def total_stock(medicine: Medicine, today: date_type | None = None) -> int:
    """Units that could be issued — expired batches do not count as stock."""
    today = today or date_type.today()
    return sum(b.quantity for b in medicine.batches if _dispensable(b, today))


def fefo_batches(medicine: Medicine, today: date_type | None = None) -> list[MedicineBatch]:
    today = today or date_type.today()
    return sorted(
        (b for b in medicine.batches if _dispensable(b, today)),
        key=lambda b: (b.expiry_date, b.created_at or datetime.min),
    )


def stock_status(medicine: Medicine, today: date_type | None = None) -> StockStatus:
    """The badge the inventory screen shows.

    Order matters and mirrors the frontend's original rule: nothing on hand is
    Out of Stock, an imminent expiry outranks quantity, then the reorder level
    decides Low versus In Stock.
    """
    today = today or date_type.today()
    on_hand = total_stock(medicine, today)
    if on_hand == 0:
        return StockStatus.OUT_OF_STOCK

    soonest = min((b.expiry_date for b in medicine.batches if _dispensable(b, today)), default=None)
    if soonest is not None and (soonest - today).days <= repo.NEAR_EXPIRY_DAYS:
        return StockStatus.NEAR_EXPIRY

    if on_hand <= (medicine.reorder_level or 0):
        return StockStatus.LOW_STOCK
    return StockStatus.IN_STOCK


def to_response(medicine: Medicine, today: date_type | None = None) -> MedicineResponse:
    """Flatten a medicine and its batches into the shape the UI expects."""
    today = today or date_type.today()
    queue = fefo_batches(medicine, today)
    # The flat display shows the batch the next unit would come from.
    front = queue[0] if queue else None

    return MedicineResponse(
        id=medicine.medicine_number,
        uuid=str(medicine.id),
        name=medicine.name,
        genericName=medicine.generic_name or "",
        category=medicine.category or "",
        manufacturer=medicine.manufacturer or "",
        rackLocation=medicine.rack_location or "",
        quantity=total_stock(medicine, today),
        threshold=medicine.reorder_level or 0,
        batch=front.batch_number if front else "",
        expiry=front.expiry_date if front else None,
        unitPrice=front.selling_price if front else Decimal("0"),
        mrp=(front.mrp if front and front.mrp is not None else (front.selling_price if front else Decimal("0"))),
        status=stock_status(medicine, today),
        isActive=medicine.is_active,
        createdAt=medicine.created_at,
        updatedAt=medicine.updated_at,
    )


def batch_out(batch: MedicineBatch, today: date_type | None = None) -> BatchOut:
    today = today or date_type.today()
    return BatchOut(
        id=str(batch.id),
        batchNumber=batch.batch_number,
        quantity=batch.quantity,
        purchasePrice=batch.purchase_price,
        sellingPrice=batch.selling_price,
        mrp=batch.mrp,
        expiry=batch.expiry_date,
        receivedOn=batch.received_on,
        expired=batch.expiry_date < today,
        daysToExpiry=(batch.expiry_date - today).days,
    )


def to_detail(medicine: Medicine, today: date_type | None = None) -> MedicineDetail:
    today = today or date_type.today()
    batches = sorted(medicine.batches, key=lambda b: b.expiry_date)
    live = [b for b in batches if _dispensable(b, today)]

    base = to_response(medicine, today)
    return MedicineDetail(
        **base.model_dump(),
        batches=[batch_out(b, today) for b in batches],
        stockValueAtCost=sum((b.purchase_price * b.quantity for b in live), Decimal("0")),
        stockValueAtRetail=sum(
            ((b.mrp if b.mrp is not None else b.selling_price) * b.quantity for b in live),
            Decimal("0"),
        ),
    )


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------


def resolve_medicine(db: Session, identifier: str) -> Medicine:
    medicine: Medicine | None = None
    if MEDICINE.matches(identifier):
        medicine = repo.get_medicine_by_number(db, identifier)
    else:
        try:
            medicine = repo.get_medicine(db, uuid_lib.UUID(identifier))
        except ValueError:
            medicine = repo.get_medicine_by_number(db, identifier)

    if medicine is None:
        raise NotFoundError("Medicine not found.")
    return medicine


def list_medicines(
    db: Session,
    *,
    page: int,
    limit: int,
    search: str | None = None,
    category: str | None = None,
    status: StockStatus | None = None,
    active: bool | None = True,
) -> MedicinePage:
    """The catalogue. Search and category filter in SQL; stock status, which is
    derived from batches, is applied after aggregation."""
    rows, total = repo.list_medicines(
        db,
        search=search,
        category=category,
        active=active,
        offset=0 if status else (page - 1) * limit,
        limit=10_000 if status else limit,
    )

    today = date_type.today()
    items = [to_response(m, today) for m in rows]

    if status is not None:
        items = [i for i in items if i.status is status]
        total = len(items)
        items = items[(page - 1) * limit : (page - 1) * limit + limit]

    return MedicinePage(
        items=items,
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def _audit(db: Session, user: User, action: str, target_type: str, target_id, summary: str, ip):
    db.add(
        AuditLog(
            user_id=user.id,
            action=action,
            category=AuditCategory.PHARMACY,
            target_type=target_type,
            target_id=target_id,
            summary=summary,
            ip_address=ip,
        )
    )


def create_medicine(
    db: Session, *, payload: MedicineCreate, user: User, ip: str | None
) -> Medicine:
    """Add a catalogue entry, optionally with its opening batch, in one transaction."""
    if repo.find_medicine_by_name(db, payload.name) is not None:
        raise ConflictError(f"{payload.name!r} is already in the catalogue.", code="duplicate_medicine")

    medicine = Medicine(
        medicine_number=MEDICINE.format(repo.next_medicine_number(db)),
        name=payload.name.strip(),
        generic_name=payload.genericName,
        category=payload.category,
        manufacturer=payload.manufacturer,
        rack_location=payload.rackLocation,
        reorder_level=payload.threshold,
        is_active=True,
    )
    db.add(medicine)
    db.flush()

    if payload.batch is not None:
        _build_batch(medicine, payload.batch)

    _audit(db, user, "MEDICINE_CREATED", "medicines", medicine.id, f"{medicine.medicine_number}: {medicine.name}", ip)
    db.commit()
    db.refresh(medicine)

    logger.info("Medicine %s created by %s", medicine.medicine_number, user.id)
    return medicine


def update_medicine(
    db: Session, *, medicine: Medicine, payload: MedicineUpdate, user: User, ip: str | None
) -> Medicine:
    data = payload.model_dump(exclude_unset=True)

    if "name" in data and data["name"]:
        clash = repo.find_medicine_by_name(db, data["name"])
        if clash is not None and clash.id != medicine.id:
            raise ConflictError(f"{data['name']!r} is already in the catalogue.", code="duplicate_medicine")

    for wire, column in (
        ("name", "name"),
        ("genericName", "generic_name"),
        ("category", "category"),
        ("manufacturer", "manufacturer"),
        ("rackLocation", "rack_location"),
        ("threshold", "reorder_level"),
        ("isActive", "is_active"),
    ):
        if wire in data and data[wire] is not None:
            setattr(medicine, column, data[wire])

    db.add(medicine)
    _audit(db, user, "INVENTORY_UPDATED", "medicines", medicine.id, f"{medicine.medicine_number}: {medicine.name}", ip)
    db.commit()
    db.refresh(medicine)
    return medicine


# ---------------------------------------------------------------------------
# Batches
# ---------------------------------------------------------------------------


def _build_batch(medicine: Medicine, payload: BatchCreate) -> MedicineBatch:
    batch = MedicineBatch(
        medicine_id=medicine.id,
        batch_number=payload.batchNumber.strip(),
        quantity=payload.quantity,
        purchase_price=payload.purchasePrice,
        selling_price=payload.sellingPrice,
        mrp=payload.mrp if payload.mrp is not None else payload.sellingPrice,
        expiry_date=payload.expiry,
        received_on=payload.receivedOn or date_type.today(),
    )
    medicine.batches.append(batch)
    return batch


def add_batch(
    db: Session, *, medicine: Medicine, payload: BatchCreate, user: User, ip: str | None
) -> BatchOut:
    """Receive a delivery.

    An already-expired batch is refused: the frontend has no historical
    stock-entry workflow, so a past expiry date is a mistake rather than an
    intentional back-dated receipt.
    """
    if payload.expiry < date_type.today():
        raise UnprocessableError(
            f"Batch {payload.batchNumber} expired on {payload.expiry.isoformat()} "
            "and cannot be received into stock."
        )
    if repo.find_batch(db, medicine.id, payload.batchNumber) is not None:
        raise ConflictError(
            f"Batch {payload.batchNumber} already exists for {medicine.name}.",
            code="duplicate_batch",
        )

    batch = _build_batch(medicine, payload)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        # The unique constraint fired — another till added the same batch
        # between the check above and this insert.
        raise ConflictError(
            f"Batch {payload.batchNumber} already exists for {medicine.name}.",
            code="duplicate_batch",
        ) from exc

    _audit(
        db, user, "MEDICINE_BATCH_CREATED", "medicine_batches", batch.id,
        f"{medicine.medicine_number} batch {batch.batch_number}: {batch.quantity} units", ip,
    )
    db.commit()
    db.refresh(batch)

    logger.info("Batch %s added to %s by %s", batch.batch_number, medicine.medicine_number, user.id)
    return batch_out(batch)


def update_batch(
    db: Session, *, batch_id: str, payload: BatchUpdate, user: User, ip: str | None
) -> BatchOut:
    try:
        batch = repo.get_batch(db, uuid_lib.UUID(batch_id))
    except ValueError:
        batch = None
    if batch is None:
        raise NotFoundError("Batch not found.")

    data = payload.model_dump(exclude_unset=True)
    before = batch.quantity

    if "batchNumber" in data and data["batchNumber"]:
        clash = repo.find_batch(db, batch.medicine_id, data["batchNumber"])
        if clash is not None and clash.id != batch.id:
            raise ConflictError(
                f"Batch {data['batchNumber']} already exists for this medicine.",
                code="duplicate_batch",
            )
        batch.batch_number = data["batchNumber"].strip()

    for wire, column in (
        ("quantity", "quantity"),
        ("purchasePrice", "purchase_price"),
        ("sellingPrice", "selling_price"),
        ("mrp", "mrp"),
        ("expiry", "expiry_date"),
        ("receivedOn", "received_on"),
    ):
        if wire in data and data[wire] is not None:
            setattr(batch, column, data[wire])

    db.add(batch)
    # A manual quantity change is the one path that moves stock without a
    # dispense or a sale behind it, so it is always audited with both figures.
    summary = f"batch {batch.batch_number}"
    if batch.quantity != before:
        summary += f": stock corrected {before} -> {batch.quantity}"
    _audit(db, user, "INVENTORY_UPDATED", "medicine_batches", batch.id, summary, ip)
    db.commit()
    db.refresh(batch)
    return batch_out(batch)


# ---------------------------------------------------------------------------
# Inventory views
# ---------------------------------------------------------------------------


def inventory(db: Session, *, status: StockStatus | None = None) -> list[MedicineResponse]:
    today = date_type.today()
    rows = [to_response(m, today) for m in repo.all_medicines(db)]
    return [r for r in rows if status is None or r.status is status]


def low_stock(db: Session) -> list[MedicineResponse]:
    """Total stock at or below the reorder level — counted across every batch.

    The reorder list, which is deliberately broader than the ``Low Stock``
    badge. The badge is exclusive — near-expiry outranks low-stock — but a
    medicine that is both still needs reordering, so it belongs here. Out of
    Stock is included for the same reason: nothing left is the most urgent
    reorder there is.
    """
    today = date_type.today()
    return [
        r
        for m in repo.all_medicines(db)
        if (r := to_response(m, today)).quantity <= r.threshold
    ]


def near_expiry(db: Session) -> list[MedicineResponse]:
    today = date_type.today()
    return [r for r in (to_response(m, today) for m in repo.all_medicines(db)) if r.status is StockStatus.NEAR_EXPIRY]


# ---------------------------------------------------------------------------
# Stock deduction — the shared core of dispensing and selling
# ---------------------------------------------------------------------------


def _draw_stock(
    db: Session, medicine: Medicine, quantity: int
) -> list[tuple[MedicineBatch, int]]:
    """Take ``quantity`` units from a medicine, earliest expiry first.

    Returns which batches were drawn from and how much of each, so the caller
    can write the audit rows. The batches are locked for the rest of the
    transaction, so nothing else can spend the same units.

    Raises before writing anything if the stock is not there.
    """
    today = date_type.today()
    batches = repo.lock_dispensable_batches(db, medicine.id, today)
    available = sum(b.quantity for b in batches)

    if available < quantity:
        if available == 0 and repo.has_expired_stock(db, medicine.id):
            raise ConflictError(
                f"The only stock of {medicine.name} has expired and cannot be issued.",
                code="expired_stock",
            )
        raise ConflictError(
            f"Insufficient stock for {medicine.name}. "
            f"{available} unit(s) available, {quantity} requested.",
            code="insufficient_stock",
        )

    drawn: list[tuple[MedicineBatch, int]] = []
    remaining = quantity
    for batch in batches:
        if remaining == 0:
            break
        take = min(batch.quantity, remaining)
        batch.quantity -= take
        db.add(batch)
        drawn.append((batch, take))
        remaining -= take

    return drawn


# ---------------------------------------------------------------------------
# Prescription dispensing
# ---------------------------------------------------------------------------


def dispense(
    db: Session,
    *,
    prescription: Prescription,
    payload: DispenseRequest,
    user: User,
    ip: str | None,
) -> DispenseResult:
    """Issue a prescription's medicines and move the inventory, atomically.

    One transaction covers the whole thing: the prescription is locked, every
    line is validated against remaining quantity and available stock, batches
    are drawn FEFO, dispense records are written and the prescription's status
    is recomputed. Any failure rolls all of it back — there is no state in which
    stock has moved but the prescription does not know about it.
    """
    if prescription.status is PrescriptionStatus.DISPENSED:
        raise ConflictError(
            f"{prescription.prescription_number} has already been fully dispensed.",
            code="already_dispensed",
        )
    if prescription.status is PrescriptionStatus.CANCELLED:
        raise ConflictError(
            f"{prescription.prescription_number} was cancelled and cannot be dispensed.",
            code="prescription_cancelled",
        )

    # Serialise against another pharmacist working the same prescription.
    repo.lock_prescription(db, prescription.id)
    db.refresh(prescription)

    by_id = {str(item.id): item for item in prescription.items}
    plan: list[tuple[object, int]] = []

    # Validate every line before touching any stock, so a bad third line does
    # not leave the first two already issued.
    for line in payload.items:
        item = by_id.get(line.prescriptionItemId)
        if item is None:
            raise NotFoundError(f"Prescription item {line.prescriptionItemId} not found.")
        if item.medicine is None:
            raise UnprocessableError(
                "This prescription line is not linked to a catalogue medicine."
            )

        remaining = item.quantity - item.quantity_dispensed
        if remaining <= 0:
            raise ConflictError(
                f"{item.medicine.name} has already been fully dispensed on this prescription.",
                code="line_already_dispensed",
            )
        if line.quantity > remaining:
            raise UnprocessableError(
                f"{item.medicine.name}: {remaining} unit(s) remain on this prescription, "
                f"{line.quantity} requested."
            )
        plan.append((item, line.quantity))

    records: list[DispenseRecord] = []
    for item, quantity in plan:
        for batch, taken in _draw_stock(db, item.medicine, quantity):
            record = DispenseRecord(
                prescription_id=prescription.id,
                prescription_item_id=item.id,
                medicine_batch_id=batch.id,
                quantity=taken,
                dispensed_by=user.id,
                dispensed_at=datetime.now(timezone.utc),
            )
            db.add(record)
            records.append(record)
        item.quantity_dispensed += quantity
        db.add(item)

    db.flush()
    prescription.status = _recompute_status(prescription)
    db.add(prescription)

    _audit(
        db, user, "PRESCRIPTION_DISPENSED", "prescriptions", prescription.id,
        f"{prescription.prescription_number}: {len(plan)} line(s), {sum(q for _, q in plan)} unit(s)",
        ip,
    )
    db.commit()
    db.refresh(prescription)

    logger.info(
        "Prescription %s dispensed by %s (%s line(s))",
        prescription.prescription_number,
        user.id,
        len(plan),
    )

    return DispenseResult(
        prescriptionId=prescription.prescription_number,
        status=prescription.status,
        records=[
            DispenseRecordOut(
                id=str(r.id),
                medicine=r.batch.medicine.name if r.batch and r.batch.medicine else "",
                batchNumber=r.batch.batch_number if r.batch else "",
                quantity=r.quantity,
                dispensedBy=user.full_name,
                dispensedAt=r.dispensed_at,
            )
            for r in records
        ],
    )


def _recompute_status(prescription: Prescription) -> PrescriptionStatus:
    """The status implied by the lines — never set directly by a caller.

    Note there is no path back to Pending: dispensing is one-way until a
    reversal workflow exists.
    """
    issued = sum(item.quantity_dispensed for item in prescription.items)
    ordered = sum(item.quantity for item in prescription.items)

    if issued == 0:
        return PrescriptionStatus.PENDING
    if issued >= ordered:
        return PrescriptionStatus.DISPENSED
    return PrescriptionStatus.PARTIALLY_DISPENSED


def resolve_prescription(
    db: Session, identifier: str, *, user: User, permissions: list[str]
) -> Prescription:
    """Find a prescription this pharmacist is entitled to dispense.

    Branch scoping is part of the lookup, not an afterthought: without it a
    pharmacist at one site could dispense against a prescription written for a
    patient at another simply by knowing its number, drawing down stock that is
    not theirs to move.
    """
    row: Prescription | None = None
    if PRESCRIPTION.matches(identifier):
        row = clinical_repo.get_prescription_by_number(db, identifier)
    else:
        try:
            row = clinical_repo.get_prescription(db, uuid_lib.UUID(identifier))
        except ValueError:
            row = None

    if row is None:
        raise NotFoundError("Prescription not found.")

    branch_ids = visible_branch_ids(db, user, permissions)
    # 404 rather than 403 — a 403 would confirm the prescription exists.
    if branch_ids is not None and row.patient.branch_id not in branch_ids:
        raise NotFoundError("Prescription not found.")
    return row


# ---------------------------------------------------------------------------
# Point of sale
# ---------------------------------------------------------------------------


def sale_to_response(sale: PharmacySale) -> SaleResponse:
    return SaleResponse(
        id=sale.sale_number,
        uuid=str(sale.id),
        patientId=sale.patient.patient_number if sale.patient else None,
        patientName=sale.patient.full_name if sale.patient else None,
        customerName=sale.customer_name,
        soldBy=sale.seller.full_name if sale.seller else "",
        items=[
            SaleItemOut(
                id=str(i.id),
                medicineId=i.medicine.medicine_number if i.medicine else None,
                medicine=i.medicine_name,
                batchNumber=i.batch.batch_number if i.batch else "",
                quantity=i.quantity,
                unitPrice=i.unit_price,
                lineTotal=i.line_total,
            )
            for i in sale.items
        ],
        subtotal=sale.subtotal,
        discountPercent=sale.discount_percent,
        discount=sale.discount,
        taxPercent=sale.tax_percent,
        tax=sale.tax,
        total=sale.total,
        paymentMethod=sale.payment_method,
        createdAt=sale.created_at,
    )


def pos_products(db: Session, *, search: str | None = None, limit: int = 100) -> list[MedicineResponse]:
    """What the till can sell: in-catalogue medicines with their current price.

    Out-of-stock items are returned rather than hidden, because the POS screen
    shows them and refuses to add them — hiding them would make a missing
    medicine look like a search failure.
    """
    rows, _ = repo.list_medicines(db, search=search, active=True, limit=limit)
    today = date_type.today()
    return [to_response(m, today) for m in rows]


def create_sale(
    db: Session, *, payload: SaleCreate, user: User, permissions: list[str], ip: str | None
) -> PharmacySale:
    """Ring up a counter sale and move the inventory, atomically.

    Prices come from the batch being drawn, never from the request — a client
    cannot discount itself by sending its own figures. The sale, its lines and
    the stock deduction share one transaction.
    """
    patient = None
    if payload.patientId and payload.patientId != "walk-in":
        patient = resolve_patient(db, payload.patientId, user, permissions)

    # Resolve the whole cart before drawing anything, so an unknown medicine on
    # the last line does not leave earlier lines already deducted.
    resolved = [(resolve_medicine(db, line.medicineId), line.quantity) for line in payload.items]

    sale = PharmacySale(
        sale_number=f"POS-{repo.next_sale_number(db)}",
        patient_id=patient.id if patient else None,
        customer_name=payload.customerName,
        sold_by=user.id,
        branch_id=user.branch_id,
        payment_method=payload.paymentMethod,
        discount_percent=payload.discountPercent,
        tax_percent=GST_PERCENT,
    )
    db.add(sale)
    db.flush()

    subtotal = Decimal("0")
    for medicine, quantity in resolved:
        for batch, taken in _draw_stock(db, medicine, quantity):
            # The till charges MRP, which is what the POS cart has always
            # totalled; selling_price is the wholesale figure behind it.
            unit_price = batch.mrp if batch.mrp is not None else batch.selling_price
            line_total = _money(unit_price * taken)
            subtotal += line_total
            sale.items.append(
                PharmacySaleItem(
                    medicine_id=medicine.id,
                    medicine_batch_id=batch.id,
                    medicine_name=medicine.name,
                    quantity=taken,
                    unit_price=unit_price,
                    line_total=line_total,
                )
            )

    sale.subtotal = _money(subtotal)
    sale.discount = _money(sale.subtotal * payload.discountPercent / Decimal("100"))
    taxable = sale.subtotal - sale.discount
    sale.tax = _money(taxable * GST_PERCENT / Decimal("100"))
    sale.total = taxable + sale.tax

    db.add(sale)
    _audit(
        db, user, "POS_SALE_CREATED", "pharmacy_sales", sale.id,
        f"{sale.sale_number}: {len(sale.items)} line(s), {sale.total}", ip,
    )
    db.commit()
    db.refresh(sale)

    logger.info("POS sale %s rung up by %s", sale.sale_number, user.id)
    return sale


def list_sales(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    page: int,
    limit: int,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
) -> SalePage:
    rows, total = repo.list_sales(
        db,
        branch_ids=visible_branch_ids(db, user, permissions),
        date_from=date_from,
        date_to=date_to,
        offset=(page - 1) * limit,
        limit=limit,
    )
    return SalePage(
        items=[sale_to_response(r) for r in rows],
        page=page,
        limit=limit,
        total=total,
        total_pages=max(1, -(-total // limit)),
    )


def get_sale(db: Session, *, identifier: str, user: User, permissions: list[str]) -> PharmacySale:
    sale: PharmacySale | None = None
    if identifier.upper().startswith("POS-"):
        sale = repo.get_sale_by_number(db, identifier)
    else:
        try:
            sale = repo.get_sale(db, uuid_lib.UUID(identifier))
        except ValueError:
            sale = None

    if sale is None:
        raise NotFoundError("Sale not found.")

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and sale.branch_id is not None and sale.branch_id not in branch_ids:
        raise NotFoundError("Sale not found.")
    return sale


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def dashboard(db: Session, *, user: User, permissions: list[str]) -> PharmacyDashboard:
    """Every figure the pharmacy dashboard shows, counted in PostgreSQL."""
    today = date_type.today()
    yesterday = today - timedelta(days=1)
    branch_ids = visible_branch_ids(db, user, permissions)

    rows = [to_response(m, today) for m in repo.all_medicines(db)]
    counts = {status: 0 for status in StockStatus}
    for row in rows:
        counts[row.status] += 1

    medicines = repo.all_medicines(db)
    at_cost = Decimal("0")
    at_retail = Decimal("0")
    for medicine in medicines:
        for batch in medicine.batches:
            if not _dispensable(batch, today):
                continue
            at_cost += batch.purchase_price * batch.quantity
            at_retail += (batch.mrp if batch.mrp is not None else batch.selling_price) * batch.quantity

    revenue_today, orders_today, units_today = repo.sales_totals(db, today)
    revenue_yesterday, orders_yesterday, _ = repo.sales_totals(db, yesterday)
    prescriptions_today, items_today = repo.dispensed_today(db, today)

    trend = {day: (Decimal("0"), 0) for day in range(7)}
    for day, revenue, orders in repo.sales_trend(db, 7, today):
        trend[(today - day).days] = (revenue, orders)

    return PharmacyDashboard(
        pendingPrescriptions=repo.pending_prescription_count(db, branch_ids),
        dispensedToday=prescriptions_today,
        itemsDispensedToday=items_today,
        salesToday=revenue_today,
        ordersToday=orders_today,
        averageOrderValue=_money(revenue_today / orders_today) if orders_today else Decimal("0"),
        salesYesterday=revenue_yesterday,
        ordersYesterday=orders_yesterday,
        lowStock=counts[StockStatus.LOW_STOCK],
        outOfStock=counts[StockStatus.OUT_OF_STOCK],
        nearExpiry=counts[StockStatus.NEAR_EXPIRY],
        inStock=counts[StockStatus.IN_STOCK],
        inventoryValueAtCost=_money(at_cost),
        inventoryValueAtRetail=_money(at_retail),
        salesTrend=[
            SalesTrendPoint(
                day=_WEEKDAYS[(today - timedelta(days=offset)).weekday()],
                sales=trend[offset][0],
                orders=trend[offset][1],
            )
            for offset in range(6, -1, -1)
        ],
    )
