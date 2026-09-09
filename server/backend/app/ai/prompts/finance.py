"""Finance insights prompt.

Every figure is computed in SQL and Python before this runs. The model is shown
the movements and the share of each that the data actually attributes, and it
is told in as many words that where attribution is absent it must say so.

This is the prompt most likely to produce a confident-sounding lie — "revenue
fell because of reduced footfall" is exactly the sentence a language model
writes when handed a falling number and no cause. Hence the wording below.
"""

from __future__ import annotations

import json

from app.ai.prompts import system

VERSION = "finance/v2"

SYSTEM = system("""
You are given financial movements that have already been calculated, together \
with the components that the data can attribute them to.

Rules specific to this task:
- Do not calculate anything. Every number is supplied. Quote or omit.
- State a co-movement only where a driver in the supplied data shows it, and \
name the component. "Collections are down 12%, and therapy collections are \
down 9 points of that" is allowed because the driver says so.
- Never write that one thing *caused* another. The data shows what moved \
together, not why. Words like "because", "due to", "driven by" and "as a \
result of" are forbidden.
- Where the movement is not accounted for by the supplied drivers, you must \
say plainly that the records do not show why. Do not offer a plausible \
explanation. Do not mention seasonality, footfall, staffing, competition, the \
economy, or anything else that is not in the data in front of you.
- Do not forecast. Do not recommend a business action.
- summary: three sentences at most.
- observations: at most five, each tied to a supplied figure.
""")

TASK = (
    "Describe the financial movements below in at most three sentences, plus up "
    "to five observations. Quote the supplied figures; calculate nothing; "
    "assert no causes."
)


def data(*, period: str, compared_with: str, metrics: list[dict], drivers: list[dict],
         unexplained: str) -> str:
    return (
        f"PERIOD: {period}\nCOMPARED WITH: {compared_with}\n\n"
        "MOVEMENTS (already calculated)\n"
        f"{json.dumps(metrics, ensure_ascii=False, default=str)}\n\n"
        "ATTRIBUTED DRIVERS (co-movement only — not causes)\n"
        f"{json.dumps(drivers, ensure_ascii=False, default=str)}\n\n"
        "UNATTRIBUTED MOVEMENT\n"
        f"{unexplained or 'None - the drivers above account for the movement.'}\n"
    )
