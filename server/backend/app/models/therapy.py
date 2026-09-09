"""Therapy sessions, the exercises performed in them, and the exercise library."""

from __future__ import annotations

import uuid
from datetime import date, time
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import (
    AttendanceStatus,
    TherapySessionStatus,
    TherapyType,
    pg_enum,
)
from app.models.base import Base, CreatedAtMixin, TimestampMixin, UUIDMixin, short_code

if TYPE_CHECKING:
    from app.models.patient import Patient
    from app.models.rehab import RehabPlan
    from app.models.user import User


class ExerciseLibrary(UUIDMixin, TimestampMixin, Base):
    """Catalogue of exercises, grouped by therapy type."""

    __tablename__ = "exercise_library"
    __table_args__ = (
        UniqueConstraint("category", "name", name="uq_exercise_library_category_name"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[TherapyType] = mapped_column(pg_enum(TherapyType, "therapy_type"), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str | None] = mapped_column(Text)
    #: Suggested minutes, used to pre-fill the session form.
    default_duration: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ExerciseLibrary {self.name!r}>"


class TherapySession(UUIDMixin, TimestampMixin, Base):
    """One delivered (or scheduled) therapy session.

    ``rehab_plan_id`` is nullable on purpose: the frontend's session object has
    no plan reference today, so sessions can be created before the service layer
    resolves the owning plan. It is modelled because a session logically belongs
    to a plan, and the plan's ``completed_sessions`` is derived from these rows.
    """

    __tablename__ = "therapy_sessions"
    __table_args__ = (
        Index("ix_therapy_sessions_patient_id", "patient_id"),
        Index("ix_therapy_sessions_therapist_id", "therapist_id"),
        Index("ix_therapy_sessions_session_date", "session_date"),
        Index("ix_therapy_sessions_therapist_date", "therapist_id", "session_date"),
        Index("ix_therapy_sessions_plan_id", "rehab_plan_id"),
        # A session's position within its programme ("session 7 of 24"). Partial,
        # because a session not yet attached to a plan has no position, and NULLs
        # would otherwise all collide.
        Index(
            "uq_therapy_sessions_plan_sequence",
            "rehab_plan_id",
            "sequence_in_plan",
            unique=True,
            postgresql_where=text("rehab_plan_id IS NOT NULL AND sequence_in_plan IS NOT NULL"),
        ),
        CheckConstraint(
            "sequence_in_plan IS NULL OR sequence_in_plan > 0", name="sequence_positive"
        ),
        CheckConstraint("pain_before IS NULL OR pain_before BETWEEN 0 AND 10", name="pain_before_range"),
        CheckConstraint("pain_after IS NULL OR pain_after BETWEEN 0 AND 10", name="pain_after_range"),
        CheckConstraint(
            "mobility_score IS NULL OR mobility_score BETWEEN 0 AND 100", name="mobility_range"
        ),
        CheckConstraint(
            "strength_score IS NULL OR strength_score BETWEEN 0 AND 100", name="strength_range"
        ),
        CheckConstraint("duration IS NULL OR duration > 0", name="duration_positive"),
    )

    #: Human-readable code, e.g. TS-5501 — what the UI shows as the session id.
    session_number: Mapped[str] = short_code(16)
    #: Position within the owning plan: 1, 2, 3… Allocated by the service, never
    #: sent by a client, and unique per plan.
    sequence_in_plan: Mapped[int | None] = mapped_column(Integer)

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    therapist_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    rehab_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("rehab_plans.id", ondelete="SET NULL")
    )

    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time | None] = mapped_column(Time)
    #: Minutes actually delivered.
    duration: Mapped[int | None] = mapped_column(Integer)
    session_type: Mapped[TherapyType] = mapped_column(
        pg_enum(TherapyType, "therapy_type"), nullable=False
    )
    room: Mapped[str | None] = mapped_column(String(120))

    status: Mapped[TherapySessionStatus] = mapped_column(
        pg_enum(TherapySessionStatus, "therapy_session_status"),
        nullable=False,
        default=TherapySessionStatus.SCHEDULED,
    )
    attendance_status: Mapped[AttendanceStatus | None] = mapped_column(
        pg_enum(AttendanceStatus, "attendance_status")
    )

    #: Clinical scores captured at the end of the session.
    pain_before: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    pain_after: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    mobility_score: Mapped[int | None] = mapped_column(Integer)
    strength_score: Mapped[int | None] = mapped_column(Integer)

    therapist_notes: Mapped[str | None] = mapped_column(Text)
    #: Free-text progress summary written by the therapist.
    progress: Mapped[str | None] = mapped_column(Text)
    next_session_date: Mapped[date | None] = mapped_column(Date)

    patient: Mapped["Patient"] = relationship()
    therapist: Mapped["User | None"] = relationship()
    plan: Mapped["RehabPlan | None"] = relationship(back_populates="sessions")
    exercises: Mapped[list["TherapySessionExercise"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<TherapySession {self.session_number} {self.session_type}>"


class TherapySessionExercise(UUIDMixin, CreatedAtMixin, Base):
    """An exercise performed within a session, with its prescribed dose."""

    __tablename__ = "therapy_session_exercises"
    __table_args__ = (Index("ix_session_exercises_session_id", "therapy_session_id"),)

    therapy_session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("therapy_sessions.id", ondelete="CASCADE"), nullable=False
    )
    exercise_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("exercise_library.id", ondelete="SET NULL")
    )
    #: Kept alongside the FK so a session note stays readable even if the
    #: library entry is later renamed or retired.
    exercise_name: Mapped[str] = mapped_column(String(200), nullable=False)

    sets: Mapped[int | None] = mapped_column(Integer)
    repetitions: Mapped[int | None] = mapped_column(Integer)
    #: Minutes spent on this exercise.
    duration: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)

    session: Mapped["TherapySession"] = relationship(back_populates="exercises")
    exercise: Mapped["ExerciseLibrary | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<TherapySessionExercise {self.exercise_name!r}>"
