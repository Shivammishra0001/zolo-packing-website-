"""Follow-up reminder prompt.

The date is decided before this prompt is built — by the clinician who wrote
one down, or by the clinic's configured interval. The model writes the sentence
that carries it. It is never asked when the patient should come back.
"""

from __future__ import annotations

import json

from app.ai.prompts import system

VERSION = "followup/v2"

SYSTEM = system("""
Write a short appointment reminder to be sent to a patient by SMS or WhatsApp.

Rules specific to this task:
- The date you are given is the date. Use it exactly. Never suggest a different \
one, never add a time that was not supplied.
- The message goes over an ordinary phone network to a device that may be \
shared. It must not contain a diagnosis, a condition, a medicine, a test, a \
result, a department that implies any of those, or the reason for the visit.
- Say: who it is from, that a follow-up is due, the date, and how to get in \
touch. Nothing else.
- Under 320 characters. One paragraph. No emoji, no marketing, no urgency.
- Address the patient by first name only.
- Never state or imply that the patient needs urgent attention. You have not \
been told anything clinical and are not in a position to judge it.
""")

TASK = (
    "Write one appointment reminder using only the fields below. You have not "
    "been told why this patient is being seen, and must not speculate about it."
)


def data(*, clinic: str, patient_first_name: str, due_on: str, phone_note: str = "") -> str:
    payload = {
        "clinic": clinic,
        "firstName": patient_first_name,
        "dueOn": due_on,
        "contact": phone_note,
    }
    return json.dumps(payload, ensure_ascii=False)
