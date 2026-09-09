"""Active-admission indexes cover Discharge Pending

A stay in Discharge Pending still occupies its bed — the patient has not left,
the checklist is only being worked through. The two partial unique indexes were
scoped to ``status = 'ADMITTED'`` alone, so once a discharge was started the
database would have allowed a second admission onto the same bed, and the same
patient into a second one.

The service already refuses both (the bed is Occupied, and
``active_admission_for_bed`` covers Discharge Pending), so this closes the gap
in the backstop rather than in the behaviour. The indexes exist precisely to
catch what application checks miss, so their predicate has to mean the same
thing the application means by "active".

Revision ID: c7a1e2f9b4d3
Revises: 1ade4b39a11d
Create Date: 2026-08-25 00:16:00

"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "c7a1e2f9b4d3"
down_revision = "1ade4b39a11d"
branch_labels = None
depends_on = None

ACTIVE = "status IN ('ADMITTED', 'DISCHARGE_PENDING')"
ADMITTED_ONLY = "status = 'ADMITTED'"

INDEXES = (
    ("uq_admissions_active_bed", "bed_id"),
    ("uq_admissions_active_patient", "patient_id"),
)


def _rebuild(predicate: str) -> None:
    for name, column in INDEXES:
        op.execute(text(f"DROP INDEX IF EXISTS {name}"))
        op.execute(
            text(f"CREATE UNIQUE INDEX {name} ON admissions ({column}) WHERE {predicate}")
        )


def upgrade() -> None:
    _rebuild(ACTIVE)


def downgrade() -> None:
    # Narrowing the predicate can only ever remove rows from the index, so this
    # cannot fail on existing data.
    _rebuild(ADMITTED_ONLY)
