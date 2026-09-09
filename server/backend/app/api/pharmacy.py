"""Pharmacy endpoints: catalogue, batches, inventory, dispensing and the till.

There is no DELETE. A medicine is retired, a batch is corrected — neither is
erased, because both sit behind dispense records and sale lines that have to
stay auditable.

Permission keys are the ones the frontend already uses — `pharmacy.inventory`,
`prescription.dispense`, `pharmacy.pos` — not a finer-grained set invented here.
"""

from __future__ import annotations

from datetime import date as date_type
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.dependencies import (
    CurrentPermissions,
    DbSession,
    client_ip,
    require_permission,
)
from app.core.enums import StockStatus
from app.models.user import User
from app.schemas.pharmacy import (
    BatchCreate,
    BatchOut,
    BatchUpdate,
    DispenseRequest,
    DispenseResult,
    MedicineCreate,
    MedicineDetail,
    MedicinePage,
    MedicineResponse,
    MedicineUpdate,
    PharmacyDashboard,
    SaleCreate,
    SalePage,
    SaleResponse,
)
from app.services import pharmacy_service as service

router = APIRouter(tags=["Pharmacy"])
medicines = APIRouter(tags=["Pharmacy"])

_FORBIDDEN = {
    "description": "The caller lacks the required pharmacy permission",
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
    "description": "No such medicine, batch, prescription or sale",
    "content": {"application/json": {"example": {"detail": "Medicine not found.", "code": "not_found"}}},
}
_STOCK_CONFLICT = {
    "description": "Not enough stock, or the only stock has expired",
    "content": {
        "application/json": {
            "example": {
                "detail": "Insufficient stock for Paracetamol 650 mg. 4 unit(s) available, 10 requested.",
                "code": "insufficient_stock",
            }
        }
    },
}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


@router.get(
    "/dashboard",
    response_model=PharmacyDashboard,
    summary="Pharmacy dashboard",
    description=(
        "Every figure the dashboard shows, counted in PostgreSQL — pending "
        "prescriptions, today's dispensing, sales against yesterday, the stock "
        "position and the week's revenue trend.\n\n"
        "Inventory value is returned **twice**, at cost and at retail, rather "
        "than the API guessing which the card means. Both exclude expired "
        "batches, which are not sellable stock."
    ),
    responses={403: _FORBIDDEN},
)
def dashboard(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
) -> PharmacyDashboard:
    return service.dashboard(db, user=user, permissions=permissions)


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------


@router.get(
    "/inventory",
    response_model=list[MedicineResponse],
    summary="Inventory",
    description=(
        "The catalogue with its batches aggregated into the flat shape the "
        "inventory screen reads: one quantity, one front batch, one status. "
        "The screen never has to understand the batch structure."
    ),
    responses={403: _FORBIDDEN},
)
def inventory(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
    stock_status: Annotated[StockStatus | None, Query(alias="status")] = None,
) -> list[MedicineResponse]:
    return service.inventory(db, status=stock_status)


@router.get(
    "/inventory/low-stock",
    response_model=list[MedicineResponse],
    summary="Low stock",
    description=(
        "Medicines whose **total** stock across every unexpired batch is at or "
        "below the reorder level — not one arbitrary batch.\n\n"
        "This is the reorder list, which is a different question from the "
        "`Low Stock` badge: the badge is exclusive (near-expiry stock wins over "
        "low-stock), while a medicine that is both near expiry *and* below its "
        "threshold still needs reordering, so it appears here. Out-of-stock "
        "items are included too — they are the most urgent reorder there is."
    ),
    responses={403: _FORBIDDEN},
)
def low_stock(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
) -> list[MedicineResponse]:
    return service.low_stock(db)


@router.get(
    "/inventory/near-expiry",
    response_model=list[MedicineResponse],
    summary="Near expiry",
    description=(
        "Stock whose soonest unexpired batch falls inside the near-expiry "
        "window. The window is **45 days**, taken from the frontend's original "
        "`NEAR_EXPIRY_DAYS` — not a fresh 30-day guess, which would silently "
        "reclassify stock the pharmacist already knows about."
    ),
    responses={403: _FORBIDDEN},
)
def near_expiry(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
) -> list[MedicineResponse]:
    return service.near_expiry(db)


# ---------------------------------------------------------------------------
# Medicines
# ---------------------------------------------------------------------------


@medicines.get(
    "",
    response_model=MedicinePage,
    summary="List and search medicines",
    description=(
        "`search` spans name, generic name, category and manufacturer, matched "
        "**in SQL** — the catalogue is never loaded into the API to be filtered "
        "there. `status` filters on the derived stock badge."
    ),
    responses={403: _FORBIDDEN},
)
def list_medicines(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    search: Annotated[str | None, Query(max_length=120)] = None,
    category: Annotated[str | None, Query(max_length=120)] = None,
    stock_status: Annotated[StockStatus | None, Query(alias="status")] = None,
    active: Annotated[bool | None, Query()] = True,
) -> MedicinePage:
    return service.list_medicines(
        db,
        page=page,
        limit=limit,
        search=search,
        category=category,
        status=stock_status,
        active=active,
    )


@medicines.post(
    "",
    response_model=MedicineDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Add a medicine",
    description=(
        "Creates the catalogue entry and, optionally, its opening batch in one "
        "transaction. The medicine itself holds no stock — that lives on "
        "batches, and the flat `quantity` in the response is their sum."
    ),
    responses={403: _FORBIDDEN, 409: {"description": "Already in the catalogue"}},
)
def create_medicine(
    request: Request,
    db: DbSession,
    payload: MedicineCreate,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
) -> MedicineDetail:
    medicine = service.create_medicine(db, payload=payload, user=user, ip=client_ip(request))
    return service.to_detail(medicine)


@medicines.get(
    "/{identifier}",
    response_model=MedicineDetail,
    summary="Get one medicine",
    description=(
        "Accepts either the UUID or the `MED-####` code. Includes every batch "
        "behind the aggregate figures, and the stock value at cost and at retail."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_medicine(
    db: DbSession,
    identifier: str,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
) -> MedicineDetail:
    return service.to_detail(service.resolve_medicine(db, identifier))


@medicines.put(
    "/{identifier}",
    response_model=MedicineDetail,
    summary="Update a medicine",
    description=(
        "Catalogue details only. Stock is never changed here — it moves through "
        "batches, dispensing and sales. `isActive: false` retires a medicine, "
        "keeping it on historical records but removing it from the catalogue."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Name already in use"}},
)
def update_medicine(
    request: Request,
    db: DbSession,
    identifier: str,
    payload: MedicineUpdate,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
) -> MedicineDetail:
    medicine = service.resolve_medicine(db, identifier)
    return service.to_detail(
        service.update_medicine(db, medicine=medicine, payload=payload, user=user, ip=client_ip(request))
    )


@medicines.get(
    "/{identifier}/batches",
    response_model=list[BatchOut],
    summary="Batches for a medicine",
    description="Every batch, earliest expiry first — the order stock is issued in.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def list_batches(
    db: DbSession,
    identifier: str,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
) -> list[BatchOut]:
    medicine = service.resolve_medicine(db, identifier)
    return [service.batch_out(b) for b in sorted(medicine.batches, key=lambda b: b.expiry_date)]


@medicines.post(
    "/{identifier}/batches",
    response_model=BatchOut,
    status_code=status.HTTP_201_CREATED,
    summary="Receive a batch",
    description=(
        "Batch numbers are unique per medicine, enforced by a database "
        "constraint as well as a check here.\n\n"
        "An already-expired batch is **refused**: the frontend has no historical "
        "stock-entry workflow, so a past expiry date is a mistake rather than an "
        "intentional back-dated receipt."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Duplicate batch number"}, 422: {"description": "Expired, or an invalid figure"}},
)
def add_batch(
    request: Request,
    db: DbSession,
    identifier: str,
    payload: BatchCreate,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
) -> BatchOut:
    medicine = service.resolve_medicine(db, identifier)
    return service.add_batch(db, medicine=medicine, payload=payload, user=user, ip=client_ip(request))


batches = APIRouter(tags=["Pharmacy"])


@batches.put(
    "/{batch_id}",
    response_model=BatchOut,
    summary="Correct a batch",
    description=(
        "The one path that changes stock without a dispense or a sale behind "
        "it, so a quantity correction is always audited with both the old and "
        "the new figure."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: {"description": "Duplicate batch number"}},
)
def update_batch(
    request: Request,
    db: DbSession,
    batch_id: str,
    payload: BatchUpdate,
    user: Annotated[User, Depends(require_permission("pharmacy.inventory"))],
) -> BatchOut:
    return service.update_batch(
        db, batch_id=batch_id, payload=payload, user=user, ip=client_ip(request)
    )


# ---------------------------------------------------------------------------
# Dispensing
# ---------------------------------------------------------------------------

dispensing = APIRouter(tags=["Pharmacy"])


@dispensing.post(
    "/{identifier}/dispense",
    response_model=DispenseResult,
    summary="Dispense a prescription",
    description=(
        "Issues the requested quantities and moves the inventory **in one "
        "transaction**: the prescription is locked, every line is checked "
        "against its remaining quantity and available stock, batches are drawn "
        "first-expiry-first-out, dispense records are written and the "
        "prescription's status is recomputed from its lines. Any failure rolls "
        "all of it back.\n\n"
        "The request carries only item ids and quantities. Which batches "
        "satisfy them, at what price, is decided here — a client cannot pick a "
        "cheaper or an expired batch.\n\n"
        "Batch rows are read `FOR UPDATE`, so two pharmacists dispensing the "
        "same stock serialise: the first succeeds, the second sees the reduced "
        "figure and is refused."
    ),
    responses={
        403: _FORBIDDEN,
        404: _NOT_FOUND,
        409: _STOCK_CONFLICT,
        422: {"description": "More than the prescription's remaining quantity"},
    },
)
def dispense(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    payload: DispenseRequest,
    user: Annotated[User, Depends(require_permission("prescription.dispense"))],
) -> DispenseResult:
    prescription = service.resolve_prescription(
        db, identifier, user=user, permissions=permissions
    )
    return service.dispense(
        db, prescription=prescription, payload=payload, user=user, ip=client_ip(request)
    )


# ---------------------------------------------------------------------------
# Point of sale
# ---------------------------------------------------------------------------

pos = APIRouter(tags=["Pharmacy POS"])


@pos.get(
    "/products",
    response_model=list[MedicineResponse],
    summary="Sellable products",
    description=(
        "What the till can sell, with current stock and price. Out-of-stock "
        "items are returned rather than hidden — the POS screen shows them and "
        "refuses to add them, and hiding them would make a missing medicine "
        "look like a search failure."
    ),
    responses={403: _FORBIDDEN},
)
def products(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("pharmacy.pos"))],
    search: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[MedicineResponse]:
    return service.pos_products(db, search=search, limit=limit)


@pos.post(
    "/sale",
    response_model=SaleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ring up a sale",
    description=(
        "The sale, its lines and the stock deduction share one transaction.\n\n"
        "**No money comes from the request.** Prices are read from the batch "
        "being drawn, and the subtotal, discount, GST and total are all "
        "computed here in `NUMERIC` — never floating point. The request carries "
        "medicines, quantities, a discount percentage and a payment method.\n\n"
        "A walk-in customer needs no `patientId`: the pharmacy does not require "
        "a hospital registration to sell over the counter."
    ),
    responses={403: _FORBIDDEN, 404: _NOT_FOUND, 409: _STOCK_CONFLICT},
)
def create_sale(
    request: Request,
    db: DbSession,
    permissions: CurrentPermissions,
    payload: SaleCreate,
    user: Annotated[User, Depends(require_permission("pharmacy.pos"))],
) -> SaleResponse:
    sale = service.create_sale(
        db, payload=payload, user=user, permissions=permissions, ip=client_ip(request)
    )
    return service.sale_to_response(sale)


@pos.get(
    "/sales",
    response_model=SalePage,
    summary="Sales history",
    responses={403: _FORBIDDEN},
)
def list_sales(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission("pharmacy.pos"))],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    date_from: Annotated[date_type | None, Query()] = None,
    date_to: Annotated[date_type | None, Query()] = None,
) -> SalePage:
    return service.list_sales(
        db,
        user=user,
        permissions=permissions,
        page=page,
        limit=limit,
        date_from=date_from,
        date_to=date_to,
    )


@pos.get(
    "/sales/{identifier}",
    response_model=SaleResponse,
    summary="Get one sale",
    description="Accepts either the UUID or the `POS-####` code — the receipt.",
    responses={403: _FORBIDDEN, 404: _NOT_FOUND},
)
def get_sale(
    db: DbSession,
    permissions: CurrentPermissions,
    identifier: str,
    user: Annotated[User, Depends(require_permission("pharmacy.pos"))],
) -> SaleResponse:
    return service.sale_to_response(
        service.get_sale(db, identifier=identifier, user=user, permissions=permissions)
    )


router.include_router(pos, prefix="/pos")
