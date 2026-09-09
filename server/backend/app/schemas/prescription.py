"""Prescriptions.

Mirrors the frontend's `Prescription` and `PrescriptionItem` types. Creation
only — dispensing belongs to the pharmacy module and is deliberately absent
here, including any stock check.
"""

from __future__ import annotations

from datetime import date as date_type, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import PrescriptionPriority, PrescriptionStatus, StockStatus


class PrescriptionItemOut(BaseModel):
    """Matches the frontend ``PrescriptionItem`` interface.

    ``id`` and ``quantityDispensed`` are additions the pharmacy needs: it
    dispenses per line and has to know what is left on each.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    medicine: str
    strength: str = ""
    dosage: str = ""
    frequency: str = ""
    duration: str = ""
    quantity: int
    #: Issued so far. `quantity - quantityDispensed` is what remains.
    quantityDispensed: int = 0
    instructions: str = ""


class PrescriptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["RX-7712"])
    uuid: str

    patientId: str
    patientUuid: str
    patientName: str

    doctor: str = ""
    doctorId: str = ""
    #: The encounter this was written during, when there was one.
    consultationId: str | None = None

    date: date_type
    items: list[PrescriptionItemOut] = Field(default_factory=list)
    status: PrescriptionStatus
    priority: PrescriptionPriority

    createdAt: datetime | None = None


class PrescriptionItemCreate(BaseModel):
    """One prescribed line, as the consultation form sends it.

    ``medicine`` is the catalogue name the form's dropdown supplies; the backend
    resolves it to a medicine row and refuses an unknown one.
    """

    medicine: str = Field(min_length=1, max_length=200)
    strength: str | None = Field(default=None, max_length=80)
    dosage: str = Field(min_length=1, max_length=120)
    frequency: str = Field(min_length=1, max_length=120)
    duration: str = Field(min_length=1, max_length=80)
    quantity: int = Field(gt=0, le=1000)
    instructions: str | None = Field(default=None, max_length=2000)


class PrescriptionCreate(BaseModel):
    """A new prescription.

    ``doctorId`` and ``status`` are absent by design: the prescriber is the
    authenticated user, and a new prescription is always Pending until the
    pharmacy acts on it.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "patientId": "PT-10248",
                "priority": "Routine",
                "items": [
                    {
                        "medicine": "Etoricoxib 90 mg",
                        "dosage": "1 tablet",
                        "frequency": "Once daily after breakfast",
                        "duration": "10 days",
                        "quantity": 10,
                        "instructions": "Take with food.",
                    }
                ],
            }
        }
    )

    patientId: str = Field(description="Patient UUID or PT-##### code")
    consultationId: str | None = None
    priority: PrescriptionPriority = PrescriptionPriority.ROUTINE
    items: list[PrescriptionItemCreate] = Field(min_length=1, max_length=30)


class PrescriptionPage(BaseModel):
    items: list[PrescriptionResponse]
    page: int
    limit: int
    total: int
    total_pages: int


class MedicineOption(BaseModel):
    """The catalogue entry the consultation form's dropdown needs.

    Deliberately thin: a name to prescribe, and a stock signal so the form can
    show the "out of stock — the pharmacy will suggest a substitution" note it
    already has. Prices, batches and quantities belong to the pharmacy module
    and are not exposed here.
    """

    id: str = Field(examples=["MED-2001"])
    name: str
    genericName: str | None = None
    category: str | None = None
    strength: str | None = None
    status: StockStatus
