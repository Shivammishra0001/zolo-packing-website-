"""add patient number sequence

Revision ID: 91d6b62c7991
Revises: fc6bbdddeeb5
Create Date: 2026-08-24 16:58:43.297464
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '91d6b62c7991'
down_revision: str | None = 'fc6bbdddeeb5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Allocate PT-##### codes from a sequence.

    nextval() is atomic and never blocks, so two concurrent registrations
    cannot receive the same number — which a MAX(patient_number)+1 read would
    allow under load. Sequences may leave gaps on rollback; that is fine for a
    display identifier and is the correct trade for uniqueness.

    Starts at 10248 to continue from the numbers the existing UI already shows.
    """
    op.execute("CREATE SEQUENCE IF NOT EXISTS patient_number_seq START WITH 10248 INCREMENT BY 1")


def downgrade() -> None:
    op.execute("DROP SEQUENCE IF EXISTS patient_number_seq")
