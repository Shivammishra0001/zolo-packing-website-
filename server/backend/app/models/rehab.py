"""Rehabilitation plans, milestones and weekly progress points.

This is the differentiating module of the product: rehabilitation runs as a
programme (a plan with a session budget and measurable goals), not as a series
of unrelated visits.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import MilestoneStatus, RehabPlanStatus, RehabTrend, pg_enum
from app.models.base import Base, CreatedAtMixin, TimestampMixin, UUIDMixin, percentage

if TYPE_CHECKING:
    from app.models.patient import Patient
    from app.models.therapy import TherapySession
    from app.models.user import User


class RehabPlan(UUIDMixin, TimestampMixin, Base):
    """A structured programme of therapy sessions with goals and milestones."""

    __tablename__ = "rehab_plans"
    __table_args__ = (
        Index("ix_rehab_plans_patient_id", "patient_id"),
        Index("ix_rehab_plans_therapist_id", "therapist_id"),
        Index("ix_rehab_plans_status", "status"),
        CheckConstraint("total_sessions > 0", name="total_sessions_positive"),
        CheckConstraint(
            "completed_sessions >= 0 AND completed_sessions <= total_sessions",
            name="completed_within_total",
        ),
        CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="end_after_start",
        ),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    therapist_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    goals: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    total_sessions: Mapped[int] = mapped_column(Integer, nullable=False)
    frequency_per_week: Mapped[int | None] = mapped_column(Integer)
    #: Therapy modalities, e.g. ["Manual therapy", "Gait training"].
    modalities: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    status: Mapped[RehabPlanStatus] = mapped_column(
        pg_enum(RehabPlanStatus, "rehab_plan_status"), nullable=False, default=RehabPlanStatus.ACTIVE
    )

    # --- Derived values ------------------------------------------------------
    # completed_sessions, attendance_rate, adherence_rate and trend are shown
    # directly by the frontend, so they are stored — but they are DERIVED from
    # therapy_sessions and must only ever be written by the rehab service (in a
    # later step), never accepted from a client request.
    completed_sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attendance_rate: Mapped[Decimal | None] = percentage()
    adherence_rate: Mapped[Decimal | None] = percentage()
    trend: Mapped[RehabTrend] = mapped_column(
        pg_enum(RehabTrend, "rehab_trend"), nullable=False, default=RehabTrend.ON_TRACK
    )

    patient: Mapped["Patient"] = relationship(back_populates="rehab_plans")
    therapist: Mapped["User | None"] = relationship()
    milestones: Mapped[list["RehabMilestone"]] = relationship(
        back_populates="plan",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="RehabMilestone.sort_order",
    )
    progress_points: Mapped[list["RehabProgressPoint"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", passive_deletes=True
    )
    sessions: Mapped[list["TherapySession"]] = relationship(back_populates="plan")

    @property
    def progress_percentage(self) -> int:
        """Completion as a whole percentage. Computed, never stored."""
        if not self.total_sessions:
            return 0
        return round(self.completed_sessions / self.total_sessions * 100)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<RehabPlan {self.name!r} {self.completed_sessions}/{self.total_sessions}>"


class RehabMilestone(UUIDMixin, CreatedAtMixin, Base):
    """A checkpoint agreed with the patient."""

    __tablename__ = "rehab_milestones"
    __table_args__ = (Index("ix_rehab_milestones_plan_id", "rehab_plan_id"),)

    rehab_plan_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("rehab_plans.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    target_date: Mapped[date | None] = mapped_column(Date)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[MilestoneStatus] = mapped_column(
        pg_enum(MilestoneStatus, "milestone_status"), nullable=False, default=MilestoneStatus.PENDING
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    plan: Mapped["RehabPlan"] = relationship(back_populates="milestones")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<RehabMilestone {self.title!r}>"


class RehabProgressPoint(UUIDMixin, Base):
    """One weekly review — the series behind the rehabilitation charts.

    Sessions record point-in-time scores; this is the weekly rollup the UI
    plots. One row per plan per week.
    """

    __tablename__ = "rehab_progress_points"
    __table_args__ = (
        UniqueConstraint("rehab_plan_id", "week_start", name="uq_rehab_progress_plan_week"),
        Index("ix_rehab_progress_patient_recorded", "patient_id", "recorded_at"),
        CheckConstraint("pain IS NULL OR pain BETWEEN 0 AND 10", name="pain_range"),
        CheckConstraint("mobility IS NULL OR mobility BETWEEN 0 AND 100", name="mobility_range"),
        CheckConstraint("strength IS NULL OR strength BETWEEN 0 AND 100", name="strength_range"),
        CheckConstraint("adherence IS NULL OR adherence BETWEEN 0 AND 100", name="adherence_range"),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    rehab_plan_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("rehab_plans.id", ondelete="CASCADE"), nullable=False
    )

    #: Monday of the review week — the uniqueness key.
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    #: Label the chart renders, e.g. "Wk 3".
    week_label: Mapped[str | None] = mapped_column(String(16))

    #: 0-10, lower is better.
    pain: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    #: 0-100, higher is better.
    mobility: Mapped[int | None] = mapped_column(Integer)
    strength: Mapped[int | None] = mapped_column(Integer)
    adherence: Mapped[int | None] = mapped_column(Integer)

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    plan: Mapped["RehabPlan"] = relationship(back_populates="progress_points")
    patient: Mapped["Patient"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<RehabProgressPoint {self.week_label} pain={self.pain}>"
