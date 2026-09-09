"""The AI endpoints.

Every route here is gated by the permission that reading or writing the
underlying data already needs — ``patient.clinical.view`` for a recap,
``billing.view`` for an invoice check, ``finance.reports`` for the money. There
is deliberately no ``ai.use`` key: a single permission covering five features
would let a receptionist read consultation notes through the recap endpoint
that the patients module would refuse them, which is a way of losing an access
control model rather than a way of simplifying one.

Nothing here writes to a clinical or financial record on the AI's say-so. The
two routes that change anything — approving a document, approving a message —
take a person's decision as their payload and act on that.

**Approval is a server-side decision, not a client-side flag.** A request body
saying ``approved: true`` is a request, not a fact. Before either route acts it
re-resolves the caller from their token, re-reads the permission matrix from
PostgreSQL, re-loads the staged action, and confirms it is still pending and
still inside the caller's branch scope. A client that skips the UI and posts
the field directly gets the same four checks. Every accepted decision writes an
``ai_approvals`` row inside the same transaction as the change it authorised,
so "which AI actions did a human sign off" is one query rather than a union
across whatever tables the features happened to use.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import date as date_type
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, Query, Response, UploadFile
from sqlalchemy import desc, func, select

from app.ai import retrieval
from app.ai.agents import billing as billing_agent
from app.ai.agents import documentation as documentation_agent
from app.ai.agents import finance as finance_agent
from app.ai.agents import followup as followup_agent
from app.ai.agents import recap as recap_agent
from app.ai.limits import all_limits, hourly_limit
from app.ai.orchestrator import Orchestrator
from app.ai.provider import get_provider
from app.ai.schemas import (
    AIDocumentResponse,
    AIStatusResponse,
    AIUsageResponse,
    BillingCheckResponse,
    DocumentExtraction,
    DocumentReviewRequest,
    FinanceInsightsResponse,
    FollowUpGenerateRequest,
    FollowUpGenerateResponse,
    MessageApproveRequest,
    MessageDraftResponse,
    PatientRecapResponse,
)
from app.core.config import settings
from app.core.dependencies import (
    CurrentPermissions,
    CurrentUser,
    DbSession,
    client_ip,
    require_permission,
)
from app.core.enums import AIAgentType, AIReviewStatus, AuditCategory, DocumentKind, MessageStatus
from app.core.errors import NotFoundError
from app.models.ai import AIApproval, AIAuditLog, AIDocument, MessageDraft
from app.models.audit import AuditLog
from app.models.user import User
from app.services import patient_service

router = APIRouter(tags=["AI"])

_FORBIDDEN = {
    "description": "The caller lacks the permission this feature's data needs",
    "content": {
        "application/json": {
            "example": {
                "detail": "You do not have permission to perform this action.",
                "code": "insufficient_permission",
            }
        }
    },
}

_RATE_LIMITED = {
    "description": "Too many AI requests in the last hour",
    "content": {
        "application/json": {
            "example": {
                "detail": "You have made too many AI requests in the last hour. "
                "Please try again later.",
                "code": "ai_rate_limited",
            }
        }
    },
}

#: Which permission unlocks which agent. One row per feature, and the whole
#: mapping is visible in one place so widening it is a conscious act.
AGENT_PERMISSIONS: dict[AIAgentType, str] = {
    AIAgentType.PATIENT_RECAP: recap_agent.PERMISSION,
    AIAgentType.CLINICAL_DOCUMENTATION: documentation_agent.PERMISSION,
    AIAgentType.BILLING_ACCURACY: billing_agent.PERMISSION,
    AIAgentType.FOLLOW_UP: followup_agent.PERMISSION,
    AIAgentType.FINANCE_INSIGHTS: finance_agent.PERMISSION,
}


def request_id(x_request_id: Annotated[str | None, Header()] = None) -> str:
    """Correlates an audit row with the call that caused it."""
    return (x_request_id or uuid_lib.uuid4().hex)[:64]


RequestId = Annotated[str, Depends(request_id)]


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@router.get(
    "/status",
    response_model=AIStatusResponse,
    summary="Whether AI features are available to this caller",
    description=(
        "Answered honestly, including when the answer is no. A screen that can "
        "ask this can render an 'AI is off' state instead of a control that "
        "fails when pressed.\n\n"
        "`agents` lists only the features this caller's permissions allow, so "
        "the frontend does not offer a button the backend will refuse."
    ),
)
def status(db: DbSession, user: CurrentUser, permissions: CurrentPermissions) -> AIStatusResponse:
    provider = get_provider()
    orchestrator = Orchestrator(
        db=db, user=user, request_id="status", agent=AIAgentType.PATIENT_RECAP
    )
    return AIStatusResponse(
        enabled=provider.available,
        provider=provider.name,
        model=provider.model,
        ocrEnabled=settings.ocr_enabled,
        messagingEnabled=settings.messaging_enabled,
        agents=[
            agent for agent, key in AGENT_PERMISSIONS.items() if key in set(permissions)
        ],
        remainingThisHour=orchestrator.remaining_this_hour(),
        limits=all_limits(),
        remainingByAgent={
            agent.value: _remaining(db, user, agent)
            for agent, key in AGENT_PERMISSIONS.items()
            if key in set(permissions)
        },
    )


def _remaining(db, user: User, agent: AIAgentType) -> int:
    """This caller's remaining allowance for one agent.

    Shown per agent because a single "requests left" number would be a lie the
    moment the buckets diverged, and the user would find out by being refused
    something the header said they could still do.
    """
    return Orchestrator(
        db=db, user=user, request_id="status", agent=agent
    ).remaining_this_hour()


# ---------------------------------------------------------------------------
# 1. Patient recap
# ---------------------------------------------------------------------------


@router.post(
    "/patients/{identifier}/recap",
    response_model=PatientRecapResponse,
    summary="Summarise a patient's recent record",
    description=(
        "Builds the timeline in SQL and, if a model is configured, asks it for a "
        "narrative over that timeline.\n\n"
        "The timeline is always returned. When no model is available the "
        "response carries the same events, an empty summary, and a notice "
        "saying why — the endpoint does not fail, and it does not pretend.\n\n"
        "Requires `patient.clinical.view`, the same key as reading the notes it "
        "summarises."
    ),
    responses={403: _FORBIDDEN, 404: {"description": "No such patient in this branch"}, 429: _RATE_LIMITED},
)
def patient_recap(
    db: DbSession,
    identifier: str,
    permissions: CurrentPermissions,
    rid: RequestId,
    user: Annotated[User, Depends(require_permission(recap_agent.PERMISSION))],
) -> PatientRecapResponse:
    patient = patient_service.get_patient(
        db, identifier=identifier, user=user, permissions=permissions
    )
    result = recap_agent.generate(db, patient=patient, user=user, request_id=rid)
    # The audit row is the only write on this path, and it has to land: an hour's
    # rate limit that rolls back with the request is not a rate limit.
    db.commit()
    return result


# ---------------------------------------------------------------------------
# 2. Clinical documentation
# ---------------------------------------------------------------------------


@router.post(
    "/documents",
    response_model=AIDocumentResponse,
    status_code=201,
    summary="Upload a clinical document for transcription",
    description=(
        "Stores the file, reads what it can, and stages a proposed extraction "
        "for review. **Nothing enters the medical record here** — the document "
        "lands as `Pending` and stays there until a clinician approves it.\n\n"
        "With no OCR engine configured, plain text files are read directly and "
        "images are stored unread, with the response saying so. Requires "
        "`patient.clinical.edit`."
    ),
    responses={403: _FORBIDDEN, 404: {"description": "No such patient in this branch"}, 422: {"description": "Unsupported, empty or oversized file"}},
)
async def upload_document(
    db: DbSession,
    permissions: CurrentPermissions,
    rid: RequestId,
    user: Annotated[User, Depends(require_permission(documentation_agent.PERMISSION))],
    patientId: Annotated[str, Form(description="Patient UUID or PT- code")],
    file: Annotated[UploadFile, File(description="The scan or photograph")],
    kind: Annotated[DocumentKind | None, Form(description="What the uploader says it is")] = None,
    ip: Annotated[str | None, Depends(client_ip)] = None,
) -> AIDocumentResponse:
    patient = patient_service.get_patient(
        db, identifier=patientId, user=user, permissions=permissions
    )
    content = await file.read()
    document, outcome = documentation_agent.ingest(
        db,
        patient=patient,
        filename=file.filename or "document",
        content_type=file.content_type or "application/octet-stream",
        content=content,
        user=user,
        request_id=rid,
        hint=kind,
    )
    db.add(
        AuditLog(
            user_id=user.id,
            action="document.upload",
            category=AuditCategory.PATIENT,
            target_type="ai_documents",
            target_id=document.id,
            summary=patient.patient_number,
            ip_address=ip,
        )
    )
    db.commit()
    db.refresh(document)
    return _document_out(document, outcome=outcome)


@router.get(
    "/documents",
    response_model=list[AIDocumentResponse],
    summary="Documents waiting for review",
    description=(
        "The review queue, newest first. Branch-scoped through the patient each "
        "document belongs to."
    ),
    responses={403: _FORBIDDEN},
)
def list_documents(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission(documentation_agent.PERMISSION))],
    review_status: Annotated[AIReviewStatus | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
) -> list[AIDocumentResponse]:
    from app.models.patient import Patient
    from app.services.scoping import visible_branch_ids

    stmt = (
        select(AIDocument)
        .join(Patient, Patient.id == AIDocument.patient_id)
        .order_by(desc(AIDocument.created_at))
        .limit(limit)
    )
    if review_status is not None:
        stmt = stmt.where(AIDocument.review_status == review_status)

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None:
        if not branch_ids:
            return []
        stmt = stmt.where(Patient.branch_id.in_(branch_ids))

    return [_document_out(row) for row in db.execute(stmt).unique().scalars()]


@router.get(
    "/documents/{document_id}",
    response_model=AIDocumentResponse,
    summary="One staged document",
    responses={403: _FORBIDDEN, 404: {"description": "No such document in this branch"}},
)
def get_document(
    db: DbSession,
    document_id: str,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission(documentation_agent.PERMISSION))],
) -> AIDocumentResponse:
    document = _load_document(db, document_id, user=user, permissions=permissions)
    return _document_out(document, outcome=documentation_agent.outcome_for(document))


@router.get(
    "/documents/{document_id}/file",
    summary="The original upload",
    description=(
        "Served from the database through this authorised route rather than "
        "from a public path, so a link cannot be shared out of the building."
    ),
    response_class=Response,
    responses={403: _FORBIDDEN, 404: {"description": "No such document in this branch"}},
)
def get_document_file(
    db: DbSession,
    document_id: str,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission(documentation_agent.PERMISSION))],
) -> Response:
    document = _load_document(db, document_id, user=user, permissions=permissions)
    if not document.content:
        raise NotFoundError("That document has no stored file.")
    return Response(
        content=document.content,
        media_type=document.content_type,
        headers={
            # inline, not attachment: a reviewer compares the page against the
            # extraction on screen rather than downloading it first.
            "Content-Disposition": f'inline; filename="{document.filename}"',
            "Cache-Control": "private, no-store",
        },
    )


@router.post(
    "/documents/{document_id}/review",
    response_model=AIDocumentResponse,
    summary="Approve or reject a staged extraction",
    description=(
        "The human approval step, and the only way anything read off a document "
        "reaches the medical record.\n\n"
        "On approval the fields **as the reviewer left them** are written to the "
        "patient's medical history, attributed to the reviewer. What the AI "
        "originally proposed is kept alongside, unchanged, so the two can be "
        "compared afterwards.\n\n"
        "Approval writes a history entry, not a prescription: a misread strength "
        "on a phone photo must not be dispensable. Requires "
        "`patient.clinical.edit`."
    ),
    responses={
        403: _FORBIDDEN,
        404: {"description": "No such document in this branch"},
        409: {"description": "Already reviewed and applied"},
    },
)
def review_document(
    db: DbSession,
    document_id: str,
    payload: DocumentReviewRequest,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission(documentation_agent.PERMISSION))],
    ip: Annotated[str | None, Depends(client_ip)] = None,
) -> AIDocumentResponse:
    document = _load_document(db, document_id, user=user, permissions=permissions)
    document = documentation_agent.review(db, document=document, payload=payload, user=user)
    _record_approval(
        db,
        user=user,
        agent=AIAgentType.CLINICAL_DOCUMENTATION,
        action="document.approve" if payload.approve else "document.reject",
        approved=payload.approve,
        entity_type="ai_documents",
        entity_id=document.id,
        applied_type=document.applied_type,
        applied_id=document.applied_id,
        note=payload.reason,
    )
    db.add(
        AuditLog(
            user_id=user.id,
            action="document.approve" if payload.approve else "document.reject",
            category=AuditCategory.PATIENT,
            target_type="ai_documents",
            target_id=document.id,
            summary=document.patient.patient_number,
            ip_address=ip,
        )
    )
    db.commit()
    db.refresh(document)
    return _document_out(document)


# ---------------------------------------------------------------------------
# 3. Billing accuracy
# ---------------------------------------------------------------------------


@router.post(
    "/invoices/{invoice_id}/check",
    response_model=BillingCheckResponse,
    summary="Check one invoice for errors",
    description=(
        "Recomputes every total from the stored lines, compares settled "
        "payments against the stated status, looks for duplicated lines, and "
        "flags services delivered in the invoice's window that no line appears "
        "to cover.\n\n"
        "**This route never changes the invoice.** Findings that would increase "
        "a bill are reported exactly like findings that would reduce it, and "
        "acting on either is a billing clerk's decision. Requires "
        "`billing.view`."
    ),
    responses={403: _FORBIDDEN, 404: {"description": "No such invoice in this branch"}, 429: _RATE_LIMITED},
)
def check_invoice(
    db: DbSession,
    invoice_id: str,
    permissions: CurrentPermissions,
    rid: RequestId,
    user: Annotated[User, Depends(require_permission(billing_agent.PERMISSION))],
) -> BillingCheckResponse:
    # Accepts a number as well as an id: every other invoice route does, and
    # the number is what a person has in front of them.
    invoice = retrieval.invoice_for_check(
        db, identifier=invoice_id, user=user, permissions=permissions
    )
    result = billing_agent.check(db, invoice=invoice, user=user, request_id=rid)
    db.commit()
    return result


# ---------------------------------------------------------------------------
# 4. Follow-ups and reminders
# ---------------------------------------------------------------------------


@router.post(
    "/followups/generate",
    response_model=FollowUpGenerateResponse,
    summary="Find patients who are due back and draft reminders",
    description=(
        "Dates come from the clinician who wrote one down, or from the clinic's "
        "standard interval where none was written. The model is never asked "
        "when a patient should return — only, optionally, to word the sentence "
        "that carries the date.\n\n"
        "Patients with no phone number, and patients with no recorded consent to "
        "be contacted, are returned by name in `skipped` rather than messaged. "
        "Every draft is queued; **nothing is sent by this route**. Requires "
        "`appointment.create`."
    ),
    responses={403: _FORBIDDEN, 429: _RATE_LIMITED},
)
def generate_followups(
    db: DbSession,
    payload: FollowUpGenerateRequest,
    permissions: CurrentPermissions,
    rid: RequestId,
    user: Annotated[User, Depends(require_permission(followup_agent.PERMISSION))],
) -> FollowUpGenerateResponse:
    result = followup_agent.generate(
        db, user=user, permissions=permissions, request_id=rid, payload=payload
    )
    db.commit()
    return result


@router.get(
    "/messages",
    response_model=list[MessageDraftResponse],
    summary="The reminder queue",
    description="Drafted, approved and failed reminders, newest first.",
    responses={403: _FORBIDDEN},
)
def list_messages(
    db: DbSession,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission(followup_agent.PERMISSION))],
    message_status: Annotated[MessageStatus | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[MessageDraftResponse]:
    from app.models.patient import Patient
    from app.services.scoping import visible_branch_ids

    stmt = (
        select(MessageDraft)
        .join(Patient, Patient.id == MessageDraft.patient_id)
        .order_by(desc(MessageDraft.created_at))
        .limit(limit)
    )
    if message_status is not None:
        stmt = stmt.where(MessageDraft.status == message_status)

    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None:
        if not branch_ids:
            return []
        stmt = stmt.where(Patient.branch_id.in_(branch_ids))

    return [followup_agent.serialise(row) for row in db.execute(stmt).unique().scalars()]


@router.post(
    "/messages/{message_id}/approve",
    response_model=MessageDraftResponse,
    summary="Approve one reminder and send it",
    description=(
        "The only route in this application that hands a message to an SMS or "
        "WhatsApp gateway, and it requires a person.\n\n"
        "A reviewer may rewrite the body first; what they approve is what is "
        "sent, and a rewritten message stops being labelled AI-generated. With "
        "no gateway configured the message stays `Pending` and says so — it is "
        "never marked sent.\n\n"
        "A message a gateway accepts becomes `Sent`, not `Delivered`. Nobody has "
        "told us it arrived."
    ),
    responses={
        403: _FORBIDDEN,
        404: {"description": "No such message in this branch"},
        409: {"description": "Already approved, rejected or sent"},
    },
)
def approve_message(
    db: DbSession,
    message_id: str,
    payload: MessageApproveRequest,
    permissions: CurrentPermissions,
    user: Annotated[User, Depends(require_permission(followup_agent.PERMISSION))],
    ip: Annotated[str | None, Depends(client_ip)] = None,
) -> MessageDraftResponse:
    from app.services.scoping import visible_branch_ids

    draft = db.get(MessageDraft, _as_uuid(message_id, "Message not found."))
    if draft is None:
        raise NotFoundError("Message not found.")
    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and draft.patient.branch_id not in branch_ids:
        raise NotFoundError("Message not found.")

    draft = followup_agent.approve(db, draft=draft, payload=payload, user=user)
    _record_approval(
        db,
        user=user,
        agent=AIAgentType.FOLLOW_UP,
        action="reminder.approve" if payload.approve else "reminder.reject",
        approved=payload.approve,
        entity_type="message_drafts",
        entity_id=draft.id,
        note=payload.reason,
    )
    db.add(
        AuditLog(
            user_id=user.id,
            action="reminder.approve" if payload.approve else "reminder.reject",
            category=AuditCategory.PATIENT,
            target_type="message_drafts",
            target_id=draft.id,
            # The patient number, not the message body. An audit trail should
            # not become a second copy of everything sent to everybody.
            summary=draft.patient.patient_number,
            ip_address=ip,
        )
    )
    db.commit()
    db.refresh(draft)
    return followup_agent.serialise(draft)


# ---------------------------------------------------------------------------
# 5. Finance insights
# ---------------------------------------------------------------------------


@router.post(
    "/finance/insights",
    response_model=FinanceInsightsResponse,
    summary="What moved this period, and what the data can attribute it to",
    description=(
        "Collections, expenses, net and outstanding, against the period of equal "
        "length immediately before.\n\n"
        "All arithmetic is done in `Decimal` against SQL aggregates; the model "
        "is shown the results and asked only for wording. `drivers` says which "
        "departments account for the movement. `unexplained` says, whenever "
        "anything material moved, that the records show **where** it moved and "
        "not **why** — no cause is offered that the data does not carry. "
        "Requires `finance.reports`."
    ),
    responses={403: _FORBIDDEN, 429: _RATE_LIMITED},
)
def finance_insights(
    db: DbSession,
    permissions: CurrentPermissions,
    rid: RequestId,
    user: Annotated[User, Depends(require_permission(finance_agent.PERMISSION))],
    start_date: Annotated[date_type | None, Query(description="Defaults to the last 30 days.")] = None,
    end_date: date_type | None = None,
) -> FinanceInsightsResponse:
    end = end_date or date_type.today()
    start = start_date or (end - timedelta(days=29))
    if start > end:
        start, end = end, start
    result = finance_agent.insights(
        db, user=user, permissions=permissions, request_id=rid, start=start, end=end
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------


@router.get(
    "/usage",
    response_model=AIUsageResponse,
    summary="What the AI layer has actually done, and what it cost",
    description=(
        "Counts, outcomes, latency and token usage from `ai_audit_logs`, over "
        "the last N days.\n\n"
        "Every figure is a real aggregate over real rows. Where the provider "
        "reported no token usage — or no cost rates are configured — the "
        "corresponding field is null rather than estimated, because a "
        "fabricated cost is exactly the number somebody quotes in a budget "
        "meeting.\n\n"
        "Latency percentiles are computed in PostgreSQL and are null below ten "
        "samples: a p95 over four requests is not a p95. Requires "
        "`analytics.operational`."
    ),
    responses={403: _FORBIDDEN},
)
def usage(
    db: DbSession,
    user: Annotated[User, Depends(require_permission("analytics.operational"))],
    days: Annotated[int, Query(ge=1, le=90, description="Window, in days")] = 30,
) -> AIUsageResponse:
    from app.ai.usage import summarise

    return summarise(db, days=days)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _record_approval(
    db,
    *,
    user: User,
    agent: AIAgentType,
    action: str,
    approved: bool,
    entity_type: str,
    entity_id: uuid_lib.UUID,
    applied_type: str | None = None,
    applied_id: uuid_lib.UUID | None = None,
    note: str = "",
) -> None:
    """One row per human decision about an AI-proposed action.

    Written in the caller's transaction, after the action has been applied, so
    there is no path that records an approval for something that then rolled
    back. Linked to the most recent run for the same entity where one exists —
    a best-effort correlation, since a document uploaded on Monday may well be
    approved on Wednesday by somebody else.

    ``note`` carries the reviewer's reason and never clinical content: the
    approval trail should not become a second copy of the record.
    """
    audit_id = db.execute(
        select(AIAuditLog.id)
        .where(AIAuditLog.entity_id == entity_id, AIAuditLog.agent_type == agent)
        .order_by(desc(AIAuditLog.created_at))
        .limit(1)
    ).scalar_one_or_none()

    db.add(
        AIApproval(
            agent_type=agent,
            audit_log_id=audit_id,
            user_id=user.id,
            action=action,
            approved=approved,
            entity_type=entity_type,
            entity_id=entity_id,
            applied_type=applied_type,
            applied_id=applied_id,
            note=note[:500] or None,
        )
    )


def _as_uuid(value: str, message: str) -> uuid_lib.UUID:
    """A malformed id is 'not found', not 'bad request'.

    Same reason as everywhere else in this codebase: distinguishing the two
    tells a caller whether an id was well-formed, which is the first half of
    enumerating them.
    """
    try:
        return uuid_lib.UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        raise NotFoundError(message) from exc


def _load_document(
    db, document_id: str, *, user: User, permissions: list[str]
) -> AIDocument:
    from app.services.scoping import visible_branch_ids

    document = db.get(AIDocument, _as_uuid(document_id, "Document not found."))
    if document is None:
        raise NotFoundError("Document not found.")
    branch_ids = visible_branch_ids(db, user, permissions)
    if branch_ids is not None and document.patient.branch_id not in branch_ids:
        raise NotFoundError("Document not found.")
    return document


def _document_out(document: AIDocument, *, outcome=None) -> AIDocumentResponse:
    patient = document.patient
    extraction = None
    if document.extracted:
        try:
            extraction = DocumentExtraction.model_validate(document.extracted)
        except Exception:  # noqa: BLE001
            # A stored extraction that no longer validates — after a schema
            # change, say — must not take the whole queue down. The reviewer
            # sees the OCR text and types it in.
            extraction = None
    return AIDocumentResponse(
        id=str(document.id),
        patientId=str(document.patient_id),
        patientName=f"{patient.first_name} {patient.last_name}".strip() if patient else "",
        kind=document.kind,
        filename=document.filename,
        contentType=document.content_type,
        sizeBytes=document.size_bytes,
        ocrText=document.ocr_text or "",
        ocrProvider=document.ocr_provider or "",
        extracted=extraction,
        reviewStatus=document.review_status,
        applied=document.applied,
        uploadedBy=(
            f"{document.uploader.first_name} {document.uploader.last_name}".strip()
            if document.uploader
            else ""
        ),
        reviewedBy=(
            f"{document.reviewer.first_name} {document.reviewer.last_name}".strip()
            if document.reviewer
            else ""
        ),
        reviewedAt=document.reviewed_at,
        createdAt=document.created_at,
        meta=outcome.meta(AIAgentType.CLINICAL_DOCUMENTATION) if outcome else None,
    )


__all__ = ["router", "AGENT_PERMISSIONS"]
