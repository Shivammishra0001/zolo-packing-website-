"""The contracts every AI response has to satisfy.

Two kinds of model live here and the difference matters.

*Model-facing* schemas (``RecapNarrative``, ``DocumentExtraction``, ...) are
what a language model is asked to produce. They are validated the moment the
model replies; anything that fails is rejected, repaired once, and rejected
for good if it still does not fit. Nothing unvalidated reaches a route.

*Client-facing* schemas are what the browser receives. Each one carries an
:class:`AIMeta` saying which provider ran, whether it ran at all, and whether a
human still has to look. A response that cannot say where it came from is not
one this layer will send.

Field names are camelCase to match the frontend's existing types.
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.enums import (
    AIAgentType,
    AIReviewStatus,
    AIRunStatus,
    DocumentKind,
    MessageChannel,
    MessageStatus,
)

#: Three bands, no numbers. A percentage would imply a calibration this system
#: has never measured; "0.87 confident" is a fabricated statistic dressed as a
#: measurement. Each band is only ever set by a rule written down in the agent
#: that sets it — see ``documentation.py`` for the one place this is used.
Confidence = Literal["high", "medium", "low"]


class AIMeta(BaseModel):
    """Provenance, attached to every AI response.

    ``degraded`` is the important field. It is true whenever the deterministic
    half produced the answer and the model did not run — no key configured, a
    timeout, a refusal, or output that failed validation. The client shows the
    result and says plainly that the narrative part is missing, rather than
    presenting a template as if a model had written it.
    """

    agent: AIAgentType
    status: AIRunStatus
    #: "none" when nothing was called. Never a key or an endpoint.
    provider: str = "none"
    model: str = ""
    #: Which wording produced this, and which code around it. Both are needed
    #: to reproduce a run: a prompt is only half of what an agent does.
    promptVersion: str = ""
    agentVersion: str = ""
    #: Wall-clock time inside the model call. Null when no model ran.
    durationMs: int | None = None
    generatedAt: datetime
    degraded: bool = False
    #: Plain-language explanation shown to the user when degraded, e.g. "The
    #: model was unavailable; figures below are computed from your records."
    notice: str = ""
    #: True when a person must check this before it is acted on. Set by the
    #: agent, never by the model.
    requiresReview: bool = True


# ---------------------------------------------------------------------------
# 1. Patient recap
# ---------------------------------------------------------------------------


class SourceRef(BaseModel):
    """Where a statement came from, in a form the frontend can open.

    Present on every timeline entry so "View source" is a link rather than a
    promise. A recap whose claims cannot be traced back to a row is a recap
    nobody should act on.
    """

    #: The table, in the vocabulary the API already uses: consultations,
    #: therapy-sessions, labs, prescriptions, appointments, admissions, vitals.
    type: str
    id: str
    #: Human label for the citation itself — "Consultation, 24 Aug 2026".
    label: str = ""
    #: Where the record lives in the UI, when there is a screen for it.
    href: str = ""


class TimelineEvent(BaseModel):
    """One dated thing on the record, read straight out of PostgreSQL.

    The model never orders, dates or invents these. It is shown them.
    """

    #: appointment | consultation | therapy | lab | prescription | admission | vitals
    kind: str
    date: date_type
    title: str
    detail: str = ""
    #: Who recorded it, where the record names somebody.
    by: str = ""
    #: True when the entry is dated later than today. A booked session is not
    #: something that happened, and a summary that says it did is wrong in the
    #: most confident possible way.
    scheduled: bool = False
    source: SourceRef | None = None


class RecordConflict(BaseModel):
    """Two records that disagree, reported rather than resolved.

    The application finds these; nothing picks a winner. Choosing silently
    between two recorded medication lists is how a summary becomes more
    dangerous than the raw notes it replaced.
    """

    #: medication | allergy | diagnosis
    kind: str
    field: str
    message: str
    values: list[str] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)


class RecapNarrative(BaseModel):
    """What the model is allowed to return for a recap.

    Prose only. No dates, no counts, no diagnoses of its own — those come from
    the timeline it was shown, which the client renders separately.
    """

    summary: str = Field(min_length=1, max_length=1500)
    #: Things a clinician should look at, phrased as observations about the
    #: record rather than as findings about the patient.
    watchPoints: list[str] = Field(default_factory=list, max_length=6)
    #: What the record does not say. A recap that cannot name its gaps is
    #: claiming a completeness it has no way to know it has.
    gaps: list[str] = Field(default_factory=list, max_length=6)

    @field_validator("watchPoints", "gaps")
    @classmethod
    def _trim(cls, values: list[str]) -> list[str]:
        return [v.strip() for v in values if v and v.strip()][:6]


class PatientRecapResponse(BaseModel):
    meta: AIMeta
    patientId: str
    patientName: str
    #: The window the timeline covers, so the card can label itself honestly.
    since: date_type
    #: Deterministic. Always present, model or no model.
    timeline: list[TimelineEvent] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    #: Disagreements between records, found in Python and never resolved here.
    conflicts: list[RecordConflict] = Field(default_factory=list)
    #: What this window holds nothing of. Stated as a sentence the UI can show
    #: verbatim, so absence reads as absence rather than as an empty panel.
    notAvailable: list[str] = Field(default_factory=list)
    #: Narrative. Empty when degraded.
    summary: str = ""
    watchPoints: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# 2. Clinical documentation
# ---------------------------------------------------------------------------


class MedicineMatch(BaseModel):
    """A catalogue medicine that resembles what was written on the page.

    A suggestion for a human, never a substitution. "Paracetemol" is not
    silently corrected to "Paracetamol" and dispensed against: the reviewer is
    shown both and asked, because the alternative is a system that quietly
    decides which drug a smudged word meant.
    """

    medicineId: str
    name: str
    strength: str = ""
    #: 0-1, from the string-similarity ratio that produced the match. This one
    #: *is* measured — it is a property of two strings, not a guess about the
    #: world — so it is reported as the number it is.
    similarity: float
    #: True when the written name matches the catalogue name exactly.
    exact: bool = False


class ExtractedMedicine(BaseModel):
    """One medicine line, exactly as written, plus what it might be.

    ``name`` is always the transcription. ``matches`` is what the catalogue
    offers. Nothing merges the two.
    """

    name: str = Field(min_length=1, max_length=200)
    strength: str = ""
    dosage: str = ""
    frequency: str = ""
    duration: str = ""
    instructions: str = ""
    #: Candidates from the medicines table, best first. Empty is normal.
    matches: list[MedicineMatch] = Field(default_factory=list, max_length=3)
    #: Fields whose value could not be found verbatim in the OCR text, or that
    #: the reader was unsure of. Named individually because "the document was
    #: low confidence" does not tell a reviewer which line to squint at.
    flagged: list[str] = Field(default_factory=list)


class DocumentExtraction(BaseModel):
    """The structured reading of one document, before anybody approves it.

    ``uncertain`` is not decoration. A handwritten prescription that reads
    "?diabetes" must still read as a question after extraction — turning a
    clinician's uncertainty into a confirmed field is the specific failure this
    field exists to prevent.
    """

    kind: DocumentKind = DocumentKind.UNKNOWN
    #: Whose document this appears to be, as written on it. Never used to
    #: reassign the record — the uploader already chose the patient.
    patientNameOnDocument: str = ""
    documentDate: date_type | None = None
    prescriber: str = ""
    medicines: list[ExtractedMedicine] = Field(default_factory=list, max_length=30)
    diagnosis: str = ""
    notes: str = ""
    #: Verbatim fragments the reader could not resolve, kept as written.
    uncertain: list[str] = Field(default_factory=list, max_length=20)
    confidence: Confidence = "low"
    #: Per-field bands, where they can be justified. A field appears here only
    #: when a rule in the agent set it; absent means "not assessed", which is
    #: different from "high".
    fieldConfidence: dict[str, Confidence] = Field(default_factory=dict)
    #: Values the model produced that do not appear anywhere in the OCR text.
    #: This is the guard against a reading being quietly upgraded — "5 mg" on
    #: the page becoming "500 mg" in the structure.
    unsupported: list[str] = Field(default_factory=list, max_length=20)


class AIDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patientId: str
    patientName: str = ""
    kind: DocumentKind
    filename: str
    contentType: str
    sizeBytes: int
    #: What the engine read. Shown beside the extraction so a reviewer can
    #: compare the two rather than trusting one.
    ocrText: str = ""
    ocrProvider: str = ""
    extracted: DocumentExtraction | None = None
    reviewStatus: AIReviewStatus
    applied: bool = False
    uploadedBy: str = ""
    reviewedBy: str = ""
    reviewedAt: datetime | None = None
    createdAt: datetime
    meta: AIMeta | None = None


class DocumentReviewRequest(BaseModel):
    """What a clinician actually accepted.

    They send back the fields, edited as they see fit. The AI's original
    extraction is kept alongside, unchanged, so the two can be compared later.
    """

    approve: bool = True
    kind: DocumentKind | None = None
    medicines: list[ExtractedMedicine] | None = None
    diagnosis: str | None = None
    notes: str | None = None
    #: Why it was rejected, when it was.
    reason: str = ""


# ---------------------------------------------------------------------------
# 3. Billing accuracy
# ---------------------------------------------------------------------------


class BillingFinding(BaseModel):
    """One thing that looks wrong on an invoice.

    Every finding is a *question for a human*. None of them changes an amount,
    and the ones that would increase a bill are flagged the same as the ones
    that would reduce it — an assistant that only ever finds undercharges is a
    revenue tool wearing a correctness costume.
    """

    #: arithmetic | unbilled_service | duplicate_line | payment_mismatch | missing_rate
    code: str
    severity: Literal["high", "medium", "low"]
    message: str
    #: Where the money differs, when the finding is arithmetic. Positive means
    #: the invoice is higher than the recomputation.
    delta: Decimal | None = None
    #: What the finding refers to, for the UI to highlight.
    reference: str = ""


class BillingCheckResponse(BaseModel):
    meta: AIMeta
    invoiceId: str
    invoiceNumber: str
    #: Recomputed in Python from the stored lines, never by the model.
    recomputed: dict[str, Decimal] = Field(default_factory=dict)
    stored: dict[str, Decimal] = Field(default_factory=dict)
    #: Arithmetic that does not add up. These are not suggestions and not AI
    #: output: the stored figures contradict the stored lines, which is a
    #: defect in the data. Kept in their own list so a screen cannot present
    #: "this total is wrong" with the same weight as "was this session billed?"
    systemErrors: list[BillingFinding] = Field(default_factory=list)
    #: Heuristics. A person decides.
    findings: list[BillingFinding] = Field(default_factory=list)
    #: Cases the check deliberately did not judge, and why. Named so a clean
    #: result cannot be mistaken for a complete one.
    notAssessed: list[str] = Field(default_factory=list)
    #: True when neither list holds anything. Stated explicitly so the UI does
    #: not have to infer "clean" from an empty list it might have failed to load.
    clean: bool = True
    #: Narrative, optional, and never the source of a number.
    summary: str = ""


# ---------------------------------------------------------------------------
# 4. Follow-up and reminders
# ---------------------------------------------------------------------------


class FollowUpSuggestion(BaseModel):
    """A proposed follow-up date and the reason it was proposed.

    ``source`` is the whole point. The priority runs clinician, then an
    existing appointment, then the clinic's rule, then — never, in this build —
    a model. The client shows which one fired so nobody mistakes a suggestion
    for an instruction.
    """

    patientId: str
    patientName: str
    #: clinician: a date written into a consultation.
    #: appointment: the patient is already booked; that date is the follow-up.
    #: rule: the clinic's standard interval.
    #: model: never produced. Present so the field can describe a build that
    #: enables it without the vocabulary having to change underneath clients.
    source: Literal["clinician", "appointment", "rule", "model"]
    dueOn: date_type
    reason: str = ""
    lastSeen: date_type | None = None


class MessageDraftResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patientId: str
    patientName: str = ""
    channel: MessageChannel
    body: str
    reason: str = ""
    dueOn: date_type | None = None
    status: MessageStatus
    aiGenerated: bool = False
    approvedBy: str = ""
    approvedAt: datetime | None = None
    #: Set when a provider took the message. Not a delivery receipt.
    sentAt: datetime | None = None
    deliveredAt: datetime | None = None
    failureReason: str = ""
    createdAt: datetime


class FollowUpGenerateRequest(BaseModel):
    #: How far ahead to look for patients who are due. Bounded so one request
    #: cannot draft a message to the entire database.
    horizonDays: int = Field(14, ge=1, le=90)
    channel: MessageChannel = MessageChannel.SMS
    limit: int = Field(25, ge=1, le=100)


class FollowUpGenerateResponse(BaseModel):
    meta: AIMeta
    suggestions: list[FollowUpSuggestion] = Field(default_factory=list)
    drafts: list[MessageDraftResponse] = Field(default_factory=list)
    #: Patients who were due but have no usable phone number or no consent on
    #: file. Named so the front desk can call them instead.
    skipped: list[str] = Field(default_factory=list)


class MessageApproveRequest(BaseModel):
    approve: bool = True
    #: A reviewer may rewrite the text before it goes. What is approved is what
    #: is sent — never the version the model wrote, unless they left it alone.
    body: str | None = Field(default=None, max_length=600)
    reason: str = ""


# ---------------------------------------------------------------------------
# 5. Finance insights
# ---------------------------------------------------------------------------


class FinanceMetric(BaseModel):
    label: str
    current: Decimal
    previous: Decimal
    #: Absolute change. Percentages are computed here too, but only where the
    #: previous period is non-zero — otherwise the field stays None rather than
    #: reporting an infinite rise.
    delta: Decimal
    percent: float | None = None


class FinanceDriver(BaseModel):
    """A movement the data can actually attribute.

    Only produced where one component's change accounts for a stated share of
    the total change. Where it cannot be attributed, the response says so in
    ``unexplained`` instead of guessing at a cause.
    """

    label: str
    #: The two figures the delta is the difference of. Present so a reader can
    #: check the claim without leaving the panel: "Therapy 80,000 -> 110,000"
    #: is explainable in a way that "Therapy +30,000" is not.
    previous: Decimal
    current: Decimal
    delta: Decimal
    percent: float | None = None
    #: Share of the total movement this component accounts for, 0–1.
    share: float


class FinanceInsightsResponse(BaseModel):
    meta: AIMeta
    period: str
    comparedWith: str
    metrics: list[FinanceMetric] = Field(default_factory=list)
    drivers: list[FinanceDriver] = Field(default_factory=list)
    #: Stated plainly whenever the movement is not accounted for by the
    #: components above. This is a required output, not an error case.
    unexplained: str = ""
    summary: str = ""


class FinanceNarrative(BaseModel):
    """What the model may add to a finance report: wording, not figures."""

    summary: str = Field(min_length=1, max_length=1200)
    observations: list[str] = Field(default_factory=list, max_length=5)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


class AIAgentUsage(BaseModel):
    """One agent's activity over the window.

    ``p50Ms``/``p95Ms`` are null below ten timed samples, and the token and
    cost fields are null when nothing reported them. Null means "not
    reported"; the dashboard renders it that way rather than as zero, because
    the two are different facts and only one of them is flattering.
    """

    agent: AIAgentType
    runs: int = 0
    succeeded: int = 0
    degraded: int = 0
    failed: int = 0
    invalidOutput: int = 0
    rateLimited: int = 0
    p50Ms: int | None = None
    p95Ms: int | None = None
    inputTokens: int | None = None
    outputTokens: int | None = None
    estimatedCost: float | None = None
    hourlyLimit: int = 0


class AIUsageResponse(BaseModel):
    """The operations view: what ran, how it went, what it consumed."""

    windowDays: int
    totalRuns: int = 0
    succeeded: int = 0
    degraded: int = 0
    failed: int = 0
    invalidOutput: int = 0
    rateLimited: int = 0
    inputTokens: int | None = None
    outputTokens: int | None = None
    estimatedCost: float | None = None
    byAgent: list[AIAgentUsage] = Field(default_factory=list)

    #: Counted from the feature tables rather than the audit log, because these
    #: are outcomes rather than runs: a document can be uploaded once and
    #: approved days later by somebody else.
    documentsProcessed: int = 0
    documentsApproved: int = 0
    remindersDrafted: int = 0
    approvalsRecorded: int = 0


class AIStatusResponse(BaseModel):
    """What the frontend asks before drawing an AI control.

    Reporting ``enabled: false`` honestly is what lets every screen render an
    "AI is off" state instead of a spinner that never resolves.
    """

    enabled: bool
    provider: str = "none"
    model: str = ""
    ocrEnabled: bool = False
    messagingEnabled: bool = False
    #: Which agents this caller's permissions allow.
    agents: list[AIAgentType] = Field(default_factory=list)
    #: Requests left this hour, for the caller. Kept for the header line; the
    #: per-agent figures below are the accurate ones once buckets diverge.
    remainingThisHour: int = 0
    #: Each agent's hourly allowance, so a refusal is never a surprise.
    limits: dict[str, int] = Field(default_factory=dict)
    #: What this caller has left, per agent they may use.
    remainingByAgent: dict[str, int] = Field(default_factory=dict)
