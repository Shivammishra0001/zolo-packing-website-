"""Billing accuracy prompt.

Nothing here asks the model to check arithmetic. The rules engine has already
recomputed every total, found every unbilled service and compared the payments;
by the time this prompt runs, the findings are settled. The model's only job is
to say what they add up to in a sentence a person can read quickly.
"""

from __future__ import annotations

import json

from app.ai.prompts import system

VERSION = "billing/v2"

SYSTEM = system("""
You are given the results of an automated billing check that has already run. \
Its findings are correct and complete. Summarise them.

Rules specific to this task:
- Do not perform arithmetic. Every amount you might mention has already been \
calculated; quote it or leave it out.
- Do not add a finding. If the check found three things, your summary is about \
those three things.
- Do not recommend charging the patient more. Say what was found; the decision \
belongs to the billing staff.
- If the check found nothing, say so in one sentence.
- Two sentences at most.
""")

TASK = (
    "Summarise the billing check results below in at most two sentences. Quote "
    "the figures given; calculate nothing."
)


def data(*, invoice: dict, system_errors: list[dict], findings: list[dict]) -> str:
    return (
        "INVOICE (amounts already verified)\n"
        f"{json.dumps(invoice, ensure_ascii=False, default=str)}\n\n"
        "SYSTEM ERRORS (arithmetic that does not add up — certain, not a suggestion)\n"
        f"{json.dumps(system_errors, ensure_ascii=False, default=str)}\n\n"
        "FINDINGS FOR REVIEW (heuristic — a person decides)\n"
        f"{json.dumps(findings, ensure_ascii=False, default=str)}\n"
    )
