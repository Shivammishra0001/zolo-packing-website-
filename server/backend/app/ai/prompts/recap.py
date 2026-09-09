"""Patient recap prompt.

The model is shown a timeline that PostgreSQL built and asked to describe it.
It is not asked to order events, date them, or work out what happened when —
chronology is a query result, not an inference.
"""

from __future__ import annotations

import json

from app.ai.prompts import system

VERSION = "recap/v2"

SYSTEM = system("""
Your task is to summarise a patient's recent record for the clinician about to \
see them, so they can walk in already knowing what has happened.

The timeline you are given is complete and correctly ordered. Do not reorder \
it, do not restate every entry, and do not add a date that is not in it.

Write:
- summary: two to four sentences on the course of care so far. Say what has \
been happening, not what should happen next.
- watchPoints: things in the record a clinician would want to notice — a \
missed run of appointments, a pain score moving the wrong way, a plan with no \
recent sessions. Each must point at something visible in the timeline. If \
nothing stands out, return an empty list.
- gaps: what the record does not contain. Missing vitals, no consultation \
since a referral, an unfinished course. Absence of evidence only — never \
"the patient is not improving".

Some entries are marked as scheduled for a future date, and some are marked as \
conflicting with another entry. Never describe a future entry as something \
that has happened. Never resolve a conflict by choosing one side: say the \
record disagrees and that it needs checking.
""")

TASK = (
    "Summarise the recent course of care for the patient whose de-identified "
    "record data follows. Describe only what the timeline contains."
)


def data(*, patient: dict, timeline: list[dict], counts: dict, conflicts: list[dict]) -> str:
    """The untrusted half: structured context, nothing else.

    Note what is absent. No patient name, no phone number, no address, no
    identifier that would let this text be tied to a person if it were ever
    seen outside the building. Age band and sex are supplied because they
    change how a course of care reads; a name does not.
    """
    return (
        "PATIENT (de-identified)\n"
        f"{json.dumps(patient, ensure_ascii=False, default=str)}\n\n"
        "ACTIVITY COUNTS IN THIS WINDOW\n"
        f"{json.dumps(counts, ensure_ascii=False)}\n\n"
        "CONFLICTS DETECTED BY THE APPLICATION (do not resolve these)\n"
        f"{json.dumps(conflicts, ensure_ascii=False, default=str)}\n\n"
        "TIMELINE (oldest first, generated from the database)\n"
        f"{json.dumps(timeline, ensure_ascii=False, default=str)}\n"
    )
