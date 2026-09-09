"""Lab results.

Shaped to the `LabResult` interface declared inside
`src/pages/doctor/Labs.tsx` — `test`, `reportedOn`, `flag`, `summary`,
`values[{analyte, value, reference, abnormal}]`, `reviewed`.

There is no creation schema. The frontend has no lab-entry UI, so no public
lab-creation endpoint exists; reports arrive through the seed for now and will
come from the laboratory's own workflow later.
"""

from __future__ import annotations

from datetime import date as date_type, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import LabFlag


class LabValueOut(BaseModel):
    """One analyte row."""

    model_config = ConfigDict(from_attributes=True)

    analyte: str
    #: Text, not numeric — results include readings like "Negative" or "< 0.01".
    value: str
    reference: str | None = None
    abnormal: bool = False


class LabResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str = Field(examples=["LAB-3301"])
    uuid: str

    patientId: str
    patientUuid: str
    patientName: str

    test: str
    reportedOn: date_type
    flag: LabFlag
    summary: str | None = None
    values: list[LabValueOut] = Field(default_factory=list)

    reviewed: bool = False
    #: Who signed the report off, and when. Both server-set.
    reviewedBy: str | None = None
    reviewedAt: datetime | None = None
    #: The clinician who ordered the test.
    orderedBy: str | None = None


class LabPage(BaseModel):
    items: list[LabResultResponse]
    page: int
    limit: int
    total: int
    total_pages: int
