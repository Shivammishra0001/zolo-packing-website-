"""initial empty baseline

Revision ID: c390e79190ef
Revises: 
Create Date: 2026-08-24 15:56:54.666317
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c390e79190ef'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
