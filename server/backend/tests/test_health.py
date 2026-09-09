"""Foundation tests: the app boots, routes answer, and health tells the truth."""

from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient


class TestRoot:
    def test_root_returns_service_banner(self, client: TestClient) -> None:
        response = client.get("/")
        assert response.status_code == 200

        body = response.json()
        assert body["name"] == "Rehabilitation Centre HMS API"
        assert body["status"] == "running"
        assert body["version"]
        assert body["docs"] == "/docs"


class TestHealth:
    def test_health_is_reachable(self, client: TestClient) -> None:
        response = client.get("/api/health")
        assert response.status_code in (200, 503)
        assert set(response.json()) >= {"status", "database", "environment", "version"}

    def test_health_reports_connected_when_database_is_up(
        self, client: TestClient, requires_database: None
    ) -> None:
        """Integration: requires a real PostgreSQL, skipped otherwise."""
        response = client.get("/api/health")
        assert response.status_code == 200

        body = response.json()
        assert body["status"] == "healthy"
        assert body["database"] == "connected"

    def test_health_reports_503_when_database_is_down(self, client: TestClient) -> None:
        """A failing database must never be reported as healthy."""
        with patch(
            "app.api.health.check_database_connection",
            return_value=(False, "connection refused"),
        ):
            response = client.get("/api/health")

        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "unhealthy"
        assert body["database"] == "disconnected"

    def test_health_never_leaks_connection_detail(self, client: TestClient) -> None:
        """The DSN/password must not appear in the response body."""
        secret_error = "could not connect to postgresql://postgres:postgres@localhost:5432"
        with patch(
            "app.api.health.check_database_connection",
            return_value=(False, secret_error),
        ):
            response = client.get("/api/health")

        raw = response.text.lower()
        assert "password" not in raw
        assert "postgres:postgres" not in raw
        assert "5432" not in raw


class TestDocs:
    def test_openapi_schema_is_served(self, client: TestClient) -> None:
        response = client.get("/openapi.json")
        assert response.status_code == 200

        schema = response.json()
        assert schema["info"]["title"] == "Rehabilitation Centre HMS API"
        assert "/api/health" in schema["paths"]

    def test_swagger_ui_loads(self, client: TestClient) -> None:
        response = client.get("/docs")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]


class TestCors:
    def test_frontend_origin_is_allowed(self, client: TestClient) -> None:
        response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"

    def test_unknown_origin_is_not_allowed(self, client: TestClient) -> None:
        response = client.get("/api/health", headers={"Origin": "http://evil.example.com"})
        assert response.headers.get("access-control-allow-origin") != "http://evil.example.com"

    def test_wildcard_origin_is_never_configured(self) -> None:
        from app.core.config import settings

        assert "*" not in settings.cors_origins


class TestErrorHandling:
    def test_unknown_route_returns_consistent_envelope(self, client: TestClient) -> None:
        response = client.get("/api/does-not-exist")
        assert response.status_code == 404

        body = response.json()
        assert "detail" in body
        assert "code" in body
