"""Patient Recap.

Answers "what has been happening with this patient?" for the clinician about
to see them.

The timeline is the product. It is built by :mod:`app.ai.retrieval` from seven
tables, each entry carrying the id of the row it came from, and it is always
returned in full whether or not a model ran. The narrative on top is a
convenience — useful, and the first thing to go when the provider is
unreachable.

Three guardrails are enforced here rather than asked for in the prompt, because
a prompt is a request and these are requirements:

* **Absence is stated, not implied.** Whatever this window holds nothing of is
  returned as a sentence — "Lab results: not available in the patient's
  records for this period" — so an empty section cannot be read as a section
  that failed to load.
* **Conflicts are surfaced, never resolved.** Two recent prescriptions that
  disagree produce a conflict record naming both. Nothing chooses.
* **Future entries are marked.** A session booked for next week is flagged
  ``scheduled``, so nothing downstream can describe it as something that
  happened.
"""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.ai import retrieval
from app.ai.orchestrator import Orchestrator
from app.ai.prompts import recap as prompt
from app.ai.schemas import (
    PatientRecapResponse,
    RecapNarrative,
    RecordConflict,
    TimelineEvent,
)
from app.core.enums import AIAgentType
from app.models.patient import Patient
from app.models.user import User

#: The clinical permission this agent needs. A recap is a clinical record in
#: summary form, so it needs the key that reading the record needs — not a new
#: "ai" permission that would quietly widen who can read notes.
PERMISSION = "patient.clinical.view"


def generate(
    db: Session,
    *,
    patient: Patient,
    user: User,
    request_id: str,
    window_days: int = retrieval.RECAP_WINDOW_DAYS,
) -> PatientRecapResponse:
    since = date.today() - timedelta(days=window_days)
    events, counts = retrieval.patient_timeline(db, patient=patient, since=since)
    conflicts = retrieval.find_conflicts(db, patient=patient, since=since)
    not_available = retrieval.absent_kinds(counts)

    orchestrator = Orchestrator(
        db=db,
        user=user,
        request_id=request_id,
        agent=AIAgentType.PATIENT_RECAP,
        entity_type="patients",
        entity_id=patient.id,
    )
    orchestrator.enforce_rate_limit()

    narrative: RecapNarrative | None = None
    if events:
        narrative, outcome = orchestrator.structured(
            system=prompt.SYSTEM,
            task=prompt.TASK,
            data=prompt.data(
                patient=retrieval.recap_context(patient),
                timeline=events,
                counts=counts,
                conflicts=conflicts,
            ),
            schema=RecapNarrative,
            prompt_version=prompt.VERSION,
        )
    else:
        # Nothing to summarise is not a degraded run, it is an answer. Calling a
        # model to say "there is no activity" would spend a request to restate
        # a COUNT(*).
        outcome = orchestrator.deterministic(
            detail="No activity in the window; nothing to summarise."
        )

    meta = outcome.meta(AIAgentType.PATIENT_RECAP, requires_review=True)
    if not events:
        meta.notice = "No recorded activity in this window."

    watch_points = list(narrative.watchPoints) if narrative else []
    # A conflict outranks anything the model noticed, and is prepended whether
    # or not a model ran. Burying "these two prescriptions disagree" below a
    # generated observation would be the wrong way round.
    for conflict in conflicts:
        watch_points.insert(0, conflict["message"])

    return PatientRecapResponse(
        meta=meta,
        patientId=str(patient.id),
        patientName=f"{patient.first_name} {patient.last_name}".strip(),
        since=since,
        timeline=[TimelineEvent(**event) for event in events],
        counts=counts,
        conflicts=[RecordConflict(**conflict) for conflict in conflicts],
        notAvailable=not_available,
        summary=narrative.summary if narrative else "",
        watchPoints=watch_points[:8],
        gaps=narrative.gaps if narrative else [],
    )
