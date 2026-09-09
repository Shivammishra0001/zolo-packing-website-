"""The only thing allowed to call a model.

Agents describe what they want; this module decides whether it may happen, does
it, checks the answer, and records that it happened. Centralising it means the
rate limit, the retry policy, the validation loop, the redaction rule and the
audit row cannot be forgotten by whoever writes the sixth agent.

The contract with an agent is deliberately narrow:

* it hands over a system prompt, a task, untrusted data and a Pydantic class;
* it gets back either a validated instance of that class, or ``None``;
* ``None`` is normal and must be handled, not propagated as an error.

There is no method that returns unvalidated model output, and no method that
lets an agent assemble a prompt without the untrusted half being fenced.

Two loops run here and they are not the same loop:

* **retry** — the same request sent again because the *transport* failed in a
  way that might clear. Bounded, with backoff, transient failures only.
* **repair** — a new request because the *output* failed validation, showing
  the model what was wrong. Bounded at one, never for a transport failure.

Conflating them is how a malformed reply turns into six identical requests.
"""

from __future__ import annotations

import logging
import re
import time
import uuid as uuid_lib
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import TypeVar

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.limits import hourly_limit
from app.ai.prompts import compose
from app.ai.provider import AIProvider, ProviderUnavailable, Usage, get_provider
from app.ai.schemas import AIMeta
from app.core.config import settings
from app.core.enums import AIAgentType, AIRunStatus
from app.core.errors import AppError
from app.models.ai import AIAuditLog
from app.models.user import User

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

#: Bumped when an agent's retrieval or post-processing changes in a way that
#: could change its output, independently of the prompt. Stored on every run so
#: a summary read six months from now can be traced to the code that made it.
AGENT_VERSION = "agent/v2"

#: Sent to the client whenever the deterministic half carried the answer alone.
DEGRADED_NOTICE = (
    "The AI model was not available, so this was produced from your records only. "
    "Every figure and date below comes from the database."
)

INVALID_NOTICE = (
    "The AI model returned something this system could not verify, so it was "
    "discarded. The figures and dates below come from your records."
)

TIMEOUT_NOTICE = (
    "AI request timed out. The figures and dates below come from your records "
    "and are unaffected."
)


class RateLimited(AppError):
    status_code = 429


@dataclass
class RunOutcome:
    """How one agent run went, in the terms the audit table records."""

    status: AIRunStatus = AIRunStatus.DEGRADED
    detail: str = ""
    provider: str = "none"
    model: str = ""
    prompt_version: str = ""
    agent_version: str = AGENT_VERSION
    duration_ms: int = 0
    retries: int = 0
    timed_out: bool = False
    usage: Usage = field(default_factory=Usage)

    @property
    def degraded(self) -> bool:
        return self.status is not AIRunStatus.SUCCEEDED

    def notice(self) -> str:
        if self.status is AIRunStatus.SUCCEEDED:
            return ""
        if self.timed_out:
            return TIMEOUT_NOTICE
        if self.status is AIRunStatus.INVALID_OUTPUT:
            return INVALID_NOTICE
        return DEGRADED_NOTICE

    def meta(self, agent: AIAgentType, *, requires_review: bool = True) -> AIMeta:
        return AIMeta(
            agent=agent,
            status=self.status,
            provider=self.provider,
            model=self.model,
            promptVersion=self.prompt_version,
            agentVersion=self.agent_version,
            generatedAt=datetime.now(timezone.utc),
            degraded=self.degraded,
            notice=self.notice(),
            requiresReview=requires_review,
            durationMs=self.duration_ms or None,
        )


@dataclass
class Orchestrator:
    """One per request. Knows who is asking and what they are asking about."""

    db: Session
    user: User
    request_id: str
    agent: AIAgentType
    entity_type: str | None = None
    entity_id: uuid_lib.UUID | None = None
    provider: AIProvider = field(default_factory=get_provider)

    # -- gate --------------------------------------------------------------

    def enforce_rate_limit(self) -> None:
        """Refuse a caller who has used this agent's hourly allowance.

        Counted per agent, so exhausting one feature does not disable the other
        four. Only runs that actually reached a provider count: when no model
        is configured every agent still works, entirely from SQL, and
        throttling those would be throttling PostgreSQL on behalf of a service
        that was never called.
        """
        if not self.provider.available:
            return
        limit = hourly_limit(self.agent)
        used = self._runs_this_hour()
        if used >= limit:
            self._audit(
                RunOutcome(
                    status=AIRunStatus.RATE_LIMITED,
                    detail=f"{used} runs of {self.agent.value} in the last hour (limit {limit})",
                    provider=self.provider.name,
                    model=self.provider.model,
                ),
                # The refusal has to survive the exception that follows it, or
                # the one event an operator most wants in the audit trail is
                # the one event the rollback removes.
                commit=True,
            )
            raise RateLimited(
                f"You have made too many {self.agent.display} requests in the last hour. "
                "Please try again later.",
                code="ai_rate_limited",
            )

    def remaining_this_hour(self) -> int:
        if not self.provider.available:
            return hourly_limit(self.agent)
        return max(0, hourly_limit(self.agent) - self._runs_this_hour())

    def _runs_this_hour(self) -> int:
        since = datetime.now(timezone.utc) - timedelta(hours=1)
        return int(
            self.db.execute(
                select(func.count())
                .select_from(AIAuditLog)
                .where(
                    AIAuditLog.user_id == self.user.id,
                    AIAuditLog.agent_type == self.agent,
                    AIAuditLog.created_at >= since,
                    # A refusal is not a use. Counting them would let a burst
                    # of 429s extend its own lockout indefinitely.
                    AIAuditLog.status != AIRunStatus.RATE_LIMITED,
                )
            ).scalar_one()
        )

    # -- generation --------------------------------------------------------

    def structured(
        self,
        *,
        system: str,
        task: str,
        data: str,
        schema: type[T],
        prompt_version: str,
        max_tokens: int = 800,
    ) -> tuple[T | None, RunOutcome]:
        """Ask for JSON, validate it, and repair once if it does not fit.

        ``task`` is what the application is asking for; ``data`` is whatever
        came out of the database or off a scanned page. They are separate
        parameters so that no agent can accidentally hand the model a task
        string that a patient wrote — see :func:`app.ai.prompts.compose`.

        Returns ``(None, outcome)`` for every failure mode there is. The caller
        cannot tell an unconfigured provider from a timeout from malformed
        output, which is the point — all three mean "use the deterministic
        answer", and all three are distinguished in the audit row rather than
        in branching at the call site.
        """
        outcome = RunOutcome(
            provider=self.provider.name,
            model=self.provider.model,
            prompt_version=prompt_version,
        )
        if not self.provider.available:
            outcome.status = AIRunStatus.DEGRADED
            outcome.detail = "No AI provider is configured."
            self._audit(outcome)
            return None, outcome

        prompt = compose(task=task, data=data)
        json_schema = schema.model_json_schema()
        started = time.perf_counter()
        attempt_prompt = prompt
        last_error = ""

        # Two *repair* attempts, no more. A model that has already been shown
        # its own validation errors and still cannot satisfy the schema is not
        # going to on the third try, and each attempt is another clinical
        # context leaving the building.
        for attempt in (1, 2):
            try:
                raw, usage = self._call_with_retries(
                    system=system, prompt=attempt_prompt, schema=json_schema,
                    max_tokens=max_tokens, outcome=outcome,
                )
            except ProviderUnavailable as exc:
                outcome.status = AIRunStatus.FAILED
                outcome.detail = str(exc)
                outcome.timed_out = getattr(exc, "timed_out", False)
                outcome.duration_ms = _elapsed(started)
                self._audit(outcome, prompt=prompt)
                return None, outcome

            outcome.usage = usage
            try:
                validated = schema.model_validate(raw)
            except ValidationError as exc:
                last_error = _explain(exc)
                logger.info(
                    "AI output failed validation (%s, attempt %s): %s",
                    self.agent.value,
                    attempt,
                    last_error,
                )
                attempt_prompt = (
                    f"{prompt}\n\nYour previous reply did not validate. Fix exactly "
                    f"these problems and reply with JSON only:\n{last_error}"
                )
                continue

            outcome.status = AIRunStatus.SUCCEEDED
            outcome.duration_ms = _elapsed(started)
            self._audit(outcome, prompt=prompt, completion=validated.model_dump_json())
            return validated, outcome

        outcome.status = AIRunStatus.INVALID_OUTPUT
        outcome.detail = f"Output failed validation twice: {last_error}"[:2000]
        outcome.duration_ms = _elapsed(started)
        self._audit(outcome, prompt=prompt)
        return None, outcome

    def _call_with_retries(
        self, *, system: str, prompt: str, schema: dict, max_tokens: int, outcome: RunOutcome
    ) -> tuple[dict, Usage]:
        """One request, retried only for failures that might clear.

        A validation failure, a refusal and a malformed body are all final: the
        service answered, and it will answer the same way. Only a timeout, a
        reset connection or a 5xx earns another attempt, with a backoff so a
        struggling provider is not hammered by every worker at once.
        """
        attempts = max(0, settings.AI_MAX_RETRIES) + 1
        for attempt in range(attempts):
            try:
                return self.provider.generate_structured(
                    system=system, prompt=prompt, schema=schema, max_tokens=max_tokens
                )
            except ProviderUnavailable as exc:
                last = attempt == attempts - 1
                if last or not exc.transient:
                    raise
                outcome.retries += 1
                # Exponential, and bounded by the attempt count above — there is
                # no path here that loops.
                time.sleep(settings.AI_RETRY_BACKOFF_SECONDS * (2**attempt))
        raise ProviderUnavailable("The AI service could not be reached.")  # pragma: no cover

    def deterministic(self, *, detail: str = "") -> RunOutcome:
        """Record a run that never needed a model.

        Used by the agents whose answer is arithmetic — a billing check does
        not become more correct for having been read by a language model, and
        saying so in the audit trail is more useful than a blank row.
        """
        outcome = RunOutcome(
            status=AIRunStatus.DEGRADED,
            detail=detail or "Computed from records; no model was called.",
            provider="none",
        )
        self._audit(outcome)
        return outcome

    # -- audit -------------------------------------------------------------

    def _audit(
        self, outcome: RunOutcome, *, prompt: str = "", completion: str = "", commit: bool = False
    ) -> None:
        """Write one row saying this happened.

        Joins the caller's transaction by default, so an aborted request does
        not leave an audit row claiming work that was rolled back.

        ``commit`` is the exception, used only where the row records a refusal
        that is about to raise. Without it the rollback that carries the 429 to
        the client also erases the evidence that a 429 was issued.
        """
        store = settings.AI_STORE_PAYLOADS
        self.db.add(
            AIAuditLog(
                user_id=self.user.id,
                agent_type=self.agent,
                entity_type=self.entity_type,
                entity_id=self.entity_id,
                request_id=self.request_id,
                model=outcome.model or None,
                provider=outcome.provider or None,
                prompt_version=outcome.prompt_version or None,
                agent_version=outcome.agent_version or None,
                status=outcome.status,
                detail=outcome.detail or None,
                duration_ms=outcome.duration_ms or None,
                retries=outcome.retries or None,
                input_tokens=outcome.usage.input_tokens,
                output_tokens=outcome.usage.output_tokens,
                estimated_cost=outcome.usage.cost,
                prompt=redact(prompt) if (store and prompt) else None,
                completion=redact(completion) if (store and completion) else None,
            )
        )
        if commit:
            self.db.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PHONE = re.compile(r"\+?\d[\d \-]{8,}\d")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_LONG_DIGITS = re.compile(r"\b\d{6,}\b")


def redact(text: str) -> str:
    """Strip the identifiers a stored payload has no business keeping.

    This is a reduction, not anonymisation: a prompt still contains clinical
    context, which is why ``AI_STORE_PAYLOADS`` defaults to off and is
    documented as a development switch. What this removes is the direct
    identifiers that would make a leaked debug table immediately actionable.
    """
    text = _EMAIL.sub("[email]", text)
    text = _PHONE.sub("[phone]", text)
    text = _LONG_DIGITS.sub("[number]", text)
    return text[:8000]


def _explain(exc: ValidationError) -> str:
    """Validation errors in a form a model can act on, truncated hard.

    Only the field path and the message. ``e['input']`` is deliberately not
    included: it would echo the rejected value, which on a clinical agent is
    the clinical content, straight into a log line.
    """
    lines = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:8]]
    return "; ".join(lines)[:800]


def _elapsed(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
