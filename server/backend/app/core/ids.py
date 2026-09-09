"""Human-readable record codes.

Rows are keyed by UUID internally, but the frontend routes on and displays
business codes — ``/patients/PT-10248``, ``INV-2026-4412``, ``RX-7712``. This
module owns that formatting so the pattern is defined in exactly one place.

Allocation against the database (gap-free sequences per prefix) is wired up in
Step 3, once the tables those codes belong to exist.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CodeFormat:
    """How one entity's business code is spelled."""

    prefix: str
    width: int = 5
    year_scoped: bool = False

    def format(self, number: int, year: int | None = None) -> str:
        body = str(number).rjust(self.width, "0")
        if self.year_scoped:
            if year is None:
                raise ValueError(f"{self.prefix} codes are year-scoped; pass a year")
            return f"{self.prefix}-{year}-{body}"
        return f"{self.prefix}-{body}"

    @property
    def pattern(self) -> re.Pattern[str]:
        if self.year_scoped:
            return re.compile(rf"^{self.prefix}-\d{{4}}-\d{{{self.width},}}$")
        return re.compile(rf"^{self.prefix}-\d{{{self.width},}}$")

    def matches(self, value: str) -> bool:
        return bool(self.pattern.match(value.strip().upper()))


# Formats mirrored from the codes the existing UI already renders.
PATIENT = CodeFormat("PT")
USER = CodeFormat("USR", width=4)
# Year-scoped: appointment volume is high and per-year numbering keeps the code
# short and meaningful. Never displayed by the UI — it routes on nothing here.
APPOINTMENT = CodeFormat("APT", width=5, year_scoped=True)
PRESCRIPTION = CodeFormat("RX", width=4)
LAB_RESULT = CodeFormat("LAB", width=4)
THERAPY_SESSION = CodeFormat("TS", width=4)
MEDICINE = CodeFormat("MED", width=4)
PAYMENT = CodeFormat("PAY", width=4)
EXPENSE = CodeFormat("EXP", width=4)
INVOICE = CodeFormat("INV", width=4, year_scoped=True)

ALL_FORMATS: tuple[CodeFormat, ...] = (
    PATIENT,
    USER,
    APPOINTMENT,
    PRESCRIPTION,
    LAB_RESULT,
    THERAPY_SESSION,
    MEDICINE,
    PAYMENT,
    EXPENSE,
    INVOICE,
)


def looks_like_code(value: str) -> bool:
    """True when a path parameter is a business code rather than a UUID.

    Detail routes accept either, so ``/patients/PT-10248`` and
    ``/patients/<uuid>`` both resolve to the same record.
    """
    return any(fmt.matches(value) for fmt in ALL_FORMATS)
