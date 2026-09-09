"""Authentication, JWT and RBAC tests.

Runs against real PostgreSQL with the seeded demo accounts. Seed first:

    python seed.py
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.dependencies import (
    CurrentUser,
    get_current_user,
    require_permission,
    require_role,
)
from app.core.enums import UserRole, UserStatus
from app.core.errors import register_exception_handlers
from app.core.security import (
    TokenError,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.models import Permission, RolePermission, User

DEMO_PASSWORD = "Rehab@123"
LOGIN = "/api/auth/login"
ME = "/api/auth/me"
LOGOUT = "/api/auth/logout"


def _login(client: TestClient, email: str, password: str = DEMO_PASSWORD):
    return client.post(LOGIN, json={"email": email, "password": password, "remember": True})


def _token(client: TestClient, email: str) -> str:
    response = _login(client, email)
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def seeded(request) -> None:
    """Skip the module unless the demo accounts have been seeded."""
    from app.core.database import SessionLocal, check_database_connection

    ok, _ = check_database_connection()
    if not ok:
        pytest.skip("PostgreSQL is not reachable")

    with SessionLocal() as db:
        exists = db.execute(select(User).where(User.email == "doctor@rehab.com")).scalar_one_or_none()
    if exists is None:
        pytest.skip("Demo users not seeded — run `python seed.py` first")


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


class TestPasswordHashing:
    def test_hash_is_not_the_plaintext(self) -> None:
        digest = hash_password("correct horse battery staple")
        assert digest != "correct horse battery staple"
        assert digest.startswith("$argon2")

    def test_verify_accepts_the_right_password(self) -> None:
        assert verify_password("s3cret!", hash_password("s3cret!")) is True

    def test_verify_rejects_the_wrong_password(self) -> None:
        assert verify_password("wrong", hash_password("s3cret!")) is False

    def test_hashes_are_salted(self) -> None:
        """Two hashes of the same password must differ."""
        assert hash_password("same") != hash_password("same")

    def test_malformed_hash_returns_false_rather_than_raising(self) -> None:
        assert verify_password("anything", "not-a-hash") is False

    def test_empty_inputs_are_rejected(self) -> None:
        assert verify_password("", hash_password("x")) is False
        with pytest.raises(ValueError):
            hash_password("")


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------


class TestTokens:
    def test_valid_token_round_trips(self) -> None:
        token, expires_at = create_access_token(subject="abc-123", role="doctor")
        claims = decode_access_token(token)
        assert claims["sub"] == "abc-123"
        assert claims["role"] == "doctor"
        assert claims["type"] == "access"
        assert claims["exp"] == int(expires_at.timestamp())

    def test_expired_token_is_rejected(self) -> None:
        token, _ = create_access_token(
            subject="abc-123", role="doctor", expires_delta=timedelta(seconds=-1)
        )
        with pytest.raises(TokenError) as exc:
            decode_access_token(token)
        assert exc.value.expired is True

    def test_invalid_token_is_rejected(self) -> None:
        with pytest.raises(TokenError):
            decode_access_token("not.a.jwt")

    def test_token_signed_with_another_secret_is_rejected(self) -> None:
        import jwt as pyjwt

        forged = pyjwt.encode(
            {"sub": "abc", "role": "owner", "type": "access", "exp": 9999999999},
            "attacker-secret",
            algorithm="HS256",
        )
        with pytest.raises(TokenError):
            decode_access_token(forged)

    def test_token_carries_no_permission_matrix(self) -> None:
        """Permissions must be resolved server-side, not trusted from the token."""
        token, _ = create_access_token(subject="abc", role="owner")
        claims = decode_access_token(token)
        assert "permissions" not in claims
        assert set(claims) == {"sub", "role", "type", "iat", "nbf", "exp", "jti"}

    def test_non_access_token_type_is_rejected(self) -> None:
        token, _ = create_access_token(
            subject="abc", role="doctor", extra_claims={"type": "refresh"}
        )
        with pytest.raises(TokenError):
            decode_access_token(token)


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


class TestLogin:
    def test_valid_login(self, client: TestClient, seeded: None) -> None:
        response = _login(client, "doctor@rehab.com")
        assert response.status_code == 200

        body = response.json()
        assert body["token_type"] == "bearer"
        assert body["access_token"]
        assert body["expires_in"] > 0

        user = body["user"]
        assert user["email"] == "doctor@rehab.com"
        assert user["role"] == "doctor"
        assert user["name"] == "Dr. Arjun Sharma"
        assert user["initials"] == "AS"
        assert user["avatarColor"]
        assert user["status"] == "active"
        assert len(body["permissions"]) == 13

    def test_invalid_password(self, client: TestClient, seeded: None) -> None:
        response = _login(client, "doctor@rehab.com", "definitely-wrong")
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid email or password."

    def test_unknown_user(self, client: TestClient, seeded: None) -> None:
        response = _login(client, "nobody@rehab.com", "whatever")
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid email or password."

    def test_unknown_user_is_indistinguishable_from_wrong_password(
        self, client: TestClient, seeded: None
    ) -> None:
        """The API must not reveal which email addresses exist."""
        unknown = _login(client, "nobody@rehab.com", "whatever")
        wrong = _login(client, "doctor@rehab.com", "whatever")
        assert unknown.status_code == wrong.status_code
        assert unknown.json() == wrong.json()

    def test_suspended_user(self, client: TestClient, seeded: None) -> None:
        response = _login(client, "aakash.verma@rehab.com")
        assert response.status_code == 403
        assert "suspended" in response.json()["detail"].lower()

    def test_pending_user(self, client: TestClient, seeded: None) -> None:
        response = _login(client, "imran.qureshi@rehab.com")
        assert response.status_code == 403
        assert "approval" in response.json()["detail"].lower()

    def test_email_is_case_insensitive(self, client: TestClient, seeded: None) -> None:
        assert _login(client, "DOCTOR@Rehab.COM").status_code == 200

    def test_response_never_contains_the_password_or_hash(
        self, client: TestClient, seeded: None
    ) -> None:
        raw = _login(client, "doctor@rehab.com").text
        assert DEMO_PASSWORD not in raw
        assert "password_hash" not in raw
        assert "argon2" not in raw

    def test_all_eight_demo_roles_can_sign_in(self, client: TestClient, seeded: None) -> None:
        accounts = {
            "owner@rehab.com": ("owner", 10),
            "admin@rehab.com": ("admin", 20),
            "doctor@rehab.com": ("doctor", 13),
            "therapist@rehab.com": ("therapist", 8),
            "nurse@rehab.com": ("nurse", 8),
            "pharmacy@rehab.com": ("pharmacist", 5),
            "reception@rehab.com": ("receptionist", 9),
            "accounts@rehab.com": ("accountant", 7),
        }
        for email, (role, permission_count) in accounts.items():
            body = _login(client, email).json()
            assert body["user"]["role"] == role, email
            assert len(body["permissions"]) == permission_count, email

    def test_roles_are_lowercase_for_the_frontend(self, client: TestClient, seeded: None) -> None:
        role = _login(client, "therapist@rehab.com").json()["user"]["role"]
        assert role == "therapist"
        assert role.islower()


# ---------------------------------------------------------------------------
# Current user
# ---------------------------------------------------------------------------


class TestCurrentUser:
    def test_get_current_user(self, client: TestClient, seeded: None) -> None:
        token = _token(client, "therapist@rehab.com")
        response = client.get(ME, headers=_auth(token))
        assert response.status_code == 200

        body = response.json()
        assert body["user"]["email"] == "therapist@rehab.com"
        assert body["user"]["role"] == "therapist"
        assert "therapy.session.manage" in body["permissions"]

    def test_missing_token(self, client: TestClient) -> None:
        assert client.get(ME).status_code == 401

    def test_invalid_token(self, client: TestClient) -> None:
        assert client.get(ME, headers=_auth("not.a.jwt")).status_code == 401

    def test_expired_token(self, client: TestClient, seeded: None) -> None:
        from app.core.database import SessionLocal

        with SessionLocal() as db:
            user = db.execute(
                select(User).where(User.email == "doctor@rehab.com")
            ).scalar_one()
            token, _ = create_access_token(
                subject=user.id, role=user.role.value, expires_delta=timedelta(seconds=-1)
            )

        response = client.get(ME, headers=_auth(token))
        assert response.status_code == 401
        assert response.json()["code"] == "token_expired"

    def test_token_for_a_deleted_user(self, client: TestClient, seeded: None) -> None:
        import uuid

        token, _ = create_access_token(subject=uuid.uuid4(), role="doctor")
        assert client.get(ME, headers=_auth(token)).status_code == 401

    def test_role_in_token_is_not_trusted(self, client: TestClient, seeded: None) -> None:
        """A forged role claim must not escalate privileges."""
        from app.core.database import SessionLocal

        with SessionLocal() as db:
            therapist = db.execute(
                select(User).where(User.email == "therapist@rehab.com")
            ).scalar_one()

        # Same real user, but the token claims they are an owner.
        token, _ = create_access_token(subject=therapist.id, role="owner")
        body = client.get(ME, headers=_auth(token)).json()

        assert body["user"]["role"] == "therapist"
        assert len(body["permissions"]) == 8
        assert "analytics.business" not in body["permissions"]

    def test_suspending_a_user_invalidates_their_live_session(
        self, client: TestClient, seeded: None
    ) -> None:
        """An existing token stops working the moment the account is suspended."""
        from app.core.database import SessionLocal

        token = _token(client, "nurse@rehab.com")
        assert client.get(ME, headers=_auth(token)).status_code == 200

        with SessionLocal() as db:
            user = db.execute(select(User).where(User.email == "nurse@rehab.com")).scalar_one()
            user.status = UserStatus.SUSPENDED
            db.commit()
        try:
            response = client.get(ME, headers=_auth(token))
            assert response.status_code == 403
        finally:
            with SessionLocal() as db:
                user = db.execute(select(User).where(User.email == "nurse@rehab.com")).scalar_one()
                user.status = UserStatus.ACTIVE
                db.commit()


class TestLogout:
    def test_logout_requires_authentication(self, client: TestClient) -> None:
        assert client.post(LOGOUT).status_code == 401

    def test_logout_succeeds(self, client: TestClient, seeded: None) -> None:
        token = _token(client, "doctor@rehab.com")
        response = client.post(LOGOUT, headers=_auth(token))
        assert response.status_code == 200
        assert response.json()["detail"] == "Signed out."

    def test_token_remains_valid_after_logout(self, client: TestClient, seeded: None) -> None:
        """Documented limitation: JWTs are stateless, so there is no revocation.

        The client discards the token; a captured copy stays valid until expiry.
        This test pins the current behaviour so the day a denylist is added, it
        fails loudly and gets updated deliberately.
        """
        token = _token(client, "doctor@rehab.com")
        client.post(LOGOUT, headers=_auth(token))
        assert client.get(ME, headers=_auth(token)).status_code == 200


# ---------------------------------------------------------------------------
# RBAC — guards mounted on a throwaway app, since no domain routes exist yet
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def guarded_client() -> TestClient:
    """An app exposing routes protected by each guard, for testing them."""
    from app.api.router import api_router

    guarded = FastAPI()
    register_exception_handlers(guarded)
    guarded.include_router(api_router, prefix="/api")

    @guarded.get("/probe/any-authenticated")
    def any_authenticated(user: CurrentUser):
        return {"role": user.role.value}

    @guarded.get("/probe/accountant-only")
    def accountant_only(user=Depends(require_role(UserRole.ACCOUNTANT))):
        return {"role": user.role.value}

    @guarded.get("/probe/clinical-roles")
    def clinical_roles(user=Depends(require_role("doctor", "therapist", "nurse"))):
        return {"role": user.role.value}

    @guarded.get("/probe/needs-expenses")
    def needs_expenses(user=Depends(require_permission("expenses.manage"))):
        return {"ok": True}

    @guarded.get("/probe/needs-therapy")
    def needs_therapy(user=Depends(require_permission("therapy.session.manage"))):
        return {"ok": True}

    @guarded.get("/probe/needs-two")
    def needs_two(user=Depends(require_permission("patient.view", "billing.view"))):
        return {"ok": True}

    @guarded.get("/probe/needs-any")
    def needs_any(
        user=Depends(require_permission("expenses.manage", "patient.view", require_all=False))
    ):
        return {"ok": True}

    with TestClient(guarded) as test_client:
        yield test_client


class TestRoleGuards:
    def test_allowed_role(self, guarded_client: TestClient, seeded: None) -> None:
        token = _token(guarded_client, "accounts@rehab.com")
        response = guarded_client.get("/probe/accountant-only", headers=_auth(token))
        assert response.status_code == 200
        assert response.json()["role"] == "accountant"

    def test_forbidden_role(self, guarded_client: TestClient, seeded: None) -> None:
        """Acceptance Test 4: therapist hitting an accountant-only route."""
        token = _token(guarded_client, "therapist@rehab.com")
        response = guarded_client.get("/probe/accountant-only", headers=_auth(token))
        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_multi_role_guard_accepts_any_listed_role(
        self, guarded_client: TestClient, seeded: None
    ) -> None:
        for email in ("doctor@rehab.com", "therapist@rehab.com", "nurse@rehab.com"):
            token = _token(guarded_client, email)
            assert guarded_client.get("/probe/clinical-roles", headers=_auth(token)).status_code == 200

    def test_multi_role_guard_rejects_others(self, guarded_client: TestClient, seeded: None) -> None:
        token = _token(guarded_client, "pharmacy@rehab.com")
        assert guarded_client.get("/probe/clinical-roles", headers=_auth(token)).status_code == 403

    def test_guarded_route_requires_authentication(self, guarded_client: TestClient) -> None:
        assert guarded_client.get("/probe/accountant-only").status_code == 401


class TestPermissionGuards:
    def test_user_with_permission(self, guarded_client: TestClient, seeded: None) -> None:
        token = _token(guarded_client, "accounts@rehab.com")
        assert guarded_client.get("/probe/needs-expenses", headers=_auth(token)).status_code == 200

    def test_user_without_permission(self, guarded_client: TestClient, seeded: None) -> None:
        token = _token(guarded_client, "therapist@rehab.com")
        response = guarded_client.get("/probe/needs-expenses", headers=_auth(token))
        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_permission"

    def test_error_does_not_disclose_which_permission_is_missing(
        self, guarded_client: TestClient, seeded: None
    ) -> None:
        token = _token(guarded_client, "therapist@rehab.com")
        body = guarded_client.get("/probe/needs-expenses", headers=_auth(token)).text
        assert "expenses.manage" not in body

    def test_require_all_permissions(self, guarded_client: TestClient, seeded: None) -> None:
        # Receptionist has both patient.view and billing.view.
        allowed = _token(guarded_client, "reception@rehab.com")
        assert guarded_client.get("/probe/needs-two", headers=_auth(allowed)).status_code == 200

        # Therapist has patient.view but not billing.view.
        denied = _token(guarded_client, "therapist@rehab.com")
        assert guarded_client.get("/probe/needs-two", headers=_auth(denied)).status_code == 403

    def test_require_any_permission(self, guarded_client: TestClient, seeded: None) -> None:
        token = _token(guarded_client, "therapist@rehab.com")
        # Lacks expenses.manage but has patient.view, which is enough here.
        assert guarded_client.get("/probe/needs-any", headers=_auth(token)).status_code == 200


class TestPermissionsComeFromTheDatabase:
    def test_editing_the_matrix_changes_permissions_immediately(
        self, guarded_client: TestClient, seeded: None
    ) -> None:
        """Acceptance Test 6: proves permissions are not hardcoded anywhere."""
        from app.core.database import SessionLocal

        token = _token(guarded_client, "therapist@rehab.com")
        assert guarded_client.get("/probe/needs-expenses", headers=_auth(token)).status_code == 403

        with SessionLocal() as db:
            permission = db.execute(
                select(Permission).where(Permission.key == "expenses.manage")
            ).scalar_one()
            db.add(RolePermission(role=UserRole.THERAPIST, permission_id=permission.id))
            db.commit()
        try:
            # Same token, no re-login.
            assert (
                guarded_client.get("/probe/needs-expenses", headers=_auth(token)).status_code == 200
            )
            body = guarded_client.get(ME, headers=_auth(token)).json()
            assert "expenses.manage" in body["permissions"]
            assert len(body["permissions"]) == 9
        finally:
            with SessionLocal() as db:
                db.query(RolePermission).filter(
                    RolePermission.role == UserRole.THERAPIST,
                    RolePermission.permission_id == permission.id,
                ).delete()
                db.commit()

        assert guarded_client.get("/probe/needs-expenses", headers=_auth(token)).status_code == 403


class TestSwaggerDocumentsAuth:
    def test_auth_endpoints_are_published(self, client: TestClient) -> None:
        schema = client.get("/openapi.json").json()
        assert "/api/auth/login" in schema["paths"]
        assert "/api/auth/me" in schema["paths"]
        assert "/api/auth/logout" in schema["paths"]

    def test_protected_endpoints_declare_bearer_auth(self, client: TestClient) -> None:
        schema = client.get("/openapi.json").json()
        assert "HTTPBearer" in schema["components"]["securitySchemes"]
        assert schema["paths"]["/api/auth/me"]["get"].get("security")

    def test_login_is_not_marked_as_requiring_auth(self, client: TestClient) -> None:
        schema = client.get("/openapi.json").json()
        assert not schema["paths"]["/api/auth/login"]["post"].get("security")
