"""Follow-up and Reminders.

Finds patients who are due back, drafts a message for each, and stops. The
drafts sit in a queue until somebody approves them one at a time; only the
approval route talks to a gateway, and this module never imports one.

Three rules shape everything here.

**The date is not the model's to choose.** The priority is fixed, checked in
order, and reported on every suggestion so a reviewer can see which rule fired:

1. ``clinician`` — a follow-up date written into a consultation. Wins outright.
2. ``appointment`` — the patient already has a booking. That date *is* the
   follow-up; no reminder is drafted, because telling somebody to arrange a
   visit they have arranged reads as the clinic having lost track of them.
3. ``rule`` — the clinic's standard interval since the last visit.
4. ``model`` — not implemented. The model is never asked when a patient should
   return; "sounds like about six weeks" is not a clinical decision a text
   generator gets to make, and tiers 1 to 3 already produce a date for
   everybody who qualifies.

A tier never overrides one above it: a patient with a clinician's date is
removed from consideration by the later tiers rather than appearing twice.

**A phone number is not consent.** ``patients.contact_consent`` defaults to
false. A patient with no recorded consent is listed by name for the front desk
to ring, and no draft is written for them.

**What goes on the wire is a date and a place.** No diagnosis, no medicine, no
department that would imply either. An SMS is plain text passing through a
third party to a handset that may be shared or lost.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import retrieval
from app.ai.messaging import get_messaging_provider
from app.ai.orchestrator import Orchestrator
from app.ai.prompts import followup as prompt
from app.ai.schemas import (
    FollowUpGenerateRequest,
    FollowUpGenerateResponse,
    FollowUpSuggestion,
    MessageApproveRequest,
)
from app.core.config import settings
from app.core.enums import AIAgentType, MessageStatus, PatientStatus
from app.core.errors import ConflictError, UnprocessableError
from app.models.ai import MessageDraft
from app.models.patient import Patient
from app.models.user import User

#: Drafting a reminder is scheduling work, so it needs the scheduling key.
PERMISSION = "appointment.create"

#: The clinic's standard interval, used when no clinician wrote a date down.
#: One named constant rather than a number spread across the module — and the
#: place to point a configuration setting at when the settings screen grows one.
DEFAULT_FOLLOW_UP_DAYS = 30

#: How far back to look for a missed appointment worth chasing. Beyond this the
#: patient has either come back or moved on, and a reminder is an intrusion.
MISSED_LOOKBACK_DAYS = 60

#: How soon after a missed appointment to suggest rebooking.
MISSED_REBOOK_DAYS = 7

#: Everything the model may be given about a patient is in this template too,
#: which is the test: if the deterministic version needs a field the prompt does
#: not have, the prompt is leaking something it should not.
_TEMPLATE = (
    "{clinic}: Hello {first_name}, your follow-up visit is due on {due}. "
    "Please call us to confirm a time. Reply STOP to opt out."
)


class _ReminderBody(BaseModel):
    """The only thing a model may return here: one sentence.

    Narrow on purpose. There is no field for a date, a time or a reason,
    because a schema that cannot carry them is a stronger guarantee than a
    prompt asking the model not to supply them.
    """

    body: str = Field(min_length=1, max_length=400)


def generate(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    request_id: str,
    payload: FollowUpGenerateRequest,
) -> FollowUpGenerateResponse:
    through = date.today() + timedelta(days=payload.horizonDays)

    orchestrator = Orchestrator(
        db=db,
        user=user,
        request_id=request_id,
        agent=AIAgentType.FOLLOW_UP,
        entity_type="patients",
    )
    orchestrator.enforce_rate_limit()

    candidates = retrieval.follow_up_candidates(
        db, user=user, permissions=permissions, through=through, limit=payload.limit
    )
    seen = {c["patient"].id for c in candidates}
    if len(candidates) < payload.limit:
        candidates += _by_standard_interval(
            db,
            user=user,
            permissions=permissions,
            through=through,
            limit=payload.limit - len(candidates),
            exclude=seen,
        )

    # Tier four of the spec's priority is missed appointments, which produce a
    # suggestion and nothing stronger. See _missed() for why the wording there
    # is as flat as it is.
    if len(candidates) < payload.limit:
        candidates += _missed(
            db,
            user=user,
            permissions=permissions,
            limit=payload.limit - len(candidates),
            exclude={c["patient"].id for c in candidates},
        )

    suggestions: list[FollowUpSuggestion] = []
    drafts: list[MessageDraft] = []
    skipped: list[str] = []

    for candidate in candidates:
        patient: Patient = candidate["patient"]
        name = f"{patient.first_name} {patient.last_name}".strip()

        booked = retrieval.next_appointment(
            db, patient_id=patient.id, on_or_after=date.today()
        )
        if booked is not None:
            # Tier two. Reported as a suggestion whose date came from the
            # booking, and deliberately not drafted.
            suggestions.append(
                FollowUpSuggestion(
                    patientId=str(patient.id),
                    patientName=name,
                    source="appointment",
                    dueOn=booked["date"],
                    reason=f"Already booked ({booked['number']}) — no reminder needed",
                    lastSeen=candidate.get("lastSeen"),
                )
            )
            continue

        suggestions.append(
            FollowUpSuggestion(
                patientId=str(patient.id),
                patientName=name,
                source=candidate["source"],
                dueOn=candidate["dueOn"],
                reason=candidate["reason"],
                lastSeen=candidate.get("lastSeen"),
            )
        )

        if not patient.phone:
            skipped.append(f"{name} — no phone number on file")
            continue
        if not patient.contact_consent:
            skipped.append(f"{name} — no consent to contact recorded")
            continue
        if _draft_exists(db, patient_id=patient.id):
            continue

        body, ai_written = _body(
            orchestrator,
            first_name=patient.first_name,
            due_on=candidate["dueOn"],
        )
        draft = MessageDraft(
            patient_id=patient.id,
            channel=payload.channel,
            body=body,
            reason=candidate["reason"][:255],
            due_on=datetime.combine(
                candidate["dueOn"], datetime.min.time(), tzinfo=settings.clinic_tz
            ),
            status=MessageStatus.DRAFT,
            ai_generated=ai_written,
            created_by=user.id,
        )
        db.add(draft)
        drafts.append(draft)

    db.flush()

    outcome = orchestrator.deterministic(
        detail=f"{len(suggestions)} due, {len(drafts)} drafted, {len(skipped)} skipped."
    )
    meta = outcome.meta(AIAgentType.FOLLOW_UP, requires_review=True)
    meta.notice = (
        "Drafts are queued. Nothing is sent until somebody approves each message."
    )
    return FollowUpGenerateResponse(
        meta=meta,
        suggestions=suggestions,
        drafts=[serialise(d) for d in drafts],
        skipped=skipped,
    )


def _by_standard_interval(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    through: date,
    limit: int,
    exclude: set,
) -> list[dict]:
    """Tier two: patients the clinic's own interval says are due.

    Restricted to patients whose status already says they are expected back.
    Sweeping in everybody who has not visited for a month would draft messages
    to discharged patients, which is both wrong and the kind of wrong that
    reaches somebody's phone.
    """
    from app.services.scoping import visible_branch_ids

    branch_ids = visible_branch_ids(db, user, permissions)
    cutoff = through - timedelta(days=DEFAULT_FOLLOW_UP_DAYS)

    stmt = (
        select(Patient)
        .where(
            Patient.status.in_(
                (PatientStatus.FOLLOW_UP, PatientStatus.ACTIVE_OPD, PatientStatus.IN_REHABILITATION)
            ),
            Patient.last_visit_at.is_not(None),
            Patient.last_visit_at <= cutoff,
        )
        .order_by(Patient.last_visit_at)
        .limit(limit + len(exclude))
    )
    if branch_ids is not None:
        if not branch_ids:
            return []
        stmt = stmt.where(Patient.branch_id.in_(branch_ids))

    rows = []
    for patient in db.execute(stmt).scalars():
        if patient.id in exclude:
            continue
        rows.append({
            "patient": patient,
            "dueOn": patient.last_visit_at + timedelta(days=DEFAULT_FOLLOW_UP_DAYS),
            "lastSeen": patient.last_visit_at,
            "source": "rule",
            "reason": f"No visit for {DEFAULT_FOLLOW_UP_DAYS} days (clinic standard interval)",
        })
        if len(rows) >= limit:
            break
    return rows


def _missed(
    db: Session, *, user: User, permissions: list[str], limit: int, exclude: set
) -> list[dict]:
    """Patients who did not attend, offered a reminder and nothing more.

    The wording matters more than the query. A missed appointment is an
    attendance fact; it says nothing about whether the patient is unwell, and a
    system that escalates "did not attend" into "needs urgent attention" is
    inventing a clinical judgement out of a scheduling one. So the reason reads
    "Missed appointment on <date> - follow-up reminder recommended", and there
    is no severity field for anything to raise.
    """
    rows = []
    for row in retrieval.missed_appointments(
        db,
        user=user,
        permissions=permissions,
        since=date.today() - timedelta(days=MISSED_LOOKBACK_DAYS),
        limit=limit + len(exclude),
    ):
        patient = row["patient"]
        if patient.id in exclude:
            continue
        rows.append({
            "patient": patient,
            # The reminder is for a fresh visit, dated by the clinic's standard
            # interval from the appointment they missed — not by anything the
            # missed appointment itself implies.
            "dueOn": max(date.today(), row["missedOn"] + timedelta(days=MISSED_REBOOK_DAYS)),
            "lastSeen": None,
            "source": "rule",
            "reason": (
                f"Missed appointment on {row['missedOn']:%d %b %Y} - follow-up reminder "
                "recommended"
            ),
        })
        if len(rows) >= limit:
            break
    return rows


def _draft_exists(db: Session, *, patient_id) -> bool:
    """Whether this patient already has a live reminder.

    One at a time, however often the button is pressed. Without this, running
    the sweep twice sends the patient two messages — and the second one is
    indistinguishable, to them, from the clinic having forgotten it wrote the
    first. A rejected or failed draft does not count, so the front desk can
    reject a bad one and draft again.
    """
    return db.execute(
        select(MessageDraft.id)
        .where(
            MessageDraft.patient_id == patient_id,
            MessageDraft.status.in_(
                (MessageStatus.DRAFT, MessageStatus.PENDING, MessageStatus.SENT,
                 MessageStatus.DELIVERED)
            ),
        )
        .limit(1)
    ).first() is not None


def _body(orchestrator: Orchestrator, *, first_name: str, due_on: date) -> tuple[str, bool]:
    """The message text. Template unless a model rewrote it, and it says which.

    The template is not a fallback of last resort — it is the reference the
    model's version has to be no worse than. A reminder is four facts in one
    sentence; there is not much for a language model to improve, and quite a
    lot for it to add that must not be there.
    """
    deterministic = _TEMPLATE.format(
        clinic=settings.CLINIC_NAME,
        first_name=first_name,
        due=f"{due_on:%d %b %Y}",
    )
    if not orchestrator.provider.available:
        return deterministic, False

    narrative, _ = orchestrator.structured(
        system=prompt.SYSTEM,
        task=prompt.TASK,
        data=prompt.data(
            clinic=settings.CLINIC_NAME,
            patient_first_name=first_name,
            due_on=f"{due_on:%d %b %Y}",
            phone_note="call the clinic to confirm a time",
        ),
        schema=_ReminderBody,
        prompt_version=prompt.VERSION,
        max_tokens=200,
    )
    if narrative is None:
        return deterministic, False
    if not _safe_to_send(narrative.body, due_on=due_on):
        # The model wrote something that failed the outbound check. The patient
        # gets the template; the queue is not left empty because a generator
        # misbehaved.
        return deterministic, False
    return narrative.body.strip(), True


#: Words that must never reach a phone. Not a complete list of clinical terms —
#: it cannot be — which is why the model is also told, and why every message is
#: read by a person before it goes. This is the last of three defences, not the
#: only one.
_FORBIDDEN = (
    "diagnos", "prescri", "medic", "tablet", "dose", "mg", "therapy", "physio",
    "surgery", "test result", "report", "scan", "x-ray", "biopsy", "cancer",
    "diabet", "fracture", "injur", "condition", "treatment", "rehab",
    # Urgency is a clinical claim. Nothing in a missed-appointment record
    # supports "come in immediately", and a patient who receives that sentence
    # from their clinic will act on it.
    "urgent", "immediately", "as soon as possible", "emergency", "critical",
    "serious", "worse", "deteriorat",
)


def _safe_to_send(body: str, *, due_on: date) -> bool:
    """Refuse a body that carries clinical content or the wrong date."""
    if not body.strip() or len(body) > 400:
        return False
    lowered = body.lower()
    if any(word in lowered for word in _FORBIDDEN):
        return False
    # The date the reviewer approves must be the date the agent decided on.
    return f"{due_on:%d %b %Y}".lower() in lowered or f"{due_on:%d %b}".lower() in lowered


# ---------------------------------------------------------------------------
# Approval and dispatch
# ---------------------------------------------------------------------------


def approve(
    db: Session,
    *,
    draft: MessageDraft,
    payload: MessageApproveRequest,
    user: User,
) -> MessageDraft:
    """Approve one message and hand it to the gateway.

    This is the only function in the AI layer that causes something to leave
    the building, and it is reached only from a route that requires a person's
    permission and a person's click. The agent that wrote the text cannot call
    it.
    """
    if draft.status not in (MessageStatus.DRAFT, MessageStatus.PENDING):
        raise ConflictError(
            "This message has already been dealt with.", code="message_already_handled"
        )

    if not payload.approve:
        # REJECTED, not FAILED. A person decided against this message; nothing
        # about the gateway went wrong, and a queue that cannot tell the two
        # apart will have somebody retrying a decision.
        draft.status = MessageStatus.REJECTED
        draft.approved_by = user.id
        draft.approved_at = datetime.now(timezone.utc)
        draft.failure_reason = f"Rejected by reviewer. {payload.reason}".strip()[:500]
        db.flush()
        return draft

    if payload.body is not None:
        body = payload.body.strip()
        if not body:
            raise UnprocessableError("The message cannot be empty.", code="empty_message")
        draft.body = body
        # A reviewer who rewrites the text owns it; it is no longer the model's.
        draft.ai_generated = False

    draft.approved_by = user.id
    draft.approved_at = datetime.now(timezone.utc)

    provider = get_messaging_provider()
    patient = draft.patient
    if not patient.contact_consent:
        # Consent can be withdrawn between drafting and approval.
        draft.status = MessageStatus.FAILED
        draft.failure_reason = "The patient has not consented to being contacted."
        db.flush()
        return draft

    result = provider.send(channel=draft.channel, to=patient.phone or "", body=draft.body)
    draft.provider = provider.name
    if result.accepted:
        # SENT, not DELIVERED. The gateway took it; nobody has told us it
        # arrived, and this build has no delivery callback to tell us.
        draft.status = MessageStatus.SENT
        draft.sent_at = datetime.now(timezone.utc)
        draft.provider_reference = result.reference
        draft.failure_reason = None
    else:
        draft.status = MessageStatus.PENDING
        draft.failure_reason = result.error
    db.flush()
    return draft


# ---------------------------------------------------------------------------


def serialise(draft: MessageDraft):
    from app.ai.schemas import MessageDraftResponse

    patient = draft.patient
    return MessageDraftResponse(
        id=str(draft.id),
        patientId=str(draft.patient_id),
        patientName=(
            f"{patient.first_name} {patient.last_name}".strip() if patient else ""
        ),
        channel=draft.channel,
        body=draft.body,
        reason=draft.reason or "",
        dueOn=draft.due_on.date() if draft.due_on else None,
        status=draft.status,
        aiGenerated=draft.ai_generated,
        approvedBy=(
            f"{draft.approver.first_name} {draft.approver.last_name}".strip()
            if draft.approver
            else ""
        ),
        approvedAt=draft.approved_at,
        sentAt=draft.sent_at,
        deliveredAt=draft.delivered_at,
        failureReason=draft.failure_reason or "",
        createdAt=draft.created_at,
    )
