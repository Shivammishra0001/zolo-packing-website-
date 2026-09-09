"""Optical character recognition, behind the same kind of interface.

Kept separate from :mod:`app.ai.provider` because reading pixels and writing
prose are different services with different vendors, and a deployment may well
have one and not the other.

An OCR engine returns *text*, never structure. Deciding that a line means "10mg
twice daily" is the documentation agent's job, and it happens afterwards under
Pydantic validation and human review.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

#: Only formats a clinician would realistically photograph or scan. Anything
#: else is rejected at upload rather than handed to a parser.
ACCEPTED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain",
}

#: 10 MB. A phone photo of a prescription is well under this; the limit exists
#: so one upload cannot exhaust memory or the request timeout.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class OCRUnavailable(RuntimeError):
    """No engine is configured, or the configured one failed."""


class OCRProvider(ABC):
    name: str = "none"

    @property
    def available(self) -> bool:
        return False

    @abstractmethod
    def extract_text(self, *, content: bytes, content_type: str) -> str:
        """Return what is written on the document, verbatim."""


class PlainTextOCR(OCRProvider):
    """The default, and more useful than it sounds.

    It handles exactly one case honestly: a file that is already text needs no
    optical recognition, so decoding it is not a fallback, it is the correct
    answer. Anything that genuinely requires recognition is refused rather than
    guessed at, because a document parser that invents text for an image it
    cannot read is the single worst failure this feature could have.
    """

    name = "plain-text"

    @property
    def available(self) -> bool:
        return True

    def extract_text(self, *, content: bytes, content_type: str) -> str:
        if content_type != "text/plain":
            raise OCRUnavailable(
                "No OCR engine is configured, so scanned images and PDFs cannot be "
                "read automatically. The document has been stored and can be "
                "transcribed by hand."
            )
        try:
            return content.decode("utf-8").strip()
        except UnicodeDecodeError:
            return content.decode("latin-1", errors="replace").strip()


class HttpOCRProvider(OCRProvider):
    """A hosted engine reached over HTTP.

    Kept generic on purpose. The endpoint is configured, the response is read
    from a small set of common field names, and nothing about a particular
    vendor leaks past this class.
    """

    def __init__(self, *, name: str, api_key: str, endpoint: str) -> None:
        self.name = name
        self._key = api_key
        self._endpoint = endpoint

    @property
    def available(self) -> bool:
        return bool(self._key and self._endpoint)

    def extract_text(self, *, content: bytes, content_type: str) -> str:
        try:
            response = httpx.post(
                self._endpoint,
                content=content,
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type": content_type,
                },
                timeout=settings.AI_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            logger.warning("OCR provider %s unreachable: %s", self.name, type(exc).__name__)
            raise OCRUnavailable("The OCR service could not be reached.") from exc

        if response.status_code >= 400:
            raise OCRUnavailable(f"The OCR service refused the request (HTTP {response.status_code}).")

        try:
            body = response.json()
        except ValueError as exc:
            raise OCRUnavailable("The OCR service returned an unreadable response.") from exc

        for field in ("text", "content", "result"):
            value = body.get(field) if isinstance(body, dict) else None
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise OCRUnavailable("The OCR service returned no text.")


def get_ocr_provider() -> OCRProvider:
    if not settings.ocr_enabled:
        return PlainTextOCR()
    return HttpOCRProvider(
        name=settings.OCR_PROVIDER,
        api_key=settings.OCR_API_KEY,
        endpoint=settings.OCR_ENDPOINT,
    )
