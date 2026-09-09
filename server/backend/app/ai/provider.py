"""Text-generation provider abstraction.

One interface, several possible implementations, chosen by environment
variable. No agent, service or route mentions a vendor by name — swapping
providers is a configuration change, and running with no provider at all is a
supported state rather than a broken one.

Keys are read from settings, which reads them from the environment. Nothing
here logs a key, returns one, or writes one to the database.

Failures are classified rather than lumped together. ``ProviderUnavailable``
carries a ``transient`` flag, and only transient failures are worth retrying: a
timeout or a 503 may succeed a moment later, while a 400 or a refusal will be
refused again and retrying it just sends the same clinical context out twice.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class ProviderUnavailable(RuntimeError):
    """The model could not be reached, or none is configured.

    Raised rather than returned so a caller cannot mistake it for output. Every
    agent catches it and falls back to its deterministic half.

    ``transient`` says whether trying again could plausibly help. ``timed_out``
    is surfaced separately because "the service took too long" is a different
    operational problem from "the service is not there", and an operator
    reading the audit table needs to be able to tell them apart.
    """

    def __init__(self, message: str, *, transient: bool = False, timed_out: bool = False) -> None:
        super().__init__(message)
        self.transient = transient
        self.timed_out = timed_out


@dataclass(frozen=True)
class Usage:
    """What one call consumed, as the provider reported it.

    Every field is optional because not every provider reports usage, and a
    zero would be indistinguishable from "it told us nothing". ``cost`` stays
    ``None`` unless the deployment has configured its own rates — this system
    does not know what anybody's contract says, and a plausible-looking
    estimate is worse than an empty column.
    """

    input_tokens: int | None = None
    output_tokens: int | None = None
    cost: float | None = None

    @classmethod
    def from_body(cls, body: dict[str, Any]) -> "Usage":
        usage = body.get("usage") if isinstance(body, dict) else None
        if not isinstance(usage, dict):
            return cls()
        inp = _int_or_none(usage.get("prompt_tokens", usage.get("input_tokens")))
        out = _int_or_none(usage.get("completion_tokens", usage.get("output_tokens")))
        return cls(input_tokens=inp, output_tokens=out, cost=_estimate_cost(inp, out))


@dataclass(frozen=True)
class Completion:
    """Model output plus what it cost to get it."""

    text: str
    usage: Usage = Usage()


class AIProvider(ABC):
    """What the rest of the layer is allowed to ask a model to do."""

    #: Shown in audit rows and to the user. Never a key, never a URL.
    name: str = "none"
    model: str = ""

    @property
    def available(self) -> bool:
        return False

    @abstractmethod
    def generate(self, *, system: str, prompt: str, max_tokens: int = 800) -> Completion:
        """Free text in, free text out."""

    @abstractmethod
    def generate_structured(
        self, *, system: str, prompt: str, schema: dict[str, Any], max_tokens: int = 800
    ) -> tuple[dict[str, Any], Usage]:
        """Ask for JSON matching ``schema`` and return it parsed, with usage.

        The parsed dictionary is still untrusted: the orchestrator validates it
        against a Pydantic model afterwards. "The provider said it was JSON" is
        not the same as "the fields are the ones we asked for".
        """

    def transcribe(self, *, audio: bytes, content_type: str) -> str:
        """Speech to text.

        Optional. The default refuses rather than pretending, so a caller
        cannot receive silence and treat it as an empty dictation.
        """
        raise ProviderUnavailable("This provider does not support transcription.")


class NullProvider(AIProvider):
    """The default. Declines every request, immediately and predictably.

    This is what runs when no key is configured, which is how the application
    ships. It exists so that "no provider" travels through exactly the same
    code path as "provider timed out" — the degraded path is therefore the one
    exercised on every developer machine, rather than the one nobody tries
    until production.

    The refusal is marked non-transient: there is nothing to retry.
    """

    name = "none"

    def generate(self, *, system: str, prompt: str, max_tokens: int = 800) -> Completion:
        raise ProviderUnavailable("No AI provider is configured.")

    def generate_structured(
        self, *, system: str, prompt: str, schema: dict[str, Any], max_tokens: int = 800
    ) -> tuple[dict[str, Any], Usage]:
        raise ProviderUnavailable("No AI provider is configured.")


class ChatCompletionsProvider(AIProvider):
    """Any service speaking the OpenAI ``/chat/completions`` dialect.

    That covers a large share of hosted and self-hosted models, which is the
    point: a deployment picks one with ``AI_PROVIDER``, ``AI_BASE_URL`` and
    ``AI_MODEL``, and this class does not need to know which.
    """

    def __init__(self, *, name: str, api_key: str, model: str, base_url: str) -> None:
        self.name = name
        self.model = model
        self._key = api_key
        self._base_url = base_url.rstrip("/")

    @property
    def available(self) -> bool:
        return bool(self._key and self._base_url and self.model)

    def generate(self, *, system: str, prompt: str, max_tokens: int = 800) -> Completion:
        body = self._post({
            "model": self.model,
            "max_tokens": max_tokens,
            # Clinical and financial summaries should read the same way twice.
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        })
        return Completion(text=self._content(body), usage=Usage.from_body(body))

    def generate_structured(
        self, *, system: str, prompt: str, schema: dict[str, Any], max_tokens: int = 800
    ) -> tuple[dict[str, Any], Usage]:
        body = self._post({
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": (
                        f"{prompt}\n\nReply with a single JSON object matching this "
                        f"schema. No prose, no code fence.\n{json.dumps(schema)}"
                    ),
                },
            ],
        })
        raw = self._content(body)
        try:
            parsed = json.loads(_strip_fence(raw))
        except json.JSONDecodeError as exc:
            # Malformed output is the orchestrator's problem to repair, not a
            # transport problem to retry.
            raise ProviderUnavailable("The model did not return JSON.") from exc
        if not isinstance(parsed, dict):
            raise ProviderUnavailable("The model returned JSON that is not an object.")
        return parsed, Usage.from_body(body)

    # -- transport ---------------------------------------------------------

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = httpx.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type": "application/json",
                },
                timeout=settings.AI_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException as exc:
            logger.warning("AI provider %s timed out", self.name)
            raise ProviderUnavailable(
                "AI request timed out.", transient=True, timed_out=True
            ) from exc
        except httpx.HTTPError as exc:
            # Only the exception class is logged. Transport errors can carry the
            # request in their text, and this line runs on every failure.
            logger.warning("AI provider %s unreachable: %s", self.name, type(exc).__name__)
            raise ProviderUnavailable(
                "The AI service could not be reached.", transient=True
            ) from exc

        if response.status_code >= 400:
            logger.warning("AI provider %s returned HTTP %s", self.name, response.status_code)
            # 408/429 and the 5xx family may clear on their own. A 400 or a 401
            # will not, and retrying one just sends the context again.
            transient = response.status_code in (408, 425, 429) or response.status_code >= 500
            raise ProviderUnavailable(
                f"The AI service refused the request (HTTP {response.status_code}).",
                transient=transient,
            )
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderUnavailable("The AI service returned an unreadable response.") from exc

    @staticmethod
    def _content(body: dict[str, Any]) -> str:
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderUnavailable("The AI service returned an unexpected shape.") from exc
        if not isinstance(content, str) or not content.strip():
            raise ProviderUnavailable("The AI service returned nothing.")
        return content.strip()


def _int_or_none(value) -> int | None:
    return int(value) if isinstance(value, (int, float)) and value >= 0 else None


def _estimate_cost(input_tokens: int | None, output_tokens: int | None) -> float | None:
    """Cost, only where the deployment has said what it pays.

    Both rates default to zero, and zero means "not configured" rather than
    "free" — with neither set this returns ``None`` and the column stays empty.
    A fabricated cost figure would be quoted in an operations review as though
    somebody had measured it.
    """
    rate_in = settings.AI_INPUT_COST_PER_MTOK
    rate_out = settings.AI_OUTPUT_COST_PER_MTOK
    if not rate_in and not rate_out:
        return None
    if input_tokens is None and output_tokens is None:
        return None
    million = 1_000_000
    return round(
        (input_tokens or 0) / million * rate_in + (output_tokens or 0) / million * rate_out, 6
    )


def _strip_fence(raw: str) -> str:
    """Models fence JSON in markdown often enough to be worth handling."""
    text = raw.strip()
    if not text.startswith("```"):
        return text
    body = text.split("\n", 1)[1] if "\n" in text else ""
    return body.rsplit("```", 1)[0].strip()


def get_provider() -> AIProvider:
    """The configured provider, or the null one.

    Deliberately not cached: an operator who adds a key and restarts a worker
    should not have to reason about which process is holding a stale object,
    and constructing this is a handful of string reads.
    """
    if not settings.ai_enabled:
        return NullProvider()
    return ChatCompletionsProvider(
        name=settings.AI_PROVIDER,
        api_key=settings.AI_API_KEY,
        model=settings.AI_MODEL or "gpt-4o-mini",
        base_url=settings.AI_BASE_URL or "https://api.openai.com/v1",
    )
