"""Application configuration.

Every value is read from the environment (or a local ``.env``). Nothing is
hardcoded here, so the same image can run in development and production with
different secrets injected at deploy time.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]


class Settings(BaseSettings):
    """Runtime settings, validated at import time so misconfiguration fails fast."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Identity -------------------------------------------------------------
    PROJECT_NAME: str = "Rehabilitation Centre HMS API"
    VERSION: str = "1.0.0"
    API_PREFIX: str = "/api"
    ENVIRONMENT: Environment = "development"

    # --- Database -------------------------------------------------------------
    DATABASE_URL: PostgresDsn = Field(
        ...,
        description="SQLAlchemy URL, e.g. postgresql+psycopg://user:pass@host:5432/rehab_hms",
    )
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_RECYCLE_SECONDS: int = 1800
    DB_ECHO: bool = False
    # Fail fast when Postgres is unreachable, so health checks answer promptly
    # instead of blocking on TCP retries.
    DB_CONNECT_TIMEOUT_SECONDS: int = 5
    # Health probes get an even shorter budget so /api/health stays snappy.
    DB_HEALTHCHECK_TIMEOUT_SECONDS: int = 3
    # Startup retry window, so the API survives Postgres not being ready yet.
    DB_CONNECT_RETRIES: int = 10
    DB_CONNECT_RETRY_DELAY_SECONDS: float = 2.0

    # --- Auth (consumed in a later step; declared now so .env is complete) -----
    # 32 bytes is the RFC 7518 minimum for HS256; PyJWT warns below it.
    JWT_SECRET: str = Field(..., min_length=32)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # --- CORS -----------------------------------------------------------------
    FRONTEND_URL: str = "http://localhost:5173"
    EXTRA_CORS_ORIGINS: str = ""

    # --- Logging --------------------------------------------------------------
    LOG_LEVEL: str = "INFO"

    # --- Demo mode ------------------------------------------------------------
    # When true, the API exposes development-only affordances (the seeded demo
    # password hint on the login schema, and the frontend role switcher).
    # It must be false anywhere real credentials exist.
    DEMO_MODE: bool = False

    # --- Clinic locale --------------------------------------------------------
    # Timestamps are stored in UTC. Clock times shown to staff (appointment
    # slots, check-in times, queue waits) are wall-clock times at the centre,
    # so they are converted to this zone on the way out.
    CLINIC_TIMEZONE: str = "Asia/Kolkata"

    # --- Clinic identity ------------------------------------------------------
    # Appears on invoices and in patient-facing reminders. Not a secret, but it
    # belongs in configuration rather than in two unrelated modules.
    CLINIC_NAME: str = "Arogya Rehabilitation Centre"

    # --- AI layer -------------------------------------------------------------
    # Every AI feature degrades to its deterministic half when no provider is
    # configured, which is the default. Nothing in the HMS depends on one.
    AI_PROVIDER: str = ""
    AI_API_KEY: str = ""
    AI_MODEL: str = ""
    AI_BASE_URL: str = ""
    AI_TIMEOUT_SECONDS: float = 30.0
    #: Transient failures only — a reset connection, a 503, a timeout. Never a
    #: validation failure or a refusal, which would only be refused again.
    AI_MAX_RETRIES: int = 2
    AI_RETRY_BACKOFF_SECONDS: float = 0.5
    #: Per million tokens, for the configured model. Zero means the deployment
    #: has not told us what it pays, and no cost is estimated rather than a
    #: plausible-looking number being invented.
    AI_INPUT_COST_PER_MTOK: float = 0.0
    AI_OUTPUT_COST_PER_MTOK: float = 0.0
    #: Per user, per hour. AI calls cost money and a frontend loop should not
    #: be able to spend it.
    #: The fallback hourly allowance, used by any agent without its own.
    AI_RATE_LIMIT_PER_HOUR: int = 60
    #: Per-agent hourly allowances. One shared bucket meant a user who ran
    #: sixty recaps could not then check an invoice, which is a denial of
    #: service the clinic inflicts on itself.
    AI_LIMIT_PATIENT_RECAP: int = 20
    AI_LIMIT_CLINICAL_DOCUMENTATION: int = 30
    AI_LIMIT_BILLING_ACCURACY: int = 30
    AI_LIMIT_FOLLOW_UP: int = 20
    AI_LIMIT_FINANCE_INSIGHTS: int = 20
    #: Off by default. Prompts and completions carry clinical context, so they
    #: are not written to the audit table unless someone deliberately turns it
    #: on to debug, and even then they are redacted first.
    AI_STORE_PAYLOADS: bool = False

    # --- OCR ------------------------------------------------------------------
    OCR_PROVIDER: str = ""
    OCR_API_KEY: str = ""
    OCR_ENDPOINT: str = ""

    # --- Messaging ------------------------------------------------------------
    # SMS and WhatsApp. Unset means drafts are prepared and queued but never
    # dispatched, which is the right default for a build with no provider.
    MESSAGING_PROVIDER: str = ""
    MESSAGING_API_KEY: str = ""
    MESSAGING_SENDER_ID: str = ""
    MESSAGING_ENDPOINT: str = ""

    # --- Platform shim --------------------------------------------------------
    # Windows only: PostgreSQL bin directory containing libpq.dll. Required by
    # the pure-Python psycopg driver (see requirements.txt). Ignored elsewhere.
    PGBIN: str = ""

    @field_validator("JWT_SECRET")
    @classmethod
    def _reject_placeholder_secret_in_production(cls, value: str, info) -> str:
        environment = (info.data or {}).get("ENVIRONMENT")
        if environment == "production" and value in {"change-me", "changeme", "secret"}:
            raise ValueError("JWT_SECRET must be set to a real secret outside development")
        return value

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"

    @property
    def clinic_tz(self) -> ZoneInfo:
        """The configured zone, resolved once and cached by pydantic's settings."""
        try:
            return ZoneInfo(self.CLINIC_TIMEZONE)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown CLINIC_TIMEZONE {self.CLINIC_TIMEZONE!r}") from exc

    @property
    def ai_enabled(self) -> bool:
        """Whether a live model can actually be called.

        A provider name without a key is not enabled: it would fail on the
        first request, and a feature that reports itself available and then
        errors is worse than one that says plainly it is off.
        """
        return bool(self.AI_PROVIDER and self.AI_API_KEY)

    @property
    def ocr_enabled(self) -> bool:
        return bool(self.OCR_PROVIDER and self.OCR_API_KEY and self.OCR_ENDPOINT)

    @property
    def messaging_enabled(self) -> bool:
        return bool(
            self.MESSAGING_PROVIDER and self.MESSAGING_API_KEY and self.MESSAGING_ENDPOINT
        )

    @property
    def demo_mode_enabled(self) -> bool:
        """Demo affordances are never available in production, whatever .env says."""
        return self.DEMO_MODE and self.ENVIRONMENT != "production"

    @property
    def database_url(self) -> str:
        """The DSN as a plain string for SQLAlchemy."""
        return str(self.DATABASE_URL)

    @property
    def cors_origins(self) -> list[str]:
        """Explicit origin allow-list — never ``*`` for the configured app."""
        origins = [self.FRONTEND_URL.rstrip("/")]
        origins.extend(
            origin.strip().rstrip("/")
            for origin in self.EXTRA_CORS_ORIGINS.split(",")
            if origin.strip()
        )
        # Vite prints 127.0.0.1 as an alternate host, so accept both spellings.
        if self.is_development:
            alternates = {
                origin.replace("localhost", "127.0.0.1")
                for origin in origins
                if "localhost" in origin
            }
            origins.extend(alternates)
        return sorted(set(origins))

    def safe_database_summary(self) -> str:
        """Host/database only — never the password. Used in logs."""
        dsn = self.DATABASE_URL
        return f"{dsn.hosts()[0].get('host')}:{dsn.hosts()[0].get('port')}{dsn.path or ''}"


@lru_cache
def get_settings() -> Settings:
    """Cached accessor so the environment is parsed exactly once."""
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
