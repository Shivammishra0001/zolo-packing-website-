"""Finance Insights.

Compares one period against the one before it and says what moved. Every
figure is a SQL aggregate subtracted in ``Decimal``; the model is shown the
result and asked for wording.

The rule this agent exists to enforce is the one in :attr:`NO_CAUSE`. A
departmental breakdown tells you *where* revenue moved. It does not tell you
*why*, and the difference matters: "therapy collections fell by 40,000" is in
the data, while "fewer patients are choosing us for therapy" is a story about
the world that this database has no way to support. The response says which of
the two it is holding, every time, in a field that is always populated when
there is a movement to explain.

Nothing here forecasts and nothing here recommends a business action.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.ai import retrieval
from app.ai.orchestrator import Orchestrator
from app.ai.prompts import finance as prompt
from app.ai.schemas import (
    FinanceDriver,
    FinanceInsightsResponse,
    FinanceMetric,
    FinanceNarrative,
)
from app.core.enums import AIAgentType
from app.models.user import User

logger = logging.getLogger(__name__)

#: Reading the clinic's money needs the key that reading the clinic's money
#: needs. There is no separate "AI finance" permission, which would be a second
#: door into the same room.
PERMISSION = "finance.reports"

#: Said whenever anything moved. Not an error state, not a caveat in small
#: print — a required part of the answer.
NO_CAUSE = (
    "These figures show where the change happened, not why. The records hold "
    "amounts and dates; they do not record a reason, so none is offered here."
)

#: Words that assert causation. Checked against the model's own summary, and
#: the summary is discarded if it uses one.
#:
#: The prompt already forbids them. This is the enforcement, because a prompt
#: is a request: "revenue fell because of reduced footfall" is the single most
#: likely sentence a language model produces when handed a falling number, it
#: reads as analysis, and there is nothing in this database that could support
#: it.
_CAUSAL_WORDS = (
    "because", "due to", "driven by", "caused by", "as a result of",
    "thanks to", "owing to", "reflects", "attributable to", "stems from",
    "led to", "resulted in",
)

#: Below this, a movement is noise and attributing it would be worse than
#: saying nothing.
MATERIAL = Decimal("1000.00")

#: A component has to account for at least this share of the total movement
#: before it is reported as a driver.
MIN_SHARE = 0.10


def insights(
    db: Session,
    *,
    user: User,
    permissions: list[str],
    request_id: str,
    start: date,
    end: date,
) -> FinanceInsightsResponse:
    length = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=length - 1)

    current = retrieval.finance_window(
        db, user=user, permissions=permissions, start=start, end=end
    )
    previous = retrieval.finance_window(
        db, user=user, permissions=permissions, start=previous_start, end=previous_end
    )
    outstanding_amount, outstanding_count = retrieval.outstanding(
        db, user=user, permissions=permissions
    )

    revenue_now = Decimal(current["revenue"])
    revenue_then = Decimal(previous["revenue"])
    expenses_now = Decimal(current["expenses"])
    expenses_then = Decimal(previous["expenses"])

    metrics = [
        _metric("Collections", revenue_now, revenue_then),
        _metric("Expenses", expenses_now, expenses_then),
        _metric("Net", revenue_now - expenses_now, revenue_then - expenses_then),
        # Outstanding is a position, not a flow: there is no "previous period"
        # figure that means anything, so it is reported against itself rather
        # than given a fabricated comparison.
        FinanceMetric(
            label=f"Outstanding ({outstanding_count} invoices)",
            current=outstanding_amount,
            previous=outstanding_amount,
            delta=Decimal("0.00"),
            percent=None,
        ),
    ]

    drivers = _drivers(
        dict(current["byDepartment"]), dict(previous["byDepartment"])
    )
    movement = revenue_now - revenue_then
    unexplained = NO_CAUSE if abs(movement) >= MATERIAL else ""

    orchestrator = Orchestrator(
        db=db,
        user=user,
        request_id=request_id,
        agent=AIAgentType.FINANCE_INSIGHTS,
        entity_type="finance",
    )
    orchestrator.enforce_rate_limit()

    narrative, outcome = orchestrator.structured(
        system=prompt.SYSTEM,
        task=prompt.TASK,
        data=prompt.data(
            period=f"{start:%d %b %Y} to {end:%d %b %Y}",
            compared_with=f"{previous_start:%d %b %Y} to {previous_end:%d %b %Y}",
            metrics=[m.model_dump(mode="json") for m in metrics],
            drivers=[d.model_dump(mode="json") for d in drivers],
            unexplained=unexplained,
        ),
        schema=FinanceNarrative,
        prompt_version=prompt.VERSION,
        max_tokens=400,
    )

    summary = _vetted_summary(narrative) or _describe(metrics, drivers)

    return FinanceInsightsResponse(
        meta=outcome.meta(AIAgentType.FINANCE_INSIGHTS, requires_review=True),
        period=f"{start:%d %b %Y} – {end:%d %b %Y}",
        comparedWith=f"{previous_start:%d %b %Y} – {previous_end:%d %b %Y}",
        metrics=metrics,
        drivers=drivers,
        unexplained=unexplained,
        summary=summary,
    )


def _vetted_summary(narrative: FinanceNarrative | None) -> str:
    """The model's summary, or nothing, if it asserted a cause.

    Falling back to the deterministic sentence costs a little polish. Shipping
    "collections are down because fewer patients came in" costs the reader
    their ability to tell what the data actually showed them.
    """
    if narrative is None:
        return ""
    lowered = narrative.summary.lower()
    offender = next((word for word in _CAUSAL_WORDS if word in lowered), None)
    if offender is None:
        return narrative.summary
    logger.info("Discarded finance summary asserting causation via %r", offender)
    return ""


def _metric(label: str, current: Decimal, previous: Decimal) -> FinanceMetric:
    delta = current - previous
    #: A percentage against a zero base is not "infinite growth", it is a
    #: division that has no answer. The field stays empty and the chart shows
    #: the absolute figure.
    percent = float(delta / previous * 100) if previous else None
    return FinanceMetric(
        label=label,
        current=current,
        previous=previous,
        delta=delta,
        percent=round(percent, 1) if percent is not None else None,
    )


def _drivers(current: dict, previous: dict) -> list[FinanceDriver]:
    """Which components account for the movement, and by how much.

    Attribution only, and only in the arithmetic sense: a department's share is
    its own change over the total change. It is not a claim about cause, which
    is what ``unexplained`` exists to say out loud.
    """
    total = sum(
        (Decimal(current.get(k, 0)) - Decimal(previous.get(k, 0))
         for k in set(current) | set(previous)),
        Decimal("0.00"),
    )
    if abs(total) < MATERIAL:
        return []

    drivers = []
    for key in set(current) | set(previous):
        was = Decimal(current.get(key, 0))
        before = Decimal(previous.get(key, 0))
        delta = was - before
        if delta == 0:
            continue
        share = float(delta / total)
        if abs(share) < MIN_SHARE:
            continue
        drivers.append(
            FinanceDriver(
                label=key.display if hasattr(key, "display") else str(key),
                # Both figures travel with the delta so the claim is checkable
                # where it is read: "Therapy 80,000 -> 110,000, +37.5%" can be
                # verified at a glance; "Therapy +30,000" has to be taken on
                # trust.
                previous=before,
                current=was,
                delta=delta,
                percent=round(float(delta / before * 100), 1) if before else None,
                share=round(share, 3),
            )
        )
    return sorted(drivers, key=lambda d: abs(d.delta), reverse=True)[:6]


def _describe(metrics: list[FinanceMetric], drivers: list[FinanceDriver]) -> str:
    """The summary written without a model.

    Reads as a report rather than an apology. It says exactly what the figures
    say and stops, which is what the model is asked for too.
    """
    lead = metrics[0]
    direction = "up" if lead.delta > 0 else "down" if lead.delta < 0 else "level"
    if direction == "level":
        sentence = f"Collections are unchanged at {_rupees(lead.current)}."
    else:
        percent = f" ({abs(lead.percent):.1f}%)" if lead.percent is not None else ""
        sentence = (
            f"Collections are {direction} {_rupees(abs(lead.delta))}{percent} on the "
            f"previous period, at {_rupees(lead.current)}."
        )
    if drivers:
        largest = drivers[0]
        sentence += (
            f" The largest single movement is {largest.label}, "
            f"{'up' if largest.delta > 0 else 'down'} {_rupees(abs(largest.delta))}."
        )
    return sentence


def _rupees(value: Decimal) -> str:
    """A bare number in a sentence about money reads as a different figure to
    the one in the tile beside it. Same currency, same rounding, every time."""
    return f"₹{value:,.2f}"
