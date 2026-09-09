"""AI run history, structured documents and outbound message drafts.

Three tables, and the reason each exists is accountability rather than
capability.

``ai_audit_logs`` records that an agent ran, for whom and how it ended — never
the clinical content it reasoned over. A row says "a recap was generated for
this patient by this user against this model", which is what an auditor needs;
the recap itself lives in the record it summarised.

``ai_documents`` holds an uploaded document, its OCR text and the fields an
agent extracted, in a **staging** state. Nothing here is a clinical record: the
approval step is what copies reviewed fields into one, and until then this table
is the only place the extraction exists.

``message_drafts`` is the same idea for outbound reminders. A draft is written
here, a human approves it, and only then does a provider see it. A row can
record that a provider accepted a message without claiming it was delivered.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import (
    AIAgentType,
    AIReviewStatus,
    AIRunStatus,
    DocumentKind,
    MessageChannel,
    MessageStatus,
    pg_enum,
)
from app.models.base import Base, CreatedAtMixin, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.patient import Patient
    from app.models.user import User


class AIAuditLog(UUIDMixin, CreatedAtMixin, Base):
    """One agent run.

    Deliberately thin on content. `prompt` and `completion` stay NULL unless
    ``AI_STORE_PAYLOADS`` is on, and even then the orchestrator redacts before
    writing — a debugging switch must not quietly turn the audit table into a
    second copy of the medical record.
    """

    __tablename__ = "ai_audit_logs"
    __table_args__ = (
        Index("ix_ai_audit_logs_user_id", "user_id"),
        Index("ix_ai_audit_logs_agent", "agent_type"),
        Index("ix_ai_audit_logs_created_at", "created_at"),
        Index("ix_ai_audit_logs_entity", "entity_type", "entity_id"),
        Index("ix_ai_audit_logs_request_id", "request_id"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    agent_type: Mapped[AIAgentType] = mapped_column(
        pg_enum(AIAgentType, "ai_agent_type"), nullable=False
    )
    #: What the run was about, e.g. "patients" / a patient id.
    entity_type: Mapped[str | None] = mapped_column(String(80))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))

    #: Correlates this row with the HTTP request that caused it.
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    #: The model actually used, or NULL when the run was deterministic-only.
    model: Mapped[str | None] = mapped_column(String(120))
    provider: Mapped[str | None] = mapped_column(String(60))
    prompt_version: Mapped[str | None] = mapped_column(String(60))
    #: The code around the prompt. Both versions are needed to reproduce a run:
    #: an agent that changes what it retrieves changes its output without a
    #: word of the prompt moving.
    agent_version: Mapped[str | None] = mapped_column(String(60))

    status: Mapped[AIRunStatus] = mapped_column(
        pg_enum(AIRunStatus, "ai_run_status"), nullable=False
    )
    #: Why a run failed or degraded. A message, never a stack trace.
    detail: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    #: Transient failures re-sent before this run either succeeded or gave up.
    retries: Mapped[int | None] = mapped_column(Integer)

    #: What the provider said it consumed, and what that costs at the rates the
    #: deployment configured. All three stay NULL when the provider reports
    #: nothing or no rates are set — an absent cost is honest, an estimated one
    #: would be quoted in an operations review as though somebody measured it.
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))

    #: Only populated when AI_STORE_PAYLOADS is enabled, and redacted first.
    prompt: Mapped[str | None] = mapped_column(Text)
    completion: Mapped[str | None] = mapped_column(Text)

    user: Mapped["User | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AIAuditLog {self.agent_type} {self.status}>"


class AIDocument(UUIDMixin, TimestampMixin, Base):
    """An uploaded document and what an agent read out of it.

    This is a staging area, not a clinical record. `extracted` holds the fields
    the agent proposed and `reviewed` holds what the clinician actually
    accepted, so the two remain distinguishable after the fact — which is the
    whole point of requiring a review.
    """

    __tablename__ = "ai_documents"
    __table_args__ = (
        Index("ix_ai_documents_patient_id", "patient_id"),
        Index("ix_ai_documents_status", "review_status"),
        Index("ix_ai_documents_uploaded_by", "uploaded_by"),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    kind: Mapped[DocumentKind] = mapped_column(
        pg_enum(DocumentKind, "document_kind"), nullable=False, default=DocumentKind.UNKNOWN
    )

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: The original bytes. Held in the database rather than on a public path so
    #: it can only ever be read back through an authorised endpoint.
    content: Mapped[bytes | None] = mapped_column(LargeBinary)

    #: What the OCR engine read, verbatim, before any interpretation.
    ocr_text: Mapped[str | None] = mapped_column(Text)
    ocr_provider: Mapped[str | None] = mapped_column(String(60))

    #: What the agent proposed, and what the clinician accepted. Kept apart.
    extracted: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    reviewed: Mapped[dict | None] = mapped_column(JSONB)

    review_status: Mapped[AIReviewStatus] = mapped_column(
        pg_enum(AIReviewStatus, "ai_review_status"),
        nullable=False,
        default=AIReviewStatus.PENDING,
    )
    #: True once approval has written the reviewed fields into a real record,
    #: so a second approval cannot duplicate them.
    applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: What it became — e.g. "medical_history_entries" and that row's id.
    applied_type: Mapped[str | None] = mapped_column(String(80))
    applied_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))

    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    patient: Mapped["Patient"] = relationship()
    uploader: Mapped["User | None"] = relationship(foreign_keys=[uploaded_by])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AIDocument {self.filename!r} {self.review_status}>"


class MessageDraft(UUIDMixin, TimestampMixin, Base):
    """An outbound reminder, from draft through approval to delivery.

    ``status`` distinguishes SENT from DELIVERED on purpose: a provider
    accepting a request is not proof it reached anybody, and reporting one as
    the other is how a clinic convinces itself it reminded a patient it did
    not.
    """

    __tablename__ = "message_drafts"
    __table_args__ = (
        Index("ix_message_drafts_patient_id", "patient_id"),
        Index("ix_message_drafts_status", "status"),
        Index("ix_message_drafts_due", "due_on"),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False
    )
    channel: Mapped[MessageChannel] = mapped_column(
        pg_enum(MessageChannel, "message_channel"), nullable=False, default=MessageChannel.SMS
    )
    #: The message itself. Reminders carry a date and a place, never a
    #: diagnosis — see the follow-up agent.
    body: Mapped[str] = mapped_column(Text, nullable=False)
    #: Why this patient is being contacted, for the queue rather than the wire.
    reason: Mapped[str | None] = mapped_column(String(255))
    due_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    status: Mapped[MessageStatus] = mapped_column(
        pg_enum(MessageStatus, "message_status"), nullable=False, default=MessageStatus.DRAFT
    )
    #: True when a human explicitly approved dispatch. Nothing leaves without it.
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    provider: Mapped[str | None] = mapped_column(String(60))
    provider_reference: Mapped[str | None] = mapped_column(String(120))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    #: Whether the body was drafted by a model or by the deterministic
    #: template, so the queue can label it honestly.
    ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    patient: Mapped["Patient"] = relationship()
    approver: Mapped["User | None"] = relationship(foreign_keys=[approved_by])

    def __repr__(self) -> str:  # pragma: no cover
        return f"<MessageDraft {self.channel} {self.status}>"


class AIApproval(Base, UUIDMixin, CreatedAtMixin):
    """One human decision about one AI-proposed action.

    The approvals are already implied by ``ai_documents.reviewed_by`` and
    ``message_drafts.approved_by``, so this table is redundant — deliberately.
    "Show me every AI action a person signed off, across every agent, in order"
    should be one query against one table, not a union across whatever tables
    the features happened to use. When the sixth agent arrives it writes here
    too, and the query does not change.

    A row is written *after* the action has been applied, inside the same
    transaction. There is no path that records an approval for something that
    did not then happen.
    """

    __tablename__ = "ai_approvals"
    __table_args__ = (
        Index("ix_ai_approvals_user_id", "user_id"),
        Index("ix_ai_approvals_agent", "agent_type"),
        Index("ix_ai_approvals_entity", "entity_type", "entity_id"),
        Index("ix_ai_approvals_created_at", "created_at"),
    )

    agent_type: Mapped[AIAgentType] = mapped_column(
        pg_enum(AIAgentType, "ai_agent_type"), nullable=False
    )
    #: The run this decision was about, where one is known.
    audit_log_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ai_audit_logs.id", ondelete="SET NULL")
    )
    #: Who decided. NOT NULL: an approval with no approver is not an approval.
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    #: What they decided, e.g. "document.approve" / "reminder.reject".
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    #: What it was about, and what it became.
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    applied_type: Mapped[str | None] = mapped_column(String(80))
    applied_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))

    #: Why, when the reviewer gave a reason. Never clinical content.
    note: Mapped[str | None] = mapped_column(String(500))

    user: Mapped["User"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AIApproval {self.action} {self.entity_type}>"
