"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.api import health
from app.api.router import api_router
from app.core.config import settings
from app.core.database import wait_for_database
from app.core.errors import register_exception_handlers
from app.core.logging_config import configure_logging

configure_logging()
logger = logging.getLogger("app")

OPENAPI_TAGS = [
    {"name": "Health", "description": "Service and dependency status."},
    {
        "name": "Authentication",
        "description": (
            "Sign-in, session inspection and sign-out. All other endpoints "
            "expect `Authorization: Bearer <access_token>`."
        ),
    },
    {
        "name": "Patients",
        "description": (
            "The central clinical record: list, search, register, update and "
            "the Patient 360 aggregate."
        ),
    },
    {
        "name": "Appointments",
        "description": (
            "Booking, the reception queue and the check-in / start / complete "
            "workflow. Status changes go through the workflow endpoints, which "
            "enforce a backend state machine; there is no hard delete."
        ),
    },
    {
        "name": "Consultations",
        "description": (
            "Doctor encounters: chief complaint, examination, diagnosis, care "
            "plan and follow-up date. Patient medical history and vitals hang "
            "off the patient routes."
        ),
    },
    {
        "name": "Labs",
        "description": (
            "Released reports and clinical sign-off. Read and review only — "
            "there is no lab-entry screen, so no creation endpoint."
        ),
    },
    {
        "name": "Prescriptions",
        "description": (
            "Writing and reading prescriptions. Dispensing, stock and "
            "substitution belong to the pharmacy module and are not here."
        ),
    },
    {
        "name": "Rehabilitation",
        "description": (
            "Rehabilitation plans, milestones, weekly progress and the "
            "therapist's caseload. Everything the UI shows as progress is "
            "derived from therapy sessions, never accepted from a request."
        ),
    },
    {
        "name": "Therapy",
        "description": (
            "Therapy sessions: logging, the delivery workflow, and the "
            "exercises performed. Completing a session moves its plan's "
            "progress in the same transaction."
        ),
    },
    {
        "name": "Exercise Library",
        "description": (
            "Shared clinical configuration. Every therapist reads it; editing "
            "needs `settings.manage`, so protocol lists cannot drift per person."
        ),
    },
    {
        "name": "Pharmacy",
        "description": (
            "Medicine catalogue, batch stock, inventory alerts and prescription "
            "dispensing. Stock lives on batches, is issued first-expiry-first-out, "
            "and is read `FOR UPDATE` before every deduction so it can never go "
            "negative."
        ),
    },
    {
        "name": "Pharmacy POS",
        "description": (
            "Over-the-counter sales. The till computes every figure in NUMERIC "
            "from the batch being drawn — no money is accepted from the request."
        ),
    },
    # Populated as each domain module lands:
    # Users,
    # Rehabilitation, Therapy, Nursing, Wards & Beds, Pharmacy, Billing,
    # Labs, Dashboard, Reports, Notifications, Audit
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Startup and shutdown logging plus a database readiness probe."""
    logger.info(
        "Starting %s v%s (environment=%s)",
        settings.PROJECT_NAME,
        settings.VERSION,
        settings.ENVIRONMENT,
    )
    logger.info("Database target: %s", settings.safe_database_summary())

    if wait_for_database():
        logger.info("Database connection established")
    else:
        # Deliberately non-fatal: the API still serves and /api/health reports
        # 503, which is more useful than a container that will not boot.
        logger.error(
            "Database unreachable after %s attempt(s). "
            "The API will start, but /api/health will report unhealthy.",
            settings.DB_CONNECT_RETRIES,
        )

    logger.info("CORS origins allowed: %s", ", ".join(settings.cors_origins))
    yield
    logger.info("Shutting down %s", settings.PROJECT_NAME)


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=(
        "Backend for the Arogya Rehabilitation Centre HMS.\n\n"
        "Foundation only — domain modules are added incrementally."
    ),
    openapi_tags=OPENAPI_TAGS,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# Explicit allow-list, never "*", so the browser only trusts the known frontend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
    expose_headers=["X-Total-Count"],
    max_age=600,
)

register_exception_handlers(app)
app.include_router(api_router, prefix=settings.API_PREFIX)
# Health probes live at the root as well: an orchestrator's liveness check
# should not have to know the API prefix.
app.include_router(health.root)


class RootResponse(BaseModel):
    name: str = Field(..., examples=["Rehabilitation Centre HMS API"])
    version: str = Field(..., examples=["1.0.0"])
    status: str = Field(..., examples=["running"])
    docs: str = Field(..., examples=["/docs"])


@app.get("/", response_model=RootResponse, tags=["Health"], summary="Service banner")
def root() -> RootResponse:
    return RootResponse(
        name=settings.PROJECT_NAME,
        version=settings.VERSION,
        status="running",
        docs="/docs",
    )
