"""add lab result number

The doctor's Labs table displays a ``LAB-####`` code beneath the test name, so
lab results need the same human-readable identifier every other record has.

Revision ID: b3c449578759
Revises: 91d6b62c7991
Create Date: 2026-08-24 20:38:11.660729
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'b3c449578759'
down_revision: str | None = '91d6b62c7991'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Added nullable, backfilled, then tightened — so the migration is safe on a
    # database that already holds results rather than only on an empty one.
    op.add_column('lab_results', sa.Column('lab_number', sa.String(length=16), nullable=True))
    op.execute(
        """
        UPDATE lab_results
        SET lab_number = 'LAB-' || LPAD(seq::text, 4, '0')
        FROM (
            SELECT id, 3300 + ROW_NUMBER() OVER (ORDER BY reported_on, created_at, id) AS seq
            FROM lab_results
        ) AS numbered
        WHERE lab_results.id = numbered.id
        """
    )
    op.alter_column('lab_results', 'lab_number', nullable=False)
    op.create_index(op.f('ix_lab_results_lab_number'), 'lab_results', ['lab_number'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_lab_results_lab_number'), table_name='lab_results')
    op.drop_column('lab_results', 'lab_number')
