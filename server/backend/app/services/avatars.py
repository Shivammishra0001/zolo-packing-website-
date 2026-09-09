"""Patient avatar presentation, shared by every module that lists patients.

Appointments, therapy sessions, rehabilitation plans and the caseload all render
the same avatar. Deriving it in one place keeps a patient the same colour
wherever they appear, and means a row never needs a second lookup to draw one.
"""

from __future__ import annotations

#: The frontend's own palette, in its order — so a seeded patient keeps the
#: colour the mock data gave them.
AVATAR_COLOURS = (
    "bg-chart-1/15 text-chart-1",
    "bg-chart-2/15 text-chart-2",
    "bg-chart-3/15 text-chart-3",
    "bg-chart-4/15 text-chart-4",
    "bg-chart-5/15 text-chart-5",
    "bg-chart-6/15 text-chart-6",
)


def initials(patient) -> str:
    first = (patient.first_name or " ")[0]
    last = (patient.last_name or " ")[0]
    return f"{first}{last}".strip().upper() or "?"


def avatar_colour(patient) -> str:
    """The patient's stored colour, or a stable one derived from their number.

    Derived rather than random, so the same patient is the same colour on every
    screen and across restarts.
    """
    if patient.avatar_color:
        return patient.avatar_color
    digits = "".join(ch for ch in (patient.patient_number or "") if ch.isdigit())
    return AVATAR_COLOURS[(int(digits) if digits else 0) % len(AVATAR_COLOURS)]
