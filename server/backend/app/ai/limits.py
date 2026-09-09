"""Per-agent hourly allowances.

One bucket per agent per user, not one bucket for everything. A clinician who
has run twenty recaps this hour should still be able to check an invoice; a
single shared counter turns ordinary use of one feature into a denial of
service against the other four.

Every value is a setting with a documented default. Nothing here is a literal
an operator would have to change code to move.
"""

from __future__ import annotations

from app.core.config import settings
from app.core.enums import AIAgentType

#: Which setting holds each agent's allowance. An agent missing from this map
#: falls back to ``AI_RATE_LIMIT_PER_HOUR``, so adding an agent cannot
#: accidentally create an unlimited one.
_SETTING_FOR: dict[AIAgentType, str] = {
    AIAgentType.PATIENT_RECAP: "AI_LIMIT_PATIENT_RECAP",
    AIAgentType.CLINICAL_DOCUMENTATION: "AI_LIMIT_CLINICAL_DOCUMENTATION",
    AIAgentType.BILLING_ACCURACY: "AI_LIMIT_BILLING_ACCURACY",
    AIAgentType.FOLLOW_UP: "AI_LIMIT_FOLLOW_UP",
    AIAgentType.FINANCE_INSIGHTS: "AI_LIMIT_FINANCE_INSIGHTS",
}


def hourly_limit(agent: AIAgentType) -> int:
    """This agent's allowance, per user, per hour.

    Read from settings on every call rather than captured at import. An
    operator raising a limit should not have to reason about which worker
    process is holding the old number.
    """
    name = _SETTING_FOR.get(agent)
    value = getattr(settings, name, 0) if name else 0
    return int(value) if value else int(settings.AI_RATE_LIMIT_PER_HOUR)


def all_limits() -> dict[str, int]:
    """Every agent's allowance, for the status endpoint.

    Shown to the user because a limit nobody can see is a limit that looks like
    a bug the first time it fires.
    """
    return {agent.value: hourly_limit(agent) for agent in AIAgentType}
