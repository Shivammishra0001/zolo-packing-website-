# syntax=docker/dockerfile:1

# Python 3.12 is used deliberately: psycopg[binary] publishes wheels for it, so
# the container needs no libpq on the system and no compiler.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# curl is only needed for the container HEALTHCHECK below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first so the layer caches across source edits.
COPY requirements.txt .
RUN pip install -r requirements.txt \
 && pip install "psycopg[binary]==3.3.4"

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# Run as an unprivileged user.
RUN useradd --create-home --uid 10001 appuser \
 && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
