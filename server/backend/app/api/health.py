"""Health and readiness endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.database import check_database_connection

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    """Result of a live dependency check."""

    status: str = Field(..., examples=["healthy"])
    database: str = Field(..., examples=["connected"])
    environment: str = Field(..., examples=["development"])
    version: str = Field(..., examples=["1.0.0"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Service health",
    description=(
        "Runs a real `SELECT 1` against PostgreSQL. Returns **200** when the "
        "database answers and **503** when it does not — the response never "
        "reports `connected` without a successful round trip."
    ),
    responses={503: {"model": HealthResponse, "description": "A dependency is unavailable"}},
)
def health(response: Response) -> HealthResponse:
    connected, error = check_database_connection()

    if not connected:
        # Detail goes to the log; the client only learns that it is disconnected.
        logger.error("Health check failed — database unreachable: %s", error)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthResponse(
            status="unhealthy",
            database="disconnected",
            environment=settings.ENVIRONMENT,
            version=settings.VERSION,
        )

    return HealthResponse(
        status="healthy",
        database="connected",
        environment=settings.ENVIRONMENT,
        version=settings.VERSION,
    )


class LivenessResponse(BaseModel):
    """Whether the process is up. Says nothing about its dependencies."""

    status: str = Field(..., examples=["ok"])


#: Mounted at the application root rather than under `/api`, because a load
#: balancer's health probe should not depend on the API prefix — and because a
#: liveness check that fails when the database is down would take a healthy
#: process out of rotation for a fault it could recover from.
root = APIRouter(tags=["Health"])


@root.get(
    "/health",
    response_model=LivenessResponse,
    summary="Liveness",
    description=(
        "Is the process up. Deliberately does **not** touch the database: a "
        "liveness probe that fails on a transient database fault would remove a "
        "process that is perfectly capable of serving once the database "
        "returns.\n\n"
        "Use `/health/db` or `/api/health` for readiness."
    ),
)
def liveness() -> LivenessResponse:
    return LivenessResponse(status="ok")


@root.get(
    "/health/db",
    response_model=HealthResponse,
    summary="Database readiness",
    description=(
        "Runs a real `SELECT 1`. **503** when PostgreSQL does not answer.\n\n"
        "Reports connected or disconnected and nothing else — no host, no "
        "database name, no credentials. The reason for a failure goes to the "
        "server log, where it belongs."
    ),
    responses={503: {"model": HealthResponse, "description": "PostgreSQL is unreachable"}},
)
def database_health(response: Response) -> HealthResponse:
    return health(response)
