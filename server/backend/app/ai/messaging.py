"""Outbound SMS and WhatsApp, behind an interface the AI cannot reach.

This module is deliberately not imported by any agent. The follow-up agent
writes a :class:`~app.models.ai.MessageDraft` and stops; a human approves it;
the approval route — not the agent — calls a provider here. There is no code
path from a model's output to a patient's phone that does not pass through a
person clicking approve.

What a provider is told is also constrained. A reminder carries a date, a
place and a name. It does not carry a diagnosis, a medicine, a test result or
anything else from the clinical record, because an SMS gateway is an unrelated
company reading plain text over an unencrypted last hop.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.core.enums import MessageChannel

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SendResult:
    """What a provider actually told us.

    ``accepted`` means the gateway took the request. It is not delivery, and
    the caller maps it to ``SENT`` rather than ``DELIVERED`` for exactly that
    reason — a delivery receipt arrives later, over a callback this build does
    not yet have.
    """

    accepted: bool
    reference: str | None = None
    error: str | None = None


class MessagingProvider(ABC):
    name: str = "none"

    @property
    def available(self) -> bool:
        return False

    @abstractmethod
    def send(self, *, channel: MessageChannel, to: str, body: str) -> SendResult:
        """Hand one message to the gateway."""

    # Convenience wrappers, so a caller reads as the spec describes it.
    def send_sms(self, *, to: str, body: str) -> SendResult:
        return self.send(channel=MessageChannel.SMS, to=to, body=body)

    def send_whatsapp(self, *, to: str, body: str) -> SendResult:
        return self.send(channel=MessageChannel.WHATSAPP, to=to, body=body)


class NullMessagingProvider(MessagingProvider):
    """The default. Queues, and says so.

    An approved draft with no gateway behind it stays ``PENDING``. It is not
    marked sent, and the queue keeps showing it — a clinic must be able to see
    that its reminders are not going anywhere.
    """

    name = "none"

    def send(self, *, channel: MessageChannel, to: str, body: str) -> SendResult:
        return SendResult(
            accepted=False,
            error="No messaging provider is configured, so the message is queued only.",
        )


class HttpMessagingProvider(MessagingProvider):
    """A gateway reached over HTTP with a bearer key."""

    def __init__(self, *, name: str, api_key: str, endpoint: str, sender: str) -> None:
        self.name = name
        self._key = api_key
        self._endpoint = endpoint
        self._sender = sender

    @property
    def available(self) -> bool:
        return bool(self._key and self._endpoint)

    def send(self, *, channel: MessageChannel, to: str, body: str) -> SendResult:
        try:
            response = httpx.post(
                self._endpoint,
                json={
                    "channel": channel.value,
                    "to": to,
                    "from": self._sender,
                    "body": body,
                },
                headers={"Authorization": f"Bearer {self._key}"},
                timeout=settings.AI_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            logger.warning("Messaging provider %s unreachable: %s", self.name, type(exc).__name__)
            return SendResult(accepted=False, error="The messaging service could not be reached.")

        if response.status_code >= 400:
            return SendResult(
                accepted=False,
                error=f"The messaging service refused the request (HTTP {response.status_code}).",
            )

        reference = None
        try:
            body_json = response.json()
            if isinstance(body_json, dict):
                for field in ("id", "message_id", "sid", "reference"):
                    value = body_json.get(field)
                    if isinstance(value, str):
                        reference = value
                        break
        except ValueError:
            # A 2xx with an unreadable body is still an acceptance. Losing the
            # reference costs us traceability, not correctness.
            pass
        return SendResult(accepted=True, reference=reference)


def get_messaging_provider() -> MessagingProvider:
    if not settings.messaging_enabled:
        return NullMessagingProvider()
    return HttpMessagingProvider(
        name=settings.MESSAGING_PROVIDER,
        api_key=settings.MESSAGING_API_KEY,
        endpoint=settings.MESSAGING_ENDPOINT,
        sender=settings.MESSAGING_SENDER_ID,
    )
