"""Patient module tests.

Runs against real PostgreSQL with the demo data seeded:

    python seed.py && python seed_patients.py
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Patient, User

DEMO_PASSWORD = "Rehab@123"
PATIENTS = "/api/patients"


def _token(client: TestClient, email: str) -> str:
    response = client.post(
        "/api/auth/login", json={"email": email, "password": DEMO_PASSWORD, "remember": False}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _unique_phone() -> str:
    """A phone number no seeded patient uses."""
    tail = uuid.uuid4().int % 10_000_000
    return f"+91 7{tail:07d}"


@pytest.fixture(scope="module")
def seeded() -> None:
    from app.core.database import SessionLocal, check_database_connection

    ok, _ = check_database_connection()
    if not ok:
        pytest.skip("PostgreSQL is not reachable")

    with SessionLocal() as db:
        has_users = db.execute(select(User).limit(1)).scalar_one_or_none()
        has_patients = db.execute(select(Patient).limit(1)).scalar_one_or_none()
    if not has_users or not has_patients:
        pytest.skip("Demo data not seeded — run `python seed.py && python seed_patients.py`")


@pytest.fixture(scope="module")
def doctor(client: TestClient, seeded: None) -> str:
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def admin(client: TestClient, seeded: None) -> str:
    return _token(client, "admin@rehab.com")


@pytest.fixture(scope="module")
def receptionist(client: TestClient, seeded: None) -> str:
    return _token(client, "reception@rehab.com")


@pytest.fixture(autouse=True, scope="module")
def _no_leaked_patients(seeded: None):
    """Remove every patient this module registers.

    These tests hit the real development database, so without this each run
    would leave another batch of "Testcase Patient" rows behind, polluting the
    patient list and every dropdown built from it.
    """
    from app.core.database import SessionLocal

    with SessionLocal() as db:
        before = {
            row for row in db.execute(select(Patient.patient_number)).scalars()
        }

    yield

    with SessionLocal() as db:
        strays = db.execute(
            select(Patient).where(Patient.patient_number.notin_(before))
        ).scalars().all()
        for patient in strays:
            db.delete(patient)
        db.commit()


@pytest.fixture
def created_patient(client: TestClient, receptionist: str):
    """Register a throwaway patient and hand back its payload."""
    response = client.post(
        PATIENTS,
        headers=_auth(receptionist),
        json={
            "name": "Testcase Patient",
            "dateOfBirth": "1990-05-14",
            "gender": "Male",
            "phone": _unique_phone(),
            "department": "Physiotherapy",
            "assignedDoctor": "Dr. Arjun Sharma",
            "primaryCondition": "Automated test record",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


class TestListPatients:
    def test_returns_a_paginated_envelope(self, client: TestClient, doctor: str) -> None:
        body = client.get(PATIENTS, headers=_auth(doctor)).json()
        assert set(body) >= {"items", "page", "limit", "total", "total_pages"}
        assert body["page"] == 1
        assert body["total"] > 0

    def test_patient_pagination(self, client: TestClient, admin: str) -> None:
        first = client.get(f"{PATIENTS}?page=1&limit=5", headers=_auth(admin)).json()
        second = client.get(f"{PATIENTS}?page=2&limit=5", headers=_auth(admin)).json()

        assert len(first["items"]) == 5
        assert first["total_pages"] == -(-first["total"] // 5)

        first_ids = {p["id"] for p in first["items"]}
        second_ids = {p["id"] for p in second["items"]}
        assert not (first_ids & second_ids), "pages must not overlap"

    def test_status_filter_uses_display_labels(self, client: TestClient, admin: str) -> None:
        body = client.get(f"{PATIENTS}?status=In Rehabilitation", headers=_auth(admin)).json()
        assert body["total"] > 0
        assert all(p["status"] == "In Rehabilitation" for p in body["items"])

    def test_search_narrows_the_result_set(self, client: TestClient, admin: str) -> None:
        everything = client.get(PATIENTS, headers=_auth(admin)).json()
        filtered = client.get(f"{PATIENTS}?search=Raj", headers=_auth(admin)).json()
        assert 0 < filtered["total"] < everything["total"]

    def test_sorting_is_applied(self, client: TestClient, admin: str) -> None:
        names = [p["name"] for p in client.get(f"{PATIENTS}?sort=name", headers=_auth(admin)).json()["items"]]
        assert names == sorted(names, key=str.lower) or names == sorted(names)

    def test_limit_is_capped(self, client: TestClient, admin: str) -> None:
        assert client.get(f"{PATIENTS}?limit=5000", headers=_auth(admin)).status_code == 422

    def test_response_uses_frontend_display_vocabulary(self, client: TestClient, admin: str) -> None:
        statuses = {p["status"] for p in client.get(PATIENTS, headers=_auth(admin)).json()["items"]}
        assert statuses <= {
            "Active - OPD",
            "Admitted - IPD",
            "In Rehabilitation",
            "Discharge Pending",
            "Discharged",
            "Follow-up",
        }


class TestSearch:
    def test_search_patient_by_name(self, client: TestClient, admin: str) -> None:
        results = client.get(f"{PATIENTS}/search?q=Raj", headers=_auth(admin)).json()
        assert any(r["name"] == "Raj Kumar" for r in results)

    def test_search_by_patient_number(self, client: TestClient, admin: str) -> None:
        results = client.get(f"{PATIENTS}/search?q=PT-10248", headers=_auth(admin)).json()
        assert results and results[0]["patientNumber"] == "PT-10248"

    def test_search_by_phone_digits(self, client: TestClient, admin: str) -> None:
        results = client.get(f"{PATIENTS}/search?q=98201", headers=_auth(admin)).json()
        assert any("98201" in (r["phone"] or "") for r in results)

    def test_search_returns_lightweight_records(self, client: TestClient, admin: str) -> None:
        """Search must not leak the full 360 payload."""
        results = client.get(f"{PATIENTS}/search?q=Raj", headers=_auth(admin)).json()
        assert results
        for key in ("vitals", "medicalHistory", "address", "emergencyContact"):
            assert key not in results[0]

    def test_search_respects_the_limit(self, client: TestClient, admin: str) -> None:
        assert len(client.get(f"{PATIENTS}/search?q=a&limit=2", headers=_auth(admin)).json()) <= 2

    def test_search_requires_a_term(self, client: TestClient, admin: str) -> None:
        assert client.get(f"{PATIENTS}/search?q=", headers=_auth(admin)).status_code == 422


class TestGetPatient:
    def test_get_patient_by_number(self, client: TestClient, admin: str) -> None:
        body = client.get(f"{PATIENTS}/PT-10248", headers=_auth(admin)).json()
        assert body["id"] == "PT-10248"
        assert body["name"] == "Raj Kumar"
        assert body["emergencyContact"]["name"]

    def test_get_patient_by_uuid(self, client: TestClient, admin: str) -> None:
        by_number = client.get(f"{PATIENTS}/PT-10248", headers=_auth(admin)).json()
        by_uuid = client.get(f"{PATIENTS}/{by_number['uuid']}", headers=_auth(admin)).json()
        assert by_uuid["id"] == by_number["id"]

    def test_unknown_patient_returns_404(self, client: TestClient, admin: str) -> None:
        assert client.get(f"{PATIENTS}/PT-00000", headers=_auth(admin)).status_code == 404

    def test_malformed_identifier_returns_404(self, client: TestClient, admin: str) -> None:
        assert client.get(f"{PATIENTS}/not-an-id", headers=_auth(admin)).status_code == 404


class TestCreatePatient:
    def test_create_patient(self, created_patient: dict) -> None:
        assert created_patient["name"] == "Testcase Patient"
        assert created_patient["id"].startswith("PT-")
        assert created_patient["status"] == "Active - OPD"
        assert created_patient["assignedDoctor"] == "Dr. Arjun Sharma"

    def test_patient_number_is_allocated_by_the_backend(
        self, client: TestClient, receptionist: str
    ) -> None:
        """A client-supplied number must be ignored, not honoured."""
        response = client.post(
            PATIENTS,
            headers=_auth(receptionist),
            json={
                "name": "Numbered Patient",
                "dateOfBirth": "1988-02-02",
                "gender": "Female",
                "phone": _unique_phone(),
                "patient_number": "PT-99999",
                "patientNumber": "PT-99999",
            },
        )
        assert response.status_code == 201
        assert response.json()["id"] != "PT-99999"

    def test_patient_number_unique(self, client: TestClient, receptionist: str) -> None:
        """Sequential registrations never collide."""
        numbers = set()
        for index in range(4):
            response = client.post(
                PATIENTS,
                headers=_auth(receptionist),
                json={
                    "name": f"Sequence Patient {index}",
                    "dateOfBirth": "1991-01-01",
                    "gender": "Other",
                    "phone": _unique_phone(),
                },
            )
            assert response.status_code == 201
            numbers.add(response.json()["id"])
        assert len(numbers) == 4

    def test_duplicate_phone_returns_409(
        self, client: TestClient, receptionist: str, created_patient: dict
    ) -> None:
        response = client.post(
            PATIENTS,
            headers=_auth(receptionist),
            json={
                "name": "Same Number",
                "dateOfBirth": "1990-01-01",
                "gender": "Male",
                "phone": created_patient["phone"],
            },
        )
        assert response.status_code == 409
        assert response.json()["code"] == "duplicate_phone"

    def test_future_date_of_birth_returns_422(self, client: TestClient, receptionist: str) -> None:
        response = client.post(
            PATIENTS,
            headers=_auth(receptionist),
            json={
                "name": "Future Person",
                "dateOfBirth": "2090-01-01",
                "gender": "Male",
                "phone": _unique_phone(),
            },
        )
        assert response.status_code == 422

    def test_missing_required_fields_returns_422(
        self, client: TestClient, receptionist: str
    ) -> None:
        assert client.post(PATIENTS, headers=_auth(receptionist), json={"name": "X"}).status_code == 422


class TestUpdatePatient:
    def test_update_patient(
        self, client: TestClient, receptionist: str, created_patient: dict
    ) -> None:
        response = client.put(
            f"{PATIENTS}/{created_patient['id']}",
            headers=_auth(receptionist),
            json={"address": "22 New Road, Mumbai", "status": "In Rehabilitation"},
        )
        assert response.status_code == 200

        body = response.json()
        assert body["address"] == "22 New Road, Mumbai"
        assert body["status"] == "In Rehabilitation"

    def test_update_persists(
        self, client: TestClient, receptionist: str, created_patient: dict
    ) -> None:
        client.put(
            f"{PATIENTS}/{created_patient['id']}",
            headers=_auth(receptionist),
            json={"bloodGroup": "O-"},
        )
        fresh = client.get(f"{PATIENTS}/{created_patient['id']}", headers=_auth(receptionist)).json()
        assert fresh["bloodGroup"] == "O-"

    def test_patient_number_cannot_be_changed(
        self, client: TestClient, receptionist: str, created_patient: dict
    ) -> None:
        response = client.put(
            f"{PATIENTS}/{created_patient['id']}",
            headers=_auth(receptionist),
            json={"id": "PT-77777", "patientNumber": "PT-77777", "uuid": str(uuid.uuid4())},
        )
        assert response.status_code == 200
        assert response.json()["id"] == created_patient["id"]
        assert response.json()["uuid"] == created_patient["uuid"]

    def test_partial_update_leaves_other_fields_alone(
        self, client: TestClient, receptionist: str, created_patient: dict
    ) -> None:
        client.put(
            f"{PATIENTS}/{created_patient['id']}",
            headers=_auth(receptionist),
            json={"address": "Only the address changes"},
        )
        fresh = client.get(f"{PATIENTS}/{created_patient['id']}", headers=_auth(receptionist)).json()
        assert fresh["name"] == created_patient["name"]
        assert fresh["phone"] == created_patient["phone"]


class TestPatient360:
    def test_patient_360(self, client: TestClient, doctor: str) -> None:
        body = client.get(f"{PATIENTS}/PT-10248/360", headers=_auth(doctor)).json()

        assert body["patient"]["id"] == "PT-10248"
        assert len(body["vitals"]) > 0
        assert len(body["medicalHistory"]) > 0
        assert len(body["documents"]) > 0

    def test_360_does_not_fabricate_unbuilt_modules(self, client: TestClient, doctor: str) -> None:
        """Modules that do not exist yet must return empty, not invented rows.

        Sections built in later steps drop out of this list as they land —
        appointments in Step 6, consultations, labs and prescriptions in Step 7.
        Each is asserted against real data in its own test module.
        """
        body = client.get(f"{PATIENTS}/PT-10248/360", headers=_auth(doctor)).json()

        # Invoices are gated on billing.view, which a doctor does not hold.
        assert body["invoices"] == []
        # Admissions stopped being a placeholder in Step 10 — the section is
        # real now, so it is asserted against seeded data in test_nursing.py.
        # Every section the frontend shows is real as of Step 11.
        assert body["pendingModules"] == []

    def test_vitals_are_newest_first(self, client: TestClient, doctor: str) -> None:
        vitals = client.get(f"{PATIENTS}/PT-10248/360", headers=_auth(doctor)).json()["vitals"]
        stamps = [v["recordedAt"] for v in vitals]
        assert stamps == sorted(stamps, reverse=True)

    def test_360_of_unknown_patient_returns_404(self, client: TestClient, doctor: str) -> None:
        assert client.get(f"{PATIENTS}/PT-00000/360", headers=_auth(doctor)).status_code == 404


class TestClinicalPermissions:
    def test_clinical_data_visible_with_permission(self, client: TestClient, doctor: str) -> None:
        body = client.get(f"{PATIENTS}/PT-10248/360", headers=_auth(doctor)).json()
        # A doctor holds the clinical permissions but not billing.view, so the
        # invoices section is withheld and says so rather than reading empty.
        assert body["restrictedSections"] == ["invoices"]
        assert body["vitals"]

    def test_clinical_data_withheld_without_permission(
        self, client: TestClient, admin: str
    ) -> None:
        """Admin has patient.view but not patient.clinical.view."""
        body = client.get(f"{PATIENTS}/PT-10248/360", headers=_auth(admin)).json()

        assert body["vitals"] == []
        assert body["medicalHistory"] == []
        assert body["consultations"] == []
        assert body["labs"] == []
        # Admin holds rehab.plan.view, so the rehabilitation sections are not
        # withheld — only the clinical record is.
        assert set(body["restrictedSections"]) == {
            "vitals",
            "medicalHistory",
            "consultations",
            "labs",
            # A prescription lists medicines and doses, so it is gated too.
            "prescriptions",
        }
        # Demographics are still available — only the clinical record is gated.
        assert body["patient"]["name"] == "Raj Kumar"


class TestAuthorization:
    def test_patient_access_without_authentication(self, client: TestClient) -> None:
        assert client.get(PATIENTS).status_code == 401

    def test_patient_access_with_permission(self, client: TestClient, doctor: str) -> None:
        assert client.get(PATIENTS, headers=_auth(doctor)).status_code == 200

    def test_patient_access_without_permission(self, client: TestClient, seeded: None) -> None:
        """A pharmacist may create nothing, even though they may view patients."""
        token = _token(client, "pharmacy@rehab.com")
        response = client.post(
            PATIENTS,
            headers=_auth(token),
            json={
                "name": "Should Fail",
                "dateOfBirth": "1990-01-01",
                "gender": "Male",
                "phone": _unique_phone(),
            },
        )
        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_permission"

    def test_update_requires_edit_permission(self, client: TestClient, seeded: None) -> None:
        token = _token(client, "pharmacy@rehab.com")
        response = client.put(
            f"{PATIENTS}/PT-10248", headers=_auth(token), json={"address": "nope"}
        )
        assert response.status_code == 403

    def test_no_delete_endpoint_exists(self, client: TestClient, admin: str) -> None:
        response = client.delete(f"{PATIENTS}/PT-10248", headers=_auth(admin))
        assert response.status_code in (404, 405)


class TestBranchIsolation:
    def test_user_cannot_access_other_branch_patient(
        self, client: TestClient, doctor: str
    ) -> None:
        """PT-10263 belongs to Powai; the demo doctor works at Andheri.

        404 rather than 403 — a 403 would confirm the record exists.
        """
        assert client.get(f"{PATIENTS}/PT-10263", headers=_auth(doctor)).status_code == 404

    def test_other_branch_patient_is_absent_from_the_list(
        self, client: TestClient, doctor: str
    ) -> None:
        body = client.get(f"{PATIENTS}?limit=100", headers=_auth(doctor)).json()
        assert "PT-10263" not in {p["id"] for p in body["items"]}

    def test_other_branch_patient_is_absent_from_search(
        self, client: TestClient, doctor: str
    ) -> None:
        results = client.get(f"{PATIENTS}/search?q=PT-10263", headers=_auth(doctor)).json()
        assert results == []

    def test_cross_branch_role_sees_every_branch(self, client: TestClient, admin: str) -> None:
        """Admin holds branches.manage, so branch scoping does not apply."""
        body = client.get(f"{PATIENTS}?limit=100", headers=_auth(admin)).json()
        assert "PT-10263" in {p["id"] for p in body["items"]}

    def test_branch_scoped_list_is_a_strict_subset(
        self, client: TestClient, doctor: str, admin: str
    ) -> None:
        scoped = client.get(f"{PATIENTS}?limit=100", headers=_auth(doctor)).json()["total"]
        everything = client.get(f"{PATIENTS}?limit=100", headers=_auth(admin)).json()["total"]
        assert scoped < everything


class TestAuditTrail:
    def test_creation_is_audited(self, created_patient: dict) -> None:
        from app.core.database import SessionLocal
        from app.models import AuditLog

        with SessionLocal() as db:
            entry = db.execute(
                select(AuditLog)
                .where(AuditLog.target_id == uuid.UUID(created_patient["uuid"]))
                .where(AuditLog.action == "PATIENT_CREATED")
            ).scalar_one_or_none()

        assert entry is not None
        assert entry.user_id is not None
        assert created_patient["id"] in (entry.summary or "")
