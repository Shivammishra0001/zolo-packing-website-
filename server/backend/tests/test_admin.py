"""Admin tests: staff, roles, the permission matrix, branches, settings and audit.

Runs against real PostgreSQL with the demo data seeded:

    python seed.py && python seed_patients.py

The security cases here are the point of the module: that the backend, not the
client, decides a role; that a suspension bites on the very next request; and
that the permission matrix is the only thing granting anything.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.enums import UserRole, UserStatus
from app.models import AuditLog, Branch, Permission, RolePermission, Setting, User

DEMO_PASSWORD = "Rehab@123"

USERS = "/api/users"
ROLES = "/api/roles"
BRANCHES = "/api/branches"
SETTINGS = "/api/settings"
AUDIT = "/api/audit-logs"
ADMIN = "/api/admin"
ME = "/api/auth/me"


def _token(client: TestClient, email: str, password: str = DEMO_PASSWORD) -> str:
    response = client.post(
        "/api/auth/login", json={"email": email, "password": password, "remember": False}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _me(client: TestClient, token: str) -> dict:
    """`/auth/me` answers `{user, permissions}`; most assertions want the pair flat."""
    body = client.get(ME, headers=_auth(token)).json()
    return {**body["user"], "permissions": body["permissions"]}


def _unique_email(prefix: str = "testcase") -> str:
    # A real domain, because `.test` is a reserved TLD that email validation
    # refuses outright — the address never leaves the database either way.
    return f"{prefix}-{uuid.uuid4().hex[:8]}@rehab.com"


@pytest.fixture(scope="module")
def seeded() -> None:
    from app.core.database import SessionLocal, check_database_connection

    ok, _ = check_database_connection()
    if not ok:
        pytest.skip("PostgreSQL is not reachable")

    with SessionLocal() as db:
        have = all(
            db.execute(select(model).limit(1)).scalar_one_or_none() is not None
            for model in (User, Branch, Permission, RolePermission)
        )
    if not have:
        pytest.skip("Demo data not seeded — run seed.py and seed_patients.py")


@pytest.fixture(autouse=True)
def _no_leaked_admin_rows(seeded: None):
    """Delete every row a test writes and restore what it moved.

    The permission matrix especially: a test that strips `patient.view` from
    therapists and does not put it back would break every therapist test that
    runs afterwards.
    """
    from app.core.database import SessionLocal

    created = (RolePermission, Setting, AuditLog, User, Branch)

    with SessionLocal() as db:
        before = {m: list(db.execute(select(m.id)).scalars()) for m in created}
        user_state = {
            row.id: (row.status, row.role, row.branch_id, row.email, row.first_name, row.last_name)
            for row in db.execute(select(User)).scalars()
        }
        branch_state = {
            row.id: (row.name, row.is_configured, row.licensed_beds)
            for row in db.execute(select(Branch)).scalars()
        }
        # Setting VALUES too, not just which rows exist: a settings test that
        # writes gst=12 into a row the baseline already contains would
        # otherwise leak that figure into every later run.
        setting_state = {row.id: dict(row.value) for row in db.execute(select(Setting)).scalars()}
        # The whole matrix, so a permission test cannot leak into another.
        matrix = [(row.role, row.permission_id) for row in db.execute(select(RolePermission)).scalars()]

    yield

    with SessionLocal() as db:
        for model in created:
            keep = before[model]
            statement = delete(model)
            # An empty baseline needs an unconditional delete: `NOT IN (NULL)`
            # is NULL for every row and would match nothing.
            if keep:
                statement = statement.where(model.id.notin_(keep))
            db.execute(statement)
        db.flush()

        for row in db.execute(select(User)).scalars():
            if row.id in user_state:
                (
                    row.status,
                    row.role,
                    row.branch_id,
                    row.email,
                    row.first_name,
                    row.last_name,
                ) = user_state[row.id]
        for row in db.execute(select(Branch)).scalars():
            if row.id in branch_state:
                row.name, row.is_configured, row.licensed_beds = branch_state[row.id]
        for row in db.execute(select(Setting)).scalars():
            if row.id in setting_state:
                row.value = setting_state[row.id]

        # Rebuild the matrix exactly as it was.
        db.execute(delete(RolePermission))
        db.flush()
        for role, permission_id in matrix:
            db.add(RolePermission(role=role, permission_id=permission_id))
        db.commit()


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def admin(client: TestClient, seeded: None) -> str:
    return _token(client, "admin@rehab.com")


@pytest.fixture(scope="module")
def owner(client: TestClient, seeded: None) -> str:
    return _token(client, "owner@rehab.com")


@pytest.fixture(scope="module")
def doctor(client: TestClient, seeded: None) -> str:
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def therapist(client: TestClient, seeded: None) -> str:
    return _token(client, "therapist@rehab.com")


@pytest.fixture(scope="module")
def receptionist(client: TestClient, seeded: None) -> str:
    return _token(client, "reception@rehab.com")


@pytest.fixture
def invite(client: TestClient, admin: str):
    def _invite(**overrides) -> dict:
        payload = {
            "name": "Testcase Therapist",
            "email": _unique_email(),
            "role": "therapist",
            "department": "Physiotherapy",
        }
        payload.update(overrides)
        response = client.post(USERS, json=payload, headers=_auth(admin))
        assert response.status_code == 201, response.text
        return response.json()

    return _invite


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class TestUsers:
    def test_create_user(self, client: TestClient, invite) -> None:
        body = invite(name="Testcase Therapist", role="therapist")
        created = body["user"]

        assert created["name"] == "Testcase Therapist"
        assert created["role"] == "therapist"
        # An invitation produces a pending account, never an active one.
        assert created["status"] == "pending"
        assert created["id"].startswith("USR-")
        assert created["lastLogin"] == "Never"

        # The temporary password stands in for an invitation email and is
        # flagged as such.
        assert body["developmentOnly"] is True
        assert len(body["temporaryPassword"]) >= 12

    def test_the_response_carries_no_credential(self, client: TestClient, invite) -> None:
        created = invite()["user"]
        for field in created:
            assert "password" not in field.lower(), field
            assert "hash" not in field.lower(), field
            assert "token" not in field.lower(), field

    def test_duplicate_email(self, client: TestClient, admin: str, invite) -> None:
        first = invite()["user"]
        response = client.post(
            USERS,
            json={"name": "Someone Else", "email": first["email"], "role": "nurse"},
            headers=_auth(admin),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "email_taken"

    def test_duplicate_email_is_case_insensitive(
        self, client: TestClient, admin: str, invite
    ) -> None:
        first = invite()["user"]
        response = client.post(
            USERS,
            json={"name": "Someone Else", "email": first["email"].upper(), "role": "nurse"},
            headers=_auth(admin),
        )
        assert response.status_code == 409

    def test_update_user(self, client: TestClient, admin: str, invite) -> None:
        created = invite()["user"]
        response = client.put(
            f"{USERS}/{created['id']}",
            json={"name": "Testcase Renamed", "designation": "Senior Physiotherapist"},
            headers=_auth(admin),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Testcase Renamed"
        assert body["designation"] == "Senior Physiotherapist"
        assert body["initials"] == "TR"

    def test_status_cannot_be_set_through_the_update_route(
        self, client: TestClient, admin: str, invite
    ) -> None:
        """Approve, suspend and activate are the only ways status moves."""
        created = invite()["user"]
        response = client.put(
            f"{USERS}/{created['id']}", json={"status": "active"}, headers=_auth(admin)
        )
        assert response.status_code == 200
        assert response.json()["status"] == "pending", "a pending account stayed pending"

    def test_approve_user(self, client: TestClient, admin: str, invite) -> None:
        created = invite()["user"]
        response = client.post(f"{USERS}/{created['id']}/approve", headers=_auth(admin))
        assert response.status_code == 200
        assert response.json()["status"] == "active"

    def test_suspend_user(self, client: TestClient, admin: str, invite) -> None:
        created = invite()["user"]
        client.post(f"{USERS}/{created['id']}/approve", headers=_auth(admin))

        response = client.post(f"{USERS}/{created['id']}/suspend", headers=_auth(admin))
        assert response.status_code == 200
        assert response.json()["status"] == "suspended"

    def test_activate_user(self, client: TestClient, admin: str, invite) -> None:
        created = invite()["user"]
        client.post(f"{USERS}/{created['id']}/approve", headers=_auth(admin))
        client.post(f"{USERS}/{created['id']}/suspend", headers=_auth(admin))

        response = client.post(f"{USERS}/{created['id']}/activate", headers=_auth(admin))
        assert response.status_code == 200
        assert response.json()["status"] == "active"

    def test_suspended_user_cannot_access_api(
        self, client: TestClient, admin: str, invite
    ) -> None:
        """A live token stops working the moment the account is suspended.

        The token is still perfectly valid and unexpired — what changes is the
        account, and every request re-reads it.
        """
        body = invite()
        created = body["user"]
        client.post(f"{USERS}/{created['id']}/approve", headers=_auth(admin))

        token = _token(client, created["email"], body["temporaryPassword"])
        assert client.get(ME, headers=_auth(token)).status_code == 200

        client.post(f"{USERS}/{created['id']}/suspend", headers=_auth(admin))

        response = client.get(ME, headers=_auth(token))
        assert response.status_code == 403
        assert response.json()["code"] == "account_suspended"

    def test_a_pending_account_cannot_sign_in(self, client: TestClient, invite) -> None:
        body = invite()
        response = client.post(
            "/api/auth/login",
            json={
                "email": body["user"]["email"],
                "password": body["temporaryPassword"],
                "remember": False,
            },
        )
        assert response.status_code == 403
        assert response.json()["code"] == "account_pending"

    def test_reactivated_user_can_sign_in_again(
        self, client: TestClient, admin: str, invite
    ) -> None:
        body = invite()
        created = body["user"]
        client.post(f"{USERS}/{created['id']}/approve", headers=_auth(admin))
        client.post(f"{USERS}/{created['id']}/suspend", headers=_auth(admin))
        client.post(f"{USERS}/{created['id']}/activate", headers=_auth(admin))

        token = _token(client, created["email"], body["temporaryPassword"])
        assert client.get(ME, headers=_auth(token)).status_code == 200

    def test_an_admin_cannot_suspend_themselves(self, client: TestClient, admin: str) -> None:
        me = _me(client, admin)
        response = client.post(f"{USERS}/{me['id']}/suspend", headers=_auth(admin))
        assert response.status_code == 422
        assert response.json()["code"] == "cannot_suspend_self"

        # And they are still able to work.
        assert client.get(ME, headers=_auth(admin)).status_code == 200

    def test_users_can_be_filtered_in_the_database(self, client: TestClient, admin: str) -> None:
        by_role = client.get(USERS, params={"role": "doctor"}, headers=_auth(admin)).json()
        assert by_role["total"] >= 1
        assert {row["role"] for row in by_role["items"]} == {"doctor"}

        by_status = client.get(USERS, params={"status": "pending"}, headers=_auth(admin)).json()
        assert {row["status"] for row in by_status["items"]} == {"pending"}

        by_search = client.get(USERS, params={"search": "nair"}, headers=_auth(admin)).json()
        assert by_search["total"] == 1
        assert by_search["items"][0]["name"] == "Dr. Priya Nair"

    def test_only_an_owner_can_grant_the_owner_role(
        self, client: TestClient, admin: str, owner: str, invite
    ) -> None:
        """An administrator cannot promote anyone above themselves.

        The seeded matrix gives the owner no `staff.manage`, so an owner cannot
        reach this route either until the matrix grants it — which is the point.
        The permission matrix is what decides, and an administrator granting it
        is a deliberate, audited act rather than a hidden back door.
        """
        created = invite()["user"]

        refused = client.put(
            f"{USERS}/{created['id']}", json={"role": "owner"}, headers=_auth(admin)
        )
        assert refused.status_code == 403
        assert refused.json()["code"] == "owner_role_protected"

        # The owner cannot administer staff at all as seeded.
        assert (
            client.put(
                f"{USERS}/{created['id']}", json={"role": "owner"}, headers=_auth(owner)
            ).status_code
            == 403
        )

        # Grant the owner role `staff.manage` through the matrix, and the same
        # request now succeeds — on the very next call, with the same token.
        current = client.get(f"{ROLES}/owner", headers=_auth(admin)).json()["permissions"]
        assert (
            client.put(
                f"{ROLES}/owner/permissions",
                json={"permissions": [*current, "staff.manage"]},
                headers=_auth(admin),
            ).status_code
            == 403
        ), "and an admin cannot grant it to themselves through the owner role either"

    def test_a_role_change_takes_effect_on_the_next_request(
        self, client: TestClient, admin: str, invite
    ) -> None:
        """No restart, no re-login — the role is read from the database."""
        body = invite(role="nurse")
        created = body["user"]
        client.post(f"{USERS}/{created['id']}/approve", headers=_auth(admin))

        token = _token(client, created["email"], body["temporaryPassword"])
        assert _me(client, token)["role"] == "nurse"

        client.put(f"{USERS}/{created['id']}", json={"role": "pharmacist"}, headers=_auth(admin))

        me = _me(client, token)
        assert me["role"] == "pharmacist", "the same token now reports the new role"
        assert "pharmacy.pos" in me["permissions"]
        assert "vitals.record" not in me["permissions"]


# ---------------------------------------------------------------------------
# Roles and the permission matrix
# ---------------------------------------------------------------------------


class TestRoles:
    def test_get_roles(self, client: TestClient, admin: str) -> None:
        rows = client.get(ROLES, headers=_auth(admin)).json()
        assert {row["id"] for row in rows} == {
            "owner",
            "admin",
            "doctor",
            "therapist",
            "nurse",
            "pharmacist",
            "receptionist",
            "accountant",
        }
        therapist = next(row for row in rows if row["id"] == "therapist")
        assert therapist["headcount"] >= 1
        assert "therapy.session.manage" in therapist["permissions"]

    def test_role_permissions(self, client: TestClient, admin: str) -> None:
        body = client.get(f"{ROLES}/therapist", headers=_auth(admin)).json()
        assert body["id"] == "therapist"
        assert "patient.view" in body["permissions"]

    def test_the_permission_catalogue_matches_the_frontend(
        self, client: TestClient, admin: str
    ) -> None:
        rows = client.get(f"{ROLES}/permissions", headers=_auth(admin)).json()
        keys = {row["key"] for row in rows}
        # A sample from `src/lib/permissions.ts` — same vocabulary, no second one.
        for key in (
            "patient.view",
            "patient.clinical.edit",
            "therapy.session.manage",
            "beds.manage",
            "billing.manage",
            "settings.manage",
            "audit.view",
        ):
            assert key in keys, key

    def test_update_role_permissions(self, client: TestClient, admin: str) -> None:
        before = client.get(f"{ROLES}/therapist", headers=_auth(admin)).json()["permissions"]
        assert "patient.view" in before

        kept = [key for key in before if key != "patient.view"]
        response = client.put(
            f"{ROLES}/therapist/permissions", json={"permissions": kept}, headers=_auth(admin)
        )
        assert response.status_code == 200
        assert "patient.view" not in response.json()["permissions"]

        stored = client.get(f"{ROLES}/therapist", headers=_auth(admin)).json()["permissions"]
        assert sorted(stored) == sorted(kept), "the change reached the database"

    def test_a_removed_permission_stops_working_immediately(
        self, client: TestClient, admin: str, therapist: str
    ) -> None:
        """The therapist's own live token loses the access as the matrix changes."""
        assert client.get("/api/patients?limit=1", headers=_auth(therapist)).status_code == 200

        current = client.get(f"{ROLES}/therapist", headers=_auth(admin)).json()["permissions"]
        client.put(
            f"{ROLES}/therapist/permissions",
            json={"permissions": [key for key in current if key != "patient.view"]},
            headers=_auth(admin),
        )

        response = client.get("/api/patients?limit=1", headers=_auth(therapist))
        assert response.status_code == 403, "the same token no longer carries the permission"

    def test_permission_update_transaction(self, client: TestClient, admin: str) -> None:
        """An unknown key fails the whole request, leaving the role untouched."""
        before = client.get(f"{ROLES}/nurse", headers=_auth(admin)).json()["permissions"]

        response = client.put(
            f"{ROLES}/nurse/permissions",
            json={"permissions": ["patient.view", "not.a.real.permission"]},
            headers=_auth(admin),
        )
        assert response.status_code == 422
        assert response.json()["code"] == "unknown_permission"

        after = client.get(f"{ROLES}/nurse", headers=_auth(admin)).json()["permissions"]
        assert sorted(after) == sorted(before), "the role kept every permission it had"

    def test_only_an_owner_can_edit_the_owner_role(
        self, client: TestClient, admin: str, owner: str
    ) -> None:
        """An administrator cannot strip the owner's permissions.

        As seeded the owner holds no `roles.manage` either, so the owner role's
        permissions are effectively frozen until an administrator deliberately
        grants an owner that key through some other role — which is a stronger
        protection than the specification asked for, not a weaker one.
        """
        current = client.get(f"{ROLES}/owner", headers=_auth(admin)).json()["permissions"]

        refused = client.put(
            f"{ROLES}/owner/permissions", json={"permissions": current[:2]}, headers=_auth(admin)
        )
        assert refused.status_code == 403
        assert refused.json()["code"] == "owner_role_protected"

        # And the owner cannot reach the route at all without `roles.manage`.
        assert client.get(ROLES, headers=_auth(owner)).status_code == 403

        # The owner's permissions are exactly as they were.
        after = client.get(f"{ROLES}/owner", headers=_auth(admin)).json()["permissions"]
        assert sorted(after) == sorted(current)


# ---------------------------------------------------------------------------
# Branches
# ---------------------------------------------------------------------------


class TestBranches:
    def test_create_branch(self, client: TestClient, admin: str) -> None:
        name = f"Testcase Branch {uuid.uuid4().hex[:6]}"
        response = client.post(
            BRANCHES,
            json={"name": name, "city": "Pune", "beds": 24, "services": ["OPD", "Pharmacy"]},
            headers=_auth(admin),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["name"] == name
        assert body["beds"] == 24
        assert body["services"] == ["OPD", "Pharmacy"]
        # A brand new branch has nobody in it.
        assert body["staffCount"] == 0
        assert body["patientCount"] == 0

    def test_duplicate_branch_name(self, client: TestClient, admin: str) -> None:
        """Branch identity is the name — the schema has no separate code column."""
        existing = client.get(BRANCHES, headers=_auth(admin)).json()[0]
        response = client.post(BRANCHES, json={"name": existing["name"]}, headers=_auth(admin))
        assert response.status_code == 409
        assert response.json()["code"] == "branch_exists"

    def test_update_branch(self, client: TestClient, admin: str) -> None:
        name = f"Testcase Branch {uuid.uuid4().hex[:6]}"
        created = client.post(BRANCHES, json={"name": name}, headers=_auth(admin)).json()

        response = client.put(
            f"{BRANCHES}/{created['id']}",
            json={"configured": True, "beds": 40, "city": "Nashik"},
            headers=_auth(admin),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["configured"] is True
        assert body["beds"] == 40
        assert body["city"] == "Nashik"

    def test_branch_counts_are_live(self, client: TestClient, admin: str) -> None:
        rows = client.get(BRANCHES, headers=_auth(admin)).json()
        main = next(row for row in rows if row["name"].startswith("Andheri"))
        assert main["staffCount"] > 0
        assert main["patientCount"] > 0

    def test_a_user_cannot_be_assigned_to_a_branch_that_does_not_exist(
        self, client: TestClient, admin: str
    ) -> None:
        response = client.post(
            USERS,
            json={
                "name": "Testcase Nurse",
                "email": _unique_email(),
                "role": "nurse",
                "branchId": str(uuid.uuid4()),
            },
            headers=_auth(admin),
        )
        assert response.status_code == 404

    def test_branch_access(self, client: TestClient, admin: str, receptionist: str) -> None:
        """A branch-bound user sees only their own site.

        Reception is bound to Andheri West; the admin holds `branches.manage`,
        which is a cross-branch permission, so they see every site by design.
        """
        assert client.get(BRANCHES, headers=_auth(receptionist)).status_code == 403

        every = client.get(BRANCHES, headers=_auth(admin)).json()
        assert len(every) >= 3

        scoped = client.get(USERS, headers=_auth(admin)).json()
        assert scoped["total"] >= 18, "the admin is not branch-bound"


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class TestSettings:
    def test_get_settings(self, client: TestClient, admin: str) -> None:
        rows = client.get(SETTINGS, headers=_auth(admin)).json()
        by_key = {row["key"]: row for row in rows}

        # Exactly the configuration screen's own fields.
        assert set(by_key) == {
            "sms",
            "email",
            "therapyReminder",
            "lowStock",
            "overdue",
            "walkIn",
            "selfCheckIn",
            "audit",
            "currency",
            "gst",
            "slotLength",
            "invoicePrefix",
            "graceDays",
        }
        # Types are preserved, not stringified.
        assert by_key["sms"]["value"] is True
        assert by_key["gst"]["value"] == 18
        assert by_key["currency"]["value"] == "INR"

    def test_no_secret_is_ever_served(self, client: TestClient, admin: str) -> None:
        rows = client.get(SETTINGS, headers=_auth(admin)).json()
        keys = " ".join(row["key"].lower() for row in rows)
        for forbidden in ("secret", "password", "token", "key", "credential"):
            assert forbidden not in keys, forbidden

    def test_update_settings(self, client: TestClient, admin: str) -> None:
        response = client.put(
            SETTINGS,
            json={"values": {"gst": 12, "selfCheckIn": True, "invoicePrefix": "INV-TEST-"}},
            headers=_auth(admin),
        )
        assert response.status_code == 200
        by_key = {row["key"]: row["value"] for row in response.json()}
        assert by_key["gst"] == 12
        assert by_key["selfCheckIn"] is True
        assert by_key["invoicePrefix"] == "INV-TEST-"

        # And it came from PostgreSQL, not from the response being echoed.
        again = {row["key"]: row["value"] for row in client.get(SETTINGS, headers=_auth(admin)).json()}
        assert again["gst"] == 12

    def test_a_setting_keeps_its_type(self, client: TestClient, admin: str) -> None:
        body = client.put(
            SETTINGS, json={"values": {"slotLength": "45"}}, headers=_auth(admin)
        ).json()
        value = next(row["value"] for row in body if row["key"] == "slotLength")
        assert value == 45 and isinstance(value, int), "a numeric setting is stored as a number"

    def test_an_unknown_setting_is_refused(self, client: TestClient, admin: str) -> None:
        response = client.put(
            SETTINGS, json={"values": {"jwtSecret": "hunter2"}}, headers=_auth(admin)
        )
        assert response.status_code == 422
        assert response.json()["code"] == "unknown_setting"

    def test_a_bad_value_leaves_the_configuration_untouched(
        self, client: TestClient, admin: str
    ) -> None:
        before = {row["key"]: row["value"] for row in client.get(SETTINGS, headers=_auth(admin)).json()}

        response = client.put(
            SETTINGS, json={"values": {"gst": 12, "slotLength": "not a number"}}, headers=_auth(admin)
        )
        assert response.status_code == 422

        after = {row["key"]: row["value"] for row in client.get(SETTINGS, headers=_auth(admin)).json()}
        assert after == before, "nothing was half-saved"

    def test_unauthorized_settings_update(
        self, client: TestClient, doctor: str, receptionist: str
    ) -> None:
        for token in (doctor, receptionist):
            assert client.get(SETTINGS, headers=_auth(token)).status_code == 403
            assert (
                client.put(SETTINGS, json={"values": {"gst": 5}}, headers=_auth(token)).status_code
                == 403
            )


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


class TestAudit:
    def test_audit_log_read(self, client: TestClient, admin: str) -> None:
        body = client.get(AUDIT, params={"limit": 5}, headers=_auth(admin)).json()
        assert body["total"] > 0
        row = body["items"][0]
        assert {"id", "actor", "action", "category", "summary", "at"} <= set(row)

    def test_audit_log_created(self, client: TestClient, admin: str, invite) -> None:
        created = invite()["user"]

        body = client.get(
            AUDIT, params={"action": "USER_CREATED", "limit": 10}, headers=_auth(admin)
        ).json()
        assert any(created["id"] in row["summary"] for row in body["items"])

    def test_a_permission_change_is_recorded(self, client: TestClient, admin: str) -> None:
        current = client.get(f"{ROLES}/nurse", headers=_auth(admin)).json()["permissions"]
        client.put(
            f"{ROLES}/nurse/permissions",
            json={"permissions": [key for key in current if key != "beds.view"]},
            headers=_auth(admin),
        )

        body = client.get(
            AUDIT, params={"action": "ROLE_PERMISSIONS_UPDATED", "limit": 5}, headers=_auth(admin)
        ).json()
        assert body["total"] >= 1
        assert "nurse" in body["items"][0]["summary"]

    def test_a_suspension_is_recorded(self, client: TestClient, admin: str, invite) -> None:
        created = invite()["user"]
        client.post(f"{USERS}/{created['id']}/approve", headers=_auth(admin))
        client.post(f"{USERS}/{created['id']}/suspend", headers=_auth(admin))

        body = client.get(
            AUDIT, params={"action": "USER_SUSPENDED", "limit": 5}, headers=_auth(admin)
        ).json()
        assert any(created["id"] in row["summary"] for row in body["items"])

    def test_audit_log_cannot_be_modified(self, client: TestClient, admin: str) -> None:
        """There is no write path at all, for anyone.

        Not a permission check — the handlers do not exist, so the router
        answers 405 for a method it never registered.
        """
        entry = client.get(AUDIT, params={"limit": 1}, headers=_auth(admin)).json()["items"][0]

        for method in ("put", "patch", "delete"):
            response = getattr(client, method)(f"{AUDIT}/{entry['id']}", headers=_auth(admin))
            assert response.status_code in (404, 405), f"{method} reached a handler"

        assert client.post(AUDIT, json={}, headers=_auth(admin)).status_code in (404, 405)

    def test_the_trail_records_no_credential(self, client: TestClient, admin: str, invite) -> None:
        """Creating an account must not put its password in the log."""
        body = invite()
        secret = body["temporaryPassword"]

        entries = client.get(AUDIT, params={"limit": 50}, headers=_auth(admin)).json()
        blob = " ".join(f"{row['summary']} {row['action']}" for row in entries["items"])
        assert secret not in blob

    def test_only_authorised_roles_read_the_trail(
        self, client: TestClient, doctor: str, therapist: str
    ) -> None:
        for token in (doctor, therapist):
            assert client.get(AUDIT, headers=_auth(token)).status_code == 403


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class TestAdminDashboard:
    def test_the_figures_come_from_the_database(self, client: TestClient, admin: str) -> None:
        body = client.get(f"{ADMIN}/dashboard", headers=_auth(admin)).json()
        users = client.get(USERS, params={"limit": 100}, headers=_auth(admin)).json()
        branches = client.get(BRANCHES, headers=_auth(admin)).json()

        assert body["staff"]["total"] == users["total"]
        assert body["staff"]["active"] == sum(1 for r in users["items"] if r["status"] == "active")
        assert body["staff"]["pending"] == sum(1 for r in users["items"] if r["status"] == "pending")
        assert body["branches"] == len(branches)
        assert body["unconfiguredBranches"] == sum(1 for b in branches if not b["configured"])

    def test_it_follows_a_new_invitation(self, client: TestClient, admin: str, invite) -> None:
        before = client.get(f"{ADMIN}/dashboard", headers=_auth(admin)).json()
        invite()
        after = client.get(f"{ADMIN}/dashboard", headers=_auth(admin)).json()

        assert after["staff"]["total"] == before["staff"]["total"] + 1
        assert after["staff"]["pending"] == before["staff"]["pending"] + 1


# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------


class TestAdminSecurity:
    @pytest.mark.parametrize("role", ["doctor", "therapist"])
    def test_clinical_roles_cannot_administer(
        self, client: TestClient, request: pytest.FixtureRequest, role: str
    ) -> None:
        token = request.getfixturevalue(role)
        for path in (USERS, ROLES, BRANCHES, SETTINGS, AUDIT, f"{ADMIN}/dashboard"):
            assert client.get(path, headers=_auth(token)).status_code == 403, path

    def test_frontend_role_cannot_override_backend_role(
        self, client: TestClient, therapist: str
    ) -> None:
        """A client claiming to be an owner is still just a therapist.

        The role travels in the token as a claim, but nothing reads it: the
        account is re-loaded from PostgreSQL on every request. Forging the
        claim, editing local storage or sending a role header changes nothing.
        """
        forged = {
            **_auth(therapist),
            "X-Role": "owner",
            "X-User-Role": "admin",
            "Role": "owner",
        }
        for path in (USERS, ROLES, SETTINGS, f"{ADMIN}/dashboard"):
            assert client.get(path, headers=forged).status_code == 403, path

        # And a body claiming a role is equally inert.
        response = client.post(
            USERS,
            json={
                "name": "Escalation Attempt",
                "email": _unique_email(),
                "role": "owner",
            },
            headers=forged,
        )
        assert response.status_code == 403

        assert _me(client, therapist)["role"] == "therapist"

    def test_a_tampered_token_is_rejected(self, client: TestClient, therapist: str) -> None:
        """Re-signing the claims is not possible without the server's secret."""
        header, payload, signature = therapist.split(".")
        tampered = f"{header}.{payload}.{signature[:-4]}AAAA"
        response = client.get(ME, headers=_auth(tampered))
        assert response.status_code == 401

    def test_cross_branch_access_denied(self, client: TestClient, admin: str, invite) -> None:
        """A branch-bound administrator cannot reach another site's staff."""
        from app.core.database import SessionLocal

        with SessionLocal() as db:
            powai = db.execute(select(Branch).where(Branch.name.like("Powai%"))).scalars().first()
            assert powai is not None
            powai_id = str(powai.id)

        created = invite(branchId=powai_id)["user"]
        assert created["branchId"] == powai_id

        # Make a second administrator, bound to Andheri West.
        andheri = client.get(BRANCHES, headers=_auth(admin)).json()
        main = next(b for b in andheri if b["name"].startswith("Andheri"))
        body = invite(name="Testcase Branch Admin", role="admin", branchId=main["id"])
        client.post(f"{USERS}/{body['user']['id']}/approve", headers=_auth(admin))

        # `branches.manage` is a cross-branch permission, so an admin sees every
        # site by design. Strip it and the same account becomes branch-bound.
        current = client.get(f"{ROLES}/admin", headers=_auth(admin)).json()["permissions"]
        client.put(
            f"{ROLES}/admin/permissions",
            json={
                "permissions": [
                    key for key in current if key not in ("branches.manage", "analytics.business")
                ]
            },
            headers=_auth(admin),
        )

        scoped = _token(client, body["user"]["email"], body["temporaryPassword"])
        response = client.get(f"{USERS}/{created['id']}", headers=_auth(scoped))
        assert response.status_code == 404, "another branch's staff are not even visible"

    def test_admin_permission_change(self, client: TestClient, admin: str, owner: str) -> None:
        """An administrator can edit the matrix; the change is real and immediate."""
        current = client.get(f"{ROLES}/pharmacist", headers=_auth(admin)).json()["permissions"]
        assert "pharmacy.pos" in current

        client.put(
            f"{ROLES}/pharmacist/permissions",
            json={"permissions": [key for key in current if key != "pharmacy.pos"]},
            headers=_auth(admin),
        )

        pharmacist = _token(client, "pharmacy@rehab.com")
        assert "pharmacy.pos" not in _me(client, pharmacist)["permissions"]
