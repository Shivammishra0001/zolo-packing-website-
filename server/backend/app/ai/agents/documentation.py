"""Clinical Documentation.

A clinician photographs a prescription or a referral letter; the engine reads
it; the reading is proposed as structured fields; a clinician corrects and
accepts it; only then does anything enter the medical record.

Two decisions in here are worth defending.

**Approval writes a medical *history* entry, not a prescription.** It would be
straightforward to turn extracted medicine lines into a real prescription that
the pharmacy could dispense against. It would also mean a misread strength on a
phone photo could reach a patient through a dispensing counter. What approval
produces instead is a dated, attributed record of what the document said —
useful to read, impossible to dispense from. Writing the prescription stays a
deliberate act in the prescriptions module.

**The deterministic reader never claims high confidence.** A regular expression
that finds "Tab Amoxicillin 500mg" has matched a pattern; it has not understood
a page. The confidence bands are set by the rule in :func:`_confidence` and by
nothing else — there is no score anywhere in this file that was invented to
look precise.

**Nothing is upgraded silently.** Two checks enforce that after extraction,
whichever reader produced it:

* :func:`ground_in_source` compares every structured value against the OCR text
  and lists anything that is not there verbatim. This is what catches "5 mg" on
  the page becoming "500 mg" in the structure — the single most dangerous thing
  a document reader can do, because the result looks entirely normal.
* :func:`match_medicines` looks each written name up in the catalogue and
  attaches candidates. It never replaces the name. "Paracetemol" stays
  "Paracetemol" with a note that "Paracetamol" exists; a reviewer decides which
  drug the smudge meant, because a system that decides silently will one day
  decide wrongly and nobody will be able to see that it did.
"""

from __future__ import annotations

import re
import uuid as uuid_lib
from datetime import date, datetime, timezone
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.ocr import ACCEPTED_TYPES, MAX_UPLOAD_BYTES, OCRUnavailable, get_ocr_provider
from app.ai.orchestrator import Orchestrator, RunOutcome
from app.ai.prompts import documentation as prompt
from app.ai.schemas import (
    DocumentExtraction,
    DocumentReviewRequest,
    ExtractedMedicine,
    MedicineMatch,
)
from app.core.enums import AIAgentType, AIRunStatus, DocumentKind, MedicalHistoryType
from app.core.errors import ConflictError, UnprocessableError
from app.models.ai import AIDocument
from app.models.pharmacy import Medicine
from app.models.patient import MedicalHistoryEntry, Patient
from app.models.user import User

#: Uploading a clinical document is editing the clinical record, so it needs
#: the key that editing the clinical record needs.
PERMISSION = "patient.clinical.edit"


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------


def ingest(
    db: Session,
    *,
    patient: Patient,
    filename: str,
    content_type: str,
    content: bytes,
    user: User,
    request_id: str,
    hint: DocumentKind | None = None,
) -> tuple[AIDocument, RunOutcome]:
    """Store a document, read it, and stage a proposed extraction.

    Nothing written here is a clinical record. The row lands with
    ``review_status = PENDING`` and stays that way until a person acts on it.
    """
    if content_type not in ACCEPTED_TYPES:
        raise UnprocessableError(
            "That file type cannot be read. Upload a JPEG, PNG, WebP, PDF or text file.",
            code="unsupported_document_type",
        )
    if not content:
        raise UnprocessableError("The uploaded file is empty.", code="empty_document")
    if len(content) > MAX_UPLOAD_BYTES:
        raise UnprocessableError(
            f"That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            code="document_too_large",
        )

    orchestrator = Orchestrator(
        db=db,
        user=user,
        request_id=request_id,
        agent=AIAgentType.CLINICAL_DOCUMENTATION,
        entity_type="patients",
        entity_id=patient.id,
    )
    orchestrator.enforce_rate_limit()

    engine = get_ocr_provider()
    ocr_text = ""
    ocr_error = ""
    try:
        ocr_text = engine.extract_text(content=content, content_type=content_type)
    except OCRUnavailable as exc:
        # Not a failure of the upload. The document is stored, the reviewer is
        # told it could not be read automatically, and they type it in.
        ocr_error = str(exc)

    extraction: DocumentExtraction | None = None
    if ocr_text:
        extraction, outcome = orchestrator.structured(
            system=prompt.SYSTEM,
            task=prompt.TASK,
            data=prompt.data(ocr_text=ocr_text, hint=hint.display if hint else ""),
            schema=DocumentExtraction,
            prompt_version=prompt.VERSION,
        )
        if extraction is None:
            # The model did not run, or produced something that failed
            # validation. Fall back to reading the text with rules.
            extraction = read_text(ocr_text, hint=hint)
        # Both readers go through the same two checks. A model's output is not
        # more trustworthy than a regex's here; it is differently wrong.
        extraction = ground_in_source(extraction, ocr_text)
        extraction = match_medicines(db, extraction)
    else:
        outcome = orchestrator.deterministic(detail=ocr_error or "No text could be read.")

    document = AIDocument(
        patient_id=patient.id,
        kind=(extraction.kind if extraction else (hint or DocumentKind.UNKNOWN)),
        filename=filename[:255],
        content_type=content_type,
        size_bytes=len(content),
        content=content,
        ocr_text=ocr_text or None,
        ocr_provider=engine.name if ocr_text else None,
        extracted=extraction.model_dump(mode="json") if extraction else {},
        uploaded_by=user.id,
    )
    db.add(document)
    db.flush()

    if ocr_error:
        outcome.detail = ocr_error
    return document, outcome


# ---------------------------------------------------------------------------
# The deterministic reader
# ---------------------------------------------------------------------------

#: "Tab Amoxicillin 500mg 1-0-1 x 5 days" and the shapes near it. Loose on
#: purpose — a line that half-matches becomes an uncertain fragment rather than
#: a confident field.
_MEDICINE_LINE = re.compile(
    r"^\s*(?:\d+[\.\)]\s*)?(?:(?P<form>tab|cap|syp|syr|inj|oint|drops?)\.?\s+)?"
    r"(?P<name>[A-Za-z][A-Za-z0-9\-\s]{2,60}?)\s*"
    r"(?P<strength>\d+\s*(?:mg|mcg|g|ml|iu|%)\b)?\s*"
    r"(?P<dosage>\d\s*-\s*\d\s*-\s*\d)?\s*"
    r"(?:[x×]\s*(?P<duration>\d+\s*(?:day|days|week|weeks|month|months)))?\s*$",
    re.IGNORECASE,
)

_DATE_PATTERNS = (
    (re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"), (1, 2, 3)),
    (re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b"), (3, 2, 1)),
)

_KIND_HINTS: tuple[tuple[DocumentKind, tuple[str, ...]], ...] = (
    (DocumentKind.PRESCRIPTION, ("prescription", "rx", "dispense")),
    (DocumentKind.DISCHARGE_NOTE, ("discharge",)),
    (DocumentKind.REFERRAL, ("referral", "refer to", "referred")),
    (DocumentKind.LAB_DOCUMENT, ("lab report", "laboratory", "pathology", "specimen")),
    (DocumentKind.THERAPY_NOTE, ("physiotherapy", "therapy session", "rehab")),
    (DocumentKind.DOCTOR_NOTE, ("consultation", "clinical note", "progress note")),
)

#: Anything after one of these, on its own line, is taken as the diagnosis —
#: including whatever qualifier the clinician wrote. "?" and "provisional" are
#: preserved because they are the clinically meaningful part.
_DIAGNOSIS_LABELS = ("diagnosis:", "dx:", "impression:", "provisional diagnosis:")

_UNCERTAIN_MARKERS = ("?", "illegible", "unclear", "unreadable", "[?]")


def read_text(text: str, *, hint: DocumentKind | None = None) -> DocumentExtraction:
    """Read a document with rules rather than a model.

    Runs whenever no model is configured, and whenever a model's output fails
    validation. It is not a placeholder: on a legible typed prescription it
    extracts the same fields, and on anything else it says so.
    """
    lines = [line.strip() for line in text.splitlines()]
    lowered = text.lower()

    kind = hint or DocumentKind.UNKNOWN
    if hint is None:
        for candidate, needles in _KIND_HINTS:
            if any(needle in lowered for needle in needles):
                kind = candidate
                break

    medicines: list[ExtractedMedicine] = []
    uncertain: list[str] = []
    diagnosis = ""
    prescriber = ""
    notes: list[str] = []

    in_medicines = kind is DocumentKind.PRESCRIPTION
    for line in lines:
        if not line:
            continue
        low = line.lower()

        if any(marker in low for marker in _UNCERTAIN_MARKERS):
            # Kept verbatim, and kept *out* of every other field. A fragment a
            # reader could not resolve must not silently become a value.
            uncertain.append(line)
            continue

        matched_label = next((lab for lab in _DIAGNOSIS_LABELS if low.startswith(lab)), None)
        if matched_label:
            diagnosis = line[len(matched_label):].strip()
            continue
        if low.startswith(("dr.", "dr ", "prescriber:", "consultant:")):
            prescriber = line.split(":", 1)[-1].strip()
            continue
        if low.startswith(("rx", "medicines", "medication")):
            in_medicines = True
            continue

        if in_medicines:
            medicine = _parse_medicine(line)
            if medicine is not None:
                medicines.append(medicine)
                continue
        notes.append(line)

    return DocumentExtraction(
        kind=kind,
        documentDate=_find_date(text),
        prescriber=prescriber,
        medicines=medicines[:30],
        diagnosis=diagnosis,
        notes="\n".join(notes)[:2000],
        uncertain=uncertain[:20],
        confidence=_confidence(medicines=medicines, uncertain=uncertain, diagnosis=diagnosis),
    )


#: Which fields must be findable in the source text. Free prose (notes) is
#: excluded — a summary line is allowed to be a summary.
_GROUNDED_FIELDS = ("strength", "dosage", "frequency", "duration")


def ground_in_source(extraction: DocumentExtraction, ocr_text: str) -> DocumentExtraction:
    """Flag every structured value that is not in the source text.

    The comparison is deliberately crude — whitespace removed, lower-cased,
    substring — because it only has to answer one question: *is this string
    anywhere on the page?* A dose the reader produced that does not appear in
    what the scanner read did not come from the document, and a reviewer needs
    to be told that before they approve it, not after somebody takes it.

    Flags, never edits. The value stays exactly as extracted so the reviewer
    can see what was proposed.
    """
    haystack = _squash(ocr_text)
    unsupported: list[str] = []

    medicines: list[ExtractedMedicine] = []
    for medicine in extraction.medicines:
        flagged = list(medicine.flagged)
        if _squash(medicine.name) not in haystack:
            flagged.append("name")
            unsupported.append(f"{medicine.name} (name not found in the scanned text)")
        for field in _GROUNDED_FIELDS:
            value = getattr(medicine, field, "")
            if value and _squash(value) not in haystack:
                flagged.append(field)
                unsupported.append(f"{medicine.name}: {field} '{value}' not found in the scanned text")
        medicines.append(medicine.model_copy(update={"flagged": sorted(set(flagged))}))

    if extraction.diagnosis and _squash(extraction.diagnosis) not in haystack:
        unsupported.append(f"diagnosis '{extraction.diagnosis}' not found in the scanned text")

    field_confidence = dict(extraction.fieldConfidence)
    for medicine in medicines:
        for field in medicine.flagged:
            # A value nobody can find on the page is low confidence by
            # definition, not by estimate.
            field_confidence[f"medicine.{field}"] = "low"

    return extraction.model_copy(
        update={
            "medicines": medicines,
            "unsupported": unsupported[:20],
            "fieldConfidence": field_confidence,
            # One unsupported value drags the whole document down. It has to:
            # the reviewer's next action depends on whether anything on this
            # page can be taken at face value.
            "confidence": "low" if unsupported else extraction.confidence,
        }
    )


#: How close two names have to be before the catalogue entry is worth showing.
#: 0.82 lets "Paracetemol"/"Paracetamol" through and keeps "Metformin" away
#: from "Metoprolol". Tuned against the evaluation set, not guessed.
MATCH_THRESHOLD = 0.82


def match_medicines(db: Session, extraction: DocumentExtraction) -> DocumentExtraction:
    """Attach catalogue candidates to each written medicine name.

    Suggestion only. ``name`` is never rewritten, no match is ever auto-applied,
    and a near-match is flagged rather than accepted — the reviewer is shown
    "written: Paracetemol / possible match: Paracetamol" and asked.
    """
    if not extraction.medicines:
        return extraction

    catalogue = list(db.execute(select(Medicine)).scalars())
    if not catalogue:
        return extraction

    medicines: list[ExtractedMedicine] = []
    field_confidence = dict(extraction.fieldConfidence)
    for medicine in extraction.medicines:
        matches = _candidates(medicine.name, catalogue)
        flagged = list(medicine.flagged)
        if matches and not matches[0].exact:
            # A close-but-not-exact name is the case this whole function exists
            # for. Say so on the field rather than only in a list further down.
            flagged.append("name")
            field_confidence["medicine.name"] = "low"
        elif not matches:
            field_confidence.setdefault("medicine.name", "low")
        medicines.append(
            medicine.model_copy(
                update={"matches": matches, "flagged": sorted(set(flagged))}
            )
        )

    return extraction.model_copy(
        update={"medicines": medicines, "fieldConfidence": field_confidence}
    )


def _candidates(written: str, catalogue) -> list[MedicineMatch]:
    """The three closest catalogue names, best first."""
    target = _norm(written)
    if not target:
        return []
    scored: list[tuple[float, object]] = []
    for row in catalogue:
        ratio = SequenceMatcher(None, target, _norm(row.name)).ratio()
        if ratio >= MATCH_THRESHOLD:
            scored.append((ratio, row))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        MedicineMatch(
            medicineId=str(row.id),
            name=row.name,
            strength=getattr(row, "strength", "") or "",
            similarity=round(ratio, 3),
            exact=_norm(row.name) == target,
        )
        for ratio, row in scored[:3]
    ]


def _norm(value: str) -> str:
    """Lower-cased letters and digits only, for name comparison."""
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def _squash(value: str) -> str:
    """Lower-cased with all whitespace removed, for substring search.

    Whitespace goes because "500 mg", "500mg" and "500  mg" are the same
    reading, and a check that treated them as different would flag every
    correctly extracted dose.
    """
    return re.sub(r"\s+", "", (value or "").lower())


def _parse_medicine(line: str) -> ExtractedMedicine | None:
    match = _MEDICINE_LINE.match(line)
    if match is None:
        return None
    name = " ".join((match.group("name") or "").split())
    if len(name) < 3 or name.lower() in {"date", "name", "age", "sex", "signature"}:
        return None
    # A bare word with no strength, dose or duration is far more likely to be a
    # heading than a medicine. Requiring one clinical field keeps "Follow up"
    # out of the medicines list.
    if not any(match.group(field) for field in ("strength", "dosage", "duration")):
        return None
    return ExtractedMedicine(
        name=name,
        strength=" ".join((match.group("strength") or "").split()),
        dosage=(match.group("dosage") or "").replace(" ", ""),
        duration=" ".join((match.group("duration") or "").split()),
    )


def _find_date(text: str) -> date | None:
    for pattern, order in _DATE_PATTERNS:
        match = pattern.search(text)
        if match is None:
            continue
        try:
            year, month, day = (int(match.group(i)) for i in order)
            return date(year, month, day)
        except ValueError:
            continue
    return None


def _confidence(
    *, medicines: list[ExtractedMedicine], uncertain: list[str], diagnosis: str
) -> str:
    """The band, by a rule written here and applied nowhere else.

    * ``low``  — something was unreadable, or nothing was extracted.
    * ``medium`` — fields were extracted and nothing was flagged unreadable.
    * ``high`` — never. This reader matches patterns; it does not read pages,
      and a rule engine calling itself highly confident is how a wrong strength
      gets waved through review.

    Per-field bands are set separately, by :func:`ground_in_source` and
    :func:`match_medicines`, and only where a rule justifies one. A field
    absent from ``fieldConfidence`` was not assessed — which is a different
    statement from "high", and the UI is careful not to conflate them.
    """
    if uncertain or not (medicines or diagnosis):
        return "low"
    return "medium"


# ---------------------------------------------------------------------------
# Review
# ---------------------------------------------------------------------------


def review(
    db: Session,
    *,
    document: AIDocument,
    payload: DocumentReviewRequest,
    user: User,
) -> AIDocument:
    """Apply a clinician's decision.

    On rejection the extraction is kept and marked rejected — deleting it would
    remove the evidence of what was proposed, which is the thing an audit would
    most want to see.

    On approval the *reviewed* fields are written to the medical history and
    recorded separately from what the AI proposed, so the two can be compared
    later. ``applied`` makes a second approval a conflict rather than a second
    history entry.
    """
    if document.applied:
        raise ConflictError(
            "This document has already been reviewed and applied.",
            code="document_already_applied",
        )

    now = datetime.now(timezone.utc)
    document.reviewed_by = user.id
    document.reviewed_at = now

    if not payload.approve:
        from app.core.enums import AIReviewStatus

        document.review_status = AIReviewStatus.REJECTED
        document.reviewed = {"rejected": True, "reason": payload.reason[:500]}
        db.flush()
        return document

    proposed = document.extracted or {}
    accepted = {
        "kind": (payload.kind or document.kind).value,
        "medicines": [m.model_dump() for m in (payload.medicines or [])],
        "diagnosis": (payload.diagnosis if payload.diagnosis is not None
                      else proposed.get("diagnosis", "")),
        "notes": payload.notes if payload.notes is not None else proposed.get("notes", ""),
    }
    if payload.medicines is None:
        accepted["medicines"] = proposed.get("medicines", [])

    entry = _write_history(db, document=document, accepted=accepted, user=user)

    from app.core.enums import AIReviewStatus

    document.review_status = AIReviewStatus.APPROVED
    document.reviewed = accepted
    document.kind = payload.kind or document.kind
    document.applied = True
    document.applied_type = "medical_history_entries"
    document.applied_id = entry.id
    db.flush()
    return document


def _write_history(
    db: Session, *, document: AIDocument, accepted: dict, user: User
) -> MedicalHistoryEntry:
    """One history entry, attributed to the reviewer rather than to the AI.

    The clinician who approved it owns it. That is not a formality: they are
    the one who read the page and decided the transcription was right.
    """
    lines: list[str] = []
    if accepted.get("diagnosis"):
        lines.append(f"Diagnosis as written: {accepted['diagnosis']}")
    for medicine in accepted.get("medicines") or []:
        parts = [medicine.get("name", "")]
        for field in ("strength", "dosage", "frequency", "duration"):
            if medicine.get(field):
                parts.append(str(medicine[field]))
        lines.append(" · ".join(p for p in parts if p))
    if accepted.get("notes"):
        lines.append(str(accepted["notes"]))
    lines.append(
        f"Transcribed from uploaded document '{document.filename}' and reviewed by "
        f"{user.first_name} {user.last_name}."
    )

    entry = MedicalHistoryEntry(
        patient_id=document.patient_id,
        entry_date=date.today(),
        type=MedicalHistoryType.DIAGNOSIS,
        title=f"{DocumentKind(accepted['kind']).display} (transcribed)",
        detail="\n".join(lines)[:4000],
        clinician_id=user.id,
    )
    db.add(entry)
    db.flush()
    return entry


def outcome_for(document: AIDocument) -> RunOutcome:
    """The provenance shown beside a stored document."""
    return RunOutcome(
        status=AIRunStatus.SUCCEEDED if document.ocr_text else AIRunStatus.DEGRADED,
        provider=document.ocr_provider or "none",
        prompt_version=prompt.VERSION,
    )


def as_uuid(value: str) -> uuid_lib.UUID:
    try:
        return uuid_lib.UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        from app.core.errors import NotFoundError

        raise NotFoundError("Document not found.") from exc
