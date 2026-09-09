"""What the AI layer has actually done, aggregated from its own audit table.

Every number here is a ``COUNT``, a ``SUM`` or a ``percentile_cont`` over rows
that exist. Nothing is modelled, projected or filled in.

Three deliberate absences, each of which would have been easy to paper over:

* **Cost is null unless rates are configured.** This system does not know what
  anybody's provider contract says. An estimate would be quoted in a budget
  review as though somebody had measured it.
* **Token counts are null unless the provider reported them.** Not every
  endpoint returns a usage block, and zero is indistinguishable from silence.
* **Percentiles are null below ten samples.** A p95 over four requests is a
  restatement of the slowest one wearing a statistic's clothes.

The dashboard renders those nulls as "not reported" rather than as zero, which
is the whole reason they are nullable.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import Float, case, cast, func, select
from sqlalchemy.orm import Session

from app.ai.limits import all_limits
from app.ai.schemas import AIAgentUsage, AIUsageResponse
from app.core.enums import AIAgentType, AIRunStatus
from app.models.ai import AIApproval, AIAuditLog, AIDocument, MessageDraft

#: Below this many timed samples a percentile is not reported. Ten is not a
#: statistically meaningful threshold either — it is simply the point below
#: which the number is obviously one or two requests, and saying nothing beats
#: publishing a figure that will be read as a distribution.
MIN_SAMPLES_FOR_PERCENTILES = 10


def summarise(db: Session, *, days: int = 30) -> AIUsageResponse:
    since = datetime.now(timezone.utc) - timedelta(days=days)

    rows = db.execute(
        select(
            AIAuditLog.agent_type,
            func.count().label("runs"),
            func.count(case((AIAuditLog.status == AIRunStatus.SUCCEEDED, 1))).label("succeeded"),
            func.count(case((AIAuditLog.status == AIRunStatus.DEGRADED, 1))).label("degraded"),
            func.count(case((AIAuditLog.status == AIRunStatus.FAILED, 1))).label("failed"),
            func.count(
                case((AIAuditLog.status == AIRunStatus.INVALID_OUTPUT, 1))
            ).label("invalid"),
            func.count(
                case((AIAuditLog.status == AIRunStatus.RATE_LIMITED, 1))
            ).label("rate_limited"),
            func.count(AIAuditLog.duration_ms).label("timed"),
            func.percentile_cont(0.5)
            .within_group(cast(AIAuditLog.duration_ms, Float))
            .label("p50"),
            func.percentile_cont(0.95)
            .within_group(cast(AIAuditLog.duration_ms, Float))
            .label("p95"),
            func.sum(AIAuditLog.input_tokens).label("input_tokens"),
            func.sum(AIAuditLog.output_tokens).label("output_tokens"),
            func.sum(AIAuditLog.estimated_cost).label("cost"),
        )
        .where(AIAuditLog.created_at >= since)
        .group_by(AIAuditLog.agent_type)
    ).all()

    limits = all_limits()
    by_agent = [
        AIAgentUsage(
            agent=row.agent_type,
            runs=int(row.runs),
            succeeded=int(row.succeeded),
            degraded=int(row.degraded),
            failed=int(row.failed),
            invalidOutput=int(row.invalid),
            rateLimited=int(row.rate_limited),
            p50Ms=_percentile(row.p50, row.timed),
            p95Ms=_percentile(row.p95, row.timed),
            inputTokens=_int_or_none(row.input_tokens),
            outputTokens=_int_or_none(row.output_tokens),
            estimatedCost=float(row.cost) if row.cost is not None else None,
            hourlyLimit=limits.get(row.agent_type.value, 0),
        )
        for row in rows
    ]
    # Agents that have not run at all still appear, at zero. An absent row and
    # a zero row look the same on a dashboard, and only one of them is true.
    seen = {usage.agent for usage in by_agent}
    for agent in AIAgentType:
        if agent not in seen:
            by_agent.append(
                AIAgentUsage(agent=agent, hourlyLimit=limits.get(agent.value, 0))
            )
    by_agent.sort(key=lambda u: u.runs, reverse=True)

    totals = _totals(by_agent)
    return AIUsageResponse(
        windowDays=days,
        totalRuns=totals["runs"],
        succeeded=totals["succeeded"],
        degraded=totals["degraded"],
        failed=totals["failed"],
        invalidOutput=totals["invalid"],
        rateLimited=totals["rateLimited"],
        inputTokens=totals["inputTokens"],
        outputTokens=totals["outputTokens"],
        estimatedCost=totals["cost"],
        byAgent=by_agent,
        documentsProcessed=_count(db, AIDocument, AIDocument.created_at, since),
        documentsApproved=_count(
            db, AIDocument, AIDocument.created_at, since, AIDocument.applied.is_(True)
        ),
        remindersDrafted=_count(db, MessageDraft, MessageDraft.created_at, since),
        approvalsRecorded=_count(db, AIApproval, AIApproval.created_at, since),
    )


def _percentile(value, sample_count) -> int | None:
    """A percentile, or nothing when there is not enough to base one on."""
    if value is None or (sample_count or 0) < MIN_SAMPLES_FOR_PERCENTILES:
        return None
    return int(value)


def _int_or_none(value) -> int | None:
    return int(value) if value is not None else None


def _count(db: Session, model, column, since, *extra) -> int:
    stmt = select(func.count()).select_from(model).where(column >= since)
    for clause in extra:
        stmt = stmt.where(clause)
    return int(db.execute(stmt).scalar_one())


def _totals(rows: list[AIAgentUsage]) -> dict:
    """Sums, with token and cost totals staying null when nothing reported any.

    ``sum()`` over a list of ``None`` is zero, and zero here would read as "the
    AI cost us nothing" rather than "nobody told us".
    """
    tokens_in = [r.inputTokens for r in rows if r.inputTokens is not None]
    tokens_out = [r.outputTokens for r in rows if r.outputTokens is not None]
    costs = [r.estimatedCost for r in rows if r.estimatedCost is not None]
    return {
        "runs": sum(r.runs for r in rows),
        "succeeded": sum(r.succeeded for r in rows),
        "degraded": sum(r.degraded for r in rows),
        "failed": sum(r.failed for r in rows),
        "invalid": sum(r.invalidOutput for r in rows),
        "rateLimited": sum(r.rateLimited for r in rows),
        "inputTokens": sum(tokens_in) if tokens_in else None,
        "outputTokens": sum(tokens_out) if tokens_out else None,
        "cost": round(sum(costs), 6) if costs else None,
    }
