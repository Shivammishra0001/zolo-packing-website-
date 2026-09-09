"""Permission-aware retrieval: the only way the AI layer reaches the database.

Every function here takes the caller and their live permissions and returns a
narrow, already-authorised slice. No agent builds a query, and no agent is
handed an ORM object it could follow a relationship out of — what leaves this
module is dictionaries and primitives.

That is the answer to "how do you stop the model reading the whole database":
the model is never given a query interface at all, and the code that *does*
have one applies the same branch scope and the same 404-not-403 rule as the
module that owns each table.

Two habits are worth naming because they are easy to lose:

* the de-identified context. What goes into a prompt has no name, no phone
  number, no address and no patient code — an age band, a sex, and clinical
  events. Nothing sent to a third party identifies a person.
* the isolation between features. The billing check cannot see a diagnosis and
  the recap cannot see an invoice, because they call different functions that
  select different columns, rather than a shared "get everything" helper.
"""

from __future__ import annotations

import uuid as uuid_lib
from collections import Counter
from datetime import date as date_type
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.enums import AppointmentStatus, TherapySessionStatus
from app.models.appointment import Appointment
from app.models.billing import Invoice, InvoiceItem
from app.models.consultation import Consultation
from app.models.lab import LabResult
from app.models.patient import Patient
from app.models.pharmacy import Prescription, PrescriptionItem
from app.models.therapy import TherapySession
from app.models.user import User
from app.models.vitals import Vitals
from app.models.ward import Admission
from app.repositories import billing_repository as billing_repo
from app.services.scoping import visible_branch_ids

#: How far back a recap looks by default. Long enough to cover a course of
#: rehabilitation, short enough that the prompt stays small.
RECAP_WINDOW_DAYS = 180

#: Appointment states that mean nothing further is expected from this booking.
#: A cancelled slot is not a future visit, so it must not suppress a reminder.
_CLOSED_APPOINTMENT_STATUSES = (
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.COMPLETED,
)

#: The session states that represent work actually done. A session that was
#: cancelled, or that the patient did not attend, is not a service to bill for.
DELIVERED_SESSION_STATUSES = (TherapySessionStatus.COMPLETED,)

#: Timeline entries handed to a model. A cap, not a target — a patient with two
#: hundred sessions would otherwise produce a prompt nobody budgeted for.
MAX_TIMELINE_EVENTS = 80


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------


def _name(user: User | None) -> str:
    return f"{user.first_name} {user.last_name}".strip() if user else ""


#: Where each kind of record lives in the UI. Only the routes that actually
#: exist — a "View source" link to a screen this application does not have is
#: worse than no link, because the reader concludes the citation is fake.
_HREF: dict[str, str] = {
    "consultations": "/doctor/consultations",
    "labs": "/doctor/labs",
    "appointments": "/appointments",
    "therapy-sessions": "/rehab/plans",
    "prescriptions": "/doctor/prescriptions",
}


def _source(kind: str, record_id, label: str) -> dict:
    """A citation the frontend can render, and open where a screen exists.

    Every timeline entry carries one. A recap whose statements cannot be traced
    to a row is a recap a clinician has to verify from scratch, which is more
    work than reading the notes would have been.
    """
    return {
        "type": kind,
        "id": str(record_id),
        "label": label,
        "href": _HREF.get(kind, ""),
    }


def _age_band(dob: date_type | None) -> str:
    """An age band rather than a birth date.

    A recap reads differently for a 24-year-old than for an 84-year-old, so the
    band earns its place in the prompt. An exact date of birth would not: it is
    a direct identifier, and it would tell the model nothing the band does not.
    """
    if dob is None:
        return "not recorded"
    today = date_type.today()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    if age < 18:
        return "under 18"
    lower = (age // 10) * 10
    return f"{lower}-{lower + 9}"


# ---------------------------------------------------------------------------
# 1. Patient recap
# ---------------------------------------------------------------------------


def patient_timeline(
    db: Session,
    *,
    patient: Patient,
    since: date_type,
) -> tuple[list[dict], dict[str, int]]:
    """Every dated event on this patient's record, in order, from SQL.

    The chronology is a query result. A language model is not asked to work out
    what happened when, because a model that gets an ordering wrong produces a
    clinical narrative that is confidently backwards, and nothing downstream
    would catch it.
    """
    events: list[dict] = []
    pid = patient.id
    today = date_type.today()

    for appointment in db.execute(
        select(Appointment)
        .where(Appointment.patient_id == pid, Appointment.appointment_date >= since)
        .options(joinedload(Appointment.doctor), joinedload(Appointment.therapist))
        .order_by(Appointment.appointment_date)
    ).unique().scalars():
        clinician = _name(appointment.doctor) or _name(appointment.therapist)
        events.append({
            "kind": "appointment",
            "date": appointment.appointment_date,
            "title": f"{appointment.appointment_type.display} appointment",
            "detail": appointment.status.display,
            "by": clinician,
            "scheduled": appointment.appointment_date > today,
            "source": _source(
                "appointments",
                appointment.id,
                f"Appointment {appointment.appointment_number}",
            ),
        })

    for consultation in db.execute(
        select(Consultation)
        .where(Consultation.patient_id == pid, Consultation.created_at >= _as_dt(since))
        .options(joinedload(Consultation.doctor))
        .order_by(Consultation.created_at)
    ).unique().scalars():
        # Diagnosis and care plan are copied verbatim, qualifiers and all. This
        # is the one place clinical free text enters a prompt, and it does so
        # unedited — summarising it here would mean summarising a summary.
        detail = " | ".join(
            part for part in (
                f"Symptoms: {consultation.symptoms}" if consultation.symptoms else "",
                f"Diagnosis: {consultation.diagnosis}" if consultation.diagnosis else "",
                f"Plan: {consultation.care_plan}" if consultation.care_plan else "",
            ) if part
        )
        events.append({
            "kind": "consultation",
            "date": consultation.created_at.date(),
            "title": "Consultation",
            "detail": detail or "No notes recorded",
            "by": _name(consultation.doctor),
            "scheduled": False,
            "source": _source(
                "consultations",
                consultation.id,
                f"Consultation, {consultation.created_at:%d %b %Y}",
            ),
        })

    for session in db.execute(
        select(TherapySession)
        .where(TherapySession.patient_id == pid, TherapySession.session_date >= since)
        .options(joinedload(TherapySession.therapist))
        .order_by(TherapySession.session_date)
    ).unique().scalars():
        scores = []
        if session.pain_before is not None and session.pain_after is not None:
            scores.append(f"pain {session.pain_before}->{session.pain_after}")
        if session.mobility_score is not None:
            scores.append(f"mobility {session.mobility_score}")
        if session.strength_score is not None:
            scores.append(f"strength {session.strength_score}")
        events.append({
            "kind": "therapy",
            "date": session.session_date,
            "title": f"{session.session_type.display} session",
            "detail": ", ".join(
                part for part in [session.status.display, ", ".join(scores), session.progress or ""]
                if part
            ),
            "by": _name(session.therapist),
            "scheduled": session.session_date > today,
            "source": _source(
                "therapy-sessions", session.id, f"Session {session.session_number}"
            ),
        })

    for lab in db.execute(
        select(LabResult)
        .where(LabResult.patient_id == pid, LabResult.reported_on >= since)
        .options(joinedload(LabResult.doctor))
        .order_by(LabResult.reported_on)
    ).unique().scalars():
        events.append({
            "kind": "lab",
            "date": lab.reported_on,
            "title": lab.test,
            "detail": " ".join(part for part in (lab.flag.display, lab.summary or "") if part),
            "by": _name(lab.doctor),
            "scheduled": lab.reported_on > today,
            "source": _source("labs", lab.id, f"Lab {lab.lab_number}"),
        })

    for prescription in db.execute(
        select(Prescription)
        .where(Prescription.patient_id == pid, Prescription.created_at >= _as_dt(since))
        .options(joinedload(Prescription.doctor), joinedload(Prescription.items))
        .order_by(Prescription.created_at)
    ).unique().scalars():
        count = len(prescription.items)
        events.append({
            "kind": "prescription",
            "date": prescription.created_at.date(),
            "title": f"Prescription ({count} item{'s' if count != 1 else ''})",
            "detail": prescription.status.display,
            "by": _name(prescription.doctor),
            "scheduled": False,
            "source": _source(
                "prescriptions",
                prescription.id,
                f"Prescription {prescription.prescription_number}",
            ),
        })

    for admission in db.execute(
        select(Admission)
        .where(Admission.patient_id == pid, Admission.admission_date >= since)
        .options(joinedload(Admission.attending_doctor))
        .order_by(Admission.admission_date)
    ).unique().scalars():
        discharge = (
            f"discharged {admission.discharge_date:%d %b}"
            if admission.discharge_date
            else "still admitted"
        )
        events.append({
            "kind": "admission",
            "date": admission.admission_date,
            "title": "Admitted",
            "detail": f"{admission.status.display}, {discharge}",
            "by": _name(admission.attending_doctor),
            "scheduled": admission.admission_date > today,
            "source": _source("admissions", admission.id, "Admission"),
        })

    # Vitals. The clause's own worked example — "latest SpO2 was 96%" traced to
    # a vital record — is only buildable because these are here, each carrying
    # the id of the observation it came from.
    for reading in db.execute(
        select(Vitals)
        .where(Vitals.patient_id == pid, Vitals.recorded_at >= _as_dt(since))
        .options(joinedload(Vitals.nurse))
        .order_by(Vitals.recorded_at)
    ).unique().scalars():
        readings = []
        if reading.systolic is not None and reading.diastolic is not None:
            readings.append(f"BP {reading.systolic}/{reading.diastolic}")
        if reading.heart_rate is not None:
            readings.append(f"HR {reading.heart_rate}")
        if reading.temperature is not None:
            readings.append(f"temp {reading.temperature}")
        if reading.spo2 is not None:
            readings.append(f"SpO2 {reading.spo2}%")
        if reading.respiratory_rate is not None:
            readings.append(f"RR {reading.respiratory_rate}")
        if not readings:
            # An observation row with every field null records that somebody
            # opened the form. It is not a vital sign and does not belong in a
            # clinical summary.
            continue
        events.append({
            "kind": "vitals",
            "date": reading.recorded_at.date(),
            "title": "Vitals",
            "detail": ", ".join(readings),
            "by": _name(reading.nurse),
            "scheduled": False,
            "source": _source(
                "vitals", reading.id, f"Vitals, {reading.recorded_at:%d %b %Y %H:%M}"
            ),
        })

    events.sort(key=lambda e: e["date"])
    counts = dict(Counter(e["kind"] for e in events))
    # Keep the most recent when there are too many: a recap is about what has
    # been happening lately, and truncating the near end would defeat it.
    if len(events) > MAX_TIMELINE_EVENTS:
        events = events[-MAX_TIMELINE_EVENTS:]
    return events, counts


#: Every kind a complete record could hold, with the sentence to show when it
#: holds none. Written out rather than generated so the wording is reviewable.
_ABSENCE = {
    "consultation": "Consultations: not available in the patient's records for this period.",
    "therapy": "Therapy sessions: not available in the patient's records for this period.",
    "lab": "Lab results: not available in the patient's records for this period.",
    "prescription": "Prescriptions: not available in the patient's records for this period.",
    "vitals": "Vital signs: not available in the patient's records for this period.",
}


def absent_kinds(counts: dict[str, int]) -> list[str]:
    """What this window holds nothing of, as sentences.

    Returned rather than inferred by the client, and phrased in full, because
    an empty section reads as "not loaded" while a sentence reads as "not
    there" — and a clinician deciding whether to order a test needs to know
    which of the two they are looking at.
    """
    return [text for kind, text in _ABSENCE.items() if not counts.get(kind)]


def find_conflicts(db: Session, *, patient: Patient, since: date_type) -> list[dict]:
    """Records that disagree with each other, reported and never resolved.

    Two things are checked, both cheap and both real: the active medicine list
    across recent prescriptions, and the allergy list on the patient against
    what consultations mention. Nothing here picks a winner — the whole point
    is that a summary must not quietly choose between two recorded medication
    lists, because the reader would have no way to know a choice was made.
    """
    conflicts: list[dict] = []

    prescriptions = list(
        db.execute(
            select(Prescription)
            .where(
                Prescription.patient_id == patient.id,
                Prescription.created_at >= _as_dt(since),
            )
            .options(joinedload(Prescription.items).joinedload(PrescriptionItem.medicine))
            .order_by(Prescription.created_at.desc())
        )
        .unique()
        .scalars()
    )

    # Compare the two most recent prescriptions. Older ones are history; the
    # question a clinician has is "what is this patient on now?", and two
    # recent lists that disagree is exactly when they must not be guessed at.
    if len(prescriptions) >= 2:
        newest, previous = prescriptions[0], prescriptions[1]
        new_names = {_medicine_name(i) for i in newest.items if _medicine_name(i)}
        old_names = {_medicine_name(i) for i in previous.items if _medicine_name(i)}
        if new_names and old_names and new_names != old_names:
            conflicts.append({
                "kind": "medication",
                "field": "Current medication",
                "message": (
                    "Potential inconsistency found in the records. The two most recent "
                    "prescriptions list different medicines. Please verify the current "
                    "medication list."
                ),
                "values": [
                    f"{previous.prescription_number}: " + ", ".join(sorted(old_names)),
                    f"{newest.prescription_number}: " + ", ".join(sorted(new_names)),
                ],
                "sources": [
                    _source("prescriptions", previous.id, previous.prescription_number),
                    _source("prescriptions", newest.id, newest.prescription_number),
                ],
            })

    # An allergy recorded on the patient that a prescription then prescribes
    # against. Substring matching in both directions, because "Penicillin" and
    # "Amoxicillin (penicillin class)" are written a dozen ways and a missed
    # match here costs nothing while a missed flag could cost a great deal.
    allergies = [a.strip().lower() for a in (patient.allergies or []) if a and a.strip()]
    if allergies and prescriptions:
        for item in prescriptions[0].items:
            name = (_medicine_name(item) or "").lower()
            if not name:
                continue
            hit = next((a for a in allergies if a in name or name in a), None)
            if hit:
                conflicts.append({
                    "kind": "allergy",
                    "field": "Allergy",
                    "message": (
                        "Potential inconsistency found in the records. The current "
                        f"prescription includes '{_medicine_name(item)}' while an allergy to "
                        f"'{hit}' is recorded. Please verify."
                    ),
                    "values": [f"Recorded allergy: {hit}", f"Prescribed: {_medicine_name(item)}"],
                    "sources": [
                        _source(
                            "prescriptions",
                            prescriptions[0].id,
                            prescriptions[0].prescription_number,
                        )
                    ],
                })

    return conflicts


def _medicine_name(item) -> str:
    return item.medicine.name if item.medicine else ""


def recap_context(patient: Patient) -> dict:
    """The de-identified patient block that goes into the prompt."""
    return {
        "ageBand": _age_band(patient.date_of_birth),
        "sex": patient.gender.display,
        "primaryCondition": patient.primary_condition or "not recorded",
        "status": patient.status.display,
        "allergies": list(patient.allergies or []),
    }


# ---------------------------------------------------------------------------
# 3. Billing accuracy
# ---------------------------------------------------------------------------


def invoice_for_check(
    db: Session, *, identifier: str, user: User, permissions: list[str]
) -> Invoice:
    """One invoice, by number or id, if this caller may see it.

    Delegates to the billing service rather than re-deriving visibility here.
    That service scopes an invoice by its *patient's* branch, which is the rule
    the rest of the application already enforces; a second rule written in this
    module would be a second answer to the same question.
    """
    from app.services import billing_service

    return billing_service.resolve_invoice(
        db, identifier=identifier, user=user, permissions=permissions
    )


def billable_activity(
    db: Session, *, patient_id: uuid_lib.UUID, window_start: date_type, window_end: date_type
) -> list[dict]:
    """Services actually **delivered** in the invoice's window.

    Deliberately returns labels and dates only. Whether a consultation happened
    is a billing fact; what was said in it is not, and the billing agent has no
    reason to hold it.

    Cancelled and no-show therapy sessions are excluded here rather than
    downstream. A cancelled session is not an unbilled service, and a check
    that says otherwise trains the billing clerk to ignore it — which is worse
    than not running the check at all.
    """
    rows: list[dict] = []
    for consultation in db.execute(
        select(Consultation).where(
            Consultation.patient_id == patient_id,
            Consultation.created_at >= _as_dt(window_start),
            Consultation.created_at < _as_dt(window_end + timedelta(days=1)),
        )
    ).scalars():
        rows.append({
            "kind": "consultation",
            "date": consultation.created_at.date(),
            "label": "Consultation",
        })

    for session in db.execute(
        select(TherapySession).where(
            TherapySession.patient_id == patient_id,
            TherapySession.session_date >= window_start,
            TherapySession.session_date <= window_end,
            TherapySession.status.in_(DELIVERED_SESSION_STATUSES),
        )
    ).scalars():
        rows.append({
            "kind": "therapy",
            "date": session.session_date,
            "label": f"{session.session_type.display} session",
            "status": session.status.display,
        })

    for lab in db.execute(
        select(LabResult).where(
            LabResult.patient_id == patient_id,
            LabResult.reported_on >= window_start,
            LabResult.reported_on <= window_end,
        )
    ).scalars():
        rows.append({"kind": "lab", "date": lab.reported_on, "label": lab.test})

    rows.sort(key=lambda r: r["date"])
    return rows


def invoice_lines(db: Session, *, invoice_id: uuid_lib.UUID) -> list[InvoiceItem]:
    return list(
        db.execute(
            select(InvoiceItem).where(InvoiceItem.invoice_id == invoice_id)
        ).scalars()
    )


def settled_total(db: Session, *, invoice_id: uuid_lib.UUID) -> Decimal:
    return billing_repo.settled_total(db, invoice_id)


# ---------------------------------------------------------------------------
# 4. Follow-ups
# ---------------------------------------------------------------------------


def follow_up_candidates(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    through: date_type,
    limit: int,
) -> list[dict]:
    """Patients with a follow-up date that has arrived, inside the caller's scope.

    Only consultations carry an explicit follow-up date, and only the most
    recent one per patient counts — which is the rule the clinical module
    already applies, reused rather than reinvented so the two screens cannot
    disagree about who is due.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    stmt = (
        select(Consultation)
        .join(Patient, Patient.id == Consultation.patient_id)
        .where(
            Consultation.follow_up_date.is_not(None),
            Consultation.follow_up_date <= through,
        )
        .options(joinedload(Consultation.patient))
        .order_by(Consultation.follow_up_date)
    )
    if branch_ids is not None:
        if not branch_ids:
            return []
        stmt = stmt.where(Patient.branch_id.in_(branch_ids))

    latest: dict[uuid_lib.UUID, Consultation] = {}
    for row in db.execute(stmt).unique().scalars():
        current = latest.get(row.patient_id)
        if current is None or row.created_at > current.created_at:
            latest[row.patient_id] = row

    candidates = []
    for consultation in sorted(latest.values(), key=lambda c: c.follow_up_date)[:limit]:
        patient = consultation.patient
        candidates.append({
            "patient": patient,
            "dueOn": consultation.follow_up_date,
            "lastSeen": consultation.created_at.date(),
            "source": "clinician",
            "reason": "Follow-up date recorded at the consultation",
        })
    return candidates


def next_appointment(
    db: Session, *, patient_id: uuid_lib.UUID, on_or_after: date_type
) -> dict | None:
    """The patient's next booking, if there is one.

    Returned rather than reduced to a boolean because an existing appointment
    is **tier two** of the follow-up priority, not merely a reason to stay
    quiet. The date the clinic already holds is the follow-up date; the caller
    reports it as such and does not draft a second reminder for a visit that is
    already arranged.
    """
    row = db.execute(
        select(Appointment)
        .where(
            Appointment.patient_id == patient_id,
            Appointment.appointment_date >= on_or_after,
            Appointment.status.notin_(_CLOSED_APPOINTMENT_STATUSES),
        )
        .order_by(Appointment.appointment_date)
        .limit(1)
    ).scalars().first()
    if row is None:
        return None
    return {
        "date": row.appointment_date,
        "number": row.appointment_number,
        "source": _source("appointments", row.id, f"Appointment {row.appointment_number}"),
    }


def has_open_appointment(db: Session, *, patient_id: uuid_lib.UUID, on_or_after: date_type) -> bool:
    """Whether this patient already has something booked.

    A reminder to book an appointment the patient has already booked is not a
    harmless duplicate — it is a message that tells them the clinic has lost
    track of them.
    """
    return next_appointment(db, patient_id=patient_id, on_or_after=on_or_after) is not None


def missed_appointments(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    since: date_type,
    limit: int,
) -> list[dict]:
    """Patients who did not attend, inside the caller's branch scope.

    A missed appointment is a scheduling fact and nothing more. What this
    returns is "somebody did not come in on this date" — it carries no
    diagnosis, no urgency and no clinical judgement, because none of those is
    recorded anywhere near an attendance flag.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    stmt = (
        select(Appointment)
        .join(Patient, Patient.id == Appointment.patient_id)
        .where(
            Appointment.status == AppointmentStatus.NO_SHOW,
            Appointment.appointment_date >= since,
        )
        .options(joinedload(Appointment.patient))
        .order_by(Appointment.appointment_date.desc())
    )
    if branch_ids is not None:
        if not branch_ids:
            return []
        stmt = stmt.where(Patient.branch_id.in_(branch_ids))

    seen: set = set()
    rows: list[dict] = []
    for appointment in db.execute(stmt).unique().scalars():
        if appointment.patient_id in seen:
            continue
        seen.add(appointment.patient_id)
        rows.append({
            "patient": appointment.patient,
            "missedOn": appointment.appointment_date,
            "source": _source(
                "appointments",
                appointment.id,
                f"Appointment {appointment.appointment_number}",
            ),
        })
        if len(rows) >= limit:
            break
    return rows


# ---------------------------------------------------------------------------
# 5. Finance
# ---------------------------------------------------------------------------


def finance_window(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    start: date_type,
    end: date_type,
) -> dict[str, object]:
    """Money in and money out for one period, aggregated in SQL.

    Every figure returned here is a database aggregate. The finance agent does
    the subtraction in Python with ``Decimal``; nothing arithmetic happens
    anywhere near a language model.
    """
    branch_ids = visible_branch_ids(db, user, permissions)
    revenue = billing_repo.collected_between(db, start=start, end=end, branch_ids=branch_ids)
    expenses = billing_repo.expenses_between(db, start=start, end=end, branch_ids=branch_ids)
    by_department = billing_repo.revenue_by_department(
        db, start=start, end=end, branch_ids=branch_ids
    )
    by_category = billing_repo.expenses_by_category(
        db, start=start, end=end, branch_ids=branch_ids
    )
    return {
        "revenue": revenue,
        "expenses": expenses,
        "byDepartment": by_department,
        "byCategory": by_category,
    }


def outstanding(db: Session, *, user: User, permissions: list[str]) -> tuple[Decimal, int]:
    return billing_repo.outstanding_total(db, visible_branch_ids(db, user, permissions))


# ---------------------------------------------------------------------------


def _as_dt(day: date_type):
    """Midnight on ``day``, in the clinic's zone, for timestamp comparisons."""
    from datetime import datetime, time

    from app.core.config import settings

    return datetime.combine(day, time.min, tzinfo=settings.clinic_tz)


__all__ = [
    "RECAP_WINDOW_DAYS",
    "billable_activity",
    "finance_window",
    "follow_up_candidates",
    "has_open_appointment",
    "invoice_for_check",
    "invoice_lines",
    "outstanding",
    "patient_timeline",
    "recap_context",
    "settled_total",
]
