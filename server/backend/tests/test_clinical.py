"""Consultation, medical history, vitals, lab and prescription tests.

Runs against real PostgreSQL with the demo data seeded:

    python seed.py && python seed_patients.py
    python seed_appointments.py && python seed_clinical.py

Every test that writes cleans up after itself, so a run leaves the seeded
clinical data exactly as it found it.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import (
    Consultation,
    LabResult,
    MedicalHistoryEntry,
    Notification,
    Patient,
    Prescription,
    User,
    Vitals,
)

DEMO_PASSWORD = "Rehab@123"
CONSULTATIONS = "/api/consultations"
PRESCRIPTIONS = "/api/prescriptions"
LABS = "/api/labs"
PATIENTS = "/api/patients"

#: Raj Kumar — Dr. Arjun Sharma's patient, with a seeded appointment today.
PATIENT = "PT-10248"


def _token(client: TestClient, email: str) -> str:
    response = client.post(
        "/api/auth/login", json={"email": email, "password": DEMO_PASSWORD, "remember": False}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def seeded() -> None:
    from app.core.database import SessionLocal, check_database_connection

    ok, _ = check_database_connection()
    if not ok:
        pytest.skip("PostgreSQL is not reachable")

    with SessionLocal() as db:
        have = all(
            db.execute(select(model).limit(1)).scalar_one_or_none() is not None
            for model in (User, Patient, LabResult, Prescription)
        )
    if not have:
        pytest.skip("Demo data not seeded — run seed.py, seed_patients.py and seed_clinical.py")


@pytest.fixture(autouse=True, scope="module")
def _no_leaked_clinical_rows(seeded: None):
    """Remove every clinical row this module writes.

    These tests hit the development database; without this each run would leave
    another set of consultations, observations and prescriptions behind.
    """
    from app.core.database import SessionLocal

    def snapshot():
        with SessionLocal() as db:
            return {
                model: list(db.execute(select(model.id)).scalars())
                # Notification is included because reviewing a lab now raises
                # one for the ordering clinician.
                for model in (
                    Consultation,
                    Prescription,
                    Vitals,
                    MedicalHistoryEntry,
                    Notification,
                )
            }

    before = snapshot()
    yield
    with SessionLocal() as db:
        # Prescriptions first — one may reference a consultation.
        for model in (Notification, Prescription, Consultation, Vitals, MedicalHistoryEntry):
            keep = before[model]
            # An empty baseline needs an unconditional delete: `NOT IN (NULL)`
            # is NULL for every row, so a placeholder would silently match
            # nothing and let the whole table leak.
            statement = delete(model)
            if keep:
                statement = statement.where(model.id.notin_(keep))
            db.execute(statement)
        db.commit()


@pytest.fixture(scope="module")
def doctor(client: TestClient, seeded: None) -> str:
    """Dr. Arjun Sharma — the treating doctor for PT-10248."""
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def other_doctor(client: TestClient, seeded: None) -> str:
    """Dr. Sanjay Bhatt — same branch, different caseload."""
    return _token(client, "sanjay.bhatt@rehab.com")


@pytest.fixture(scope="module")
def nurse(client: TestClient, seeded: None) -> str:
    return _token(client, "nurse@rehab.com")


@pytest.fixture(scope="module")
def receptionist(client: TestClient, seeded: None) -> str:
    """Has patient.view but no clinical permission at all."""
    return _token(client, "reception@rehab.com")


@pytest.fixture(scope="module")
def accountant(client: TestClient, seeded: None) -> str:
    return _token(client, "accounts@rehab.com")


@pytest.fixture
def consultation(client: TestClient, doctor: str):
    """Record a consultation and hand back its payload."""

    def _record(**overrides) -> dict:
        payload = {
            "patientId": PATIENT,
            "complaint": "Stiffness on waking, easing after 20 minutes.",
            "examination": "Flexion 118 degrees, extension full. No effusion.",
            "diagnosis": "Post-operative ACL reconstruction — week 8 review",
            "carePlan": "continue",
            "notes": "Continue closed-chain strengthening.",
            "followUpDate": (date.today() + timedelta(days=14)).isoformat(),
        }
        payload.update(overrides)
        response = client.post(CONSULTATIONS, json=payload, headers=_auth(doctor))
        assert response.status_code == 201, response.text
        return response.json()

    return _record


# ---------------------------------------------------------------------------
# Consultations
# ---------------------------------------------------------------------------


class TestConsultations:
    def test_create_consultation(self, consultation) -> None:
        body = consultation()

        assert body["patientId"] == PATIENT
        assert body["patientName"] == "Raj Kumar"
        assert body["diagnosis"].startswith("Post-operative ACL")
        assert body["complaint"].startswith("Stiffness")
        assert body["carePlan"] == "continue"
        # The author is the authenticated user, not anything the client sent.
        assert body["doctor"] == "Dr. Arjun Sharma"

    def test_doctor_id_from_the_body_is_ignored(
        self, client: TestClient, doctor: str
    ) -> None:
        """A doctorId in the payload cannot make the encounter someone else's."""
        response = client.post(
            CONSULTATIONS,
            json={
                "patientId": PATIENT,
                "diagnosis": "Impersonation attempt",
                "doctorId": "USR-1010",
                "doctor": "Dr. Sanjay Bhatt",
            },
            headers=_auth(doctor),
        )
        assert response.status_code == 201, response.text
        assert response.json()["doctor"] == "Dr. Arjun Sharma"
        assert response.json()["doctorId"] == "USR-1003"

    def test_get_consultation(self, client: TestClient, doctor: str, consultation) -> None:
        created = consultation()
        response = client.get(f"{CONSULTATIONS}/{created['id']}", headers=_auth(doctor))

        assert response.status_code == 200, response.text
        assert response.json()["id"] == created["id"]
        assert response.json()["diagnosis"] == created["diagnosis"]

    def test_update_consultation(self, client: TestClient, doctor: str, consultation) -> None:
        created = consultation()
        response = client.put(
            f"{CONSULTATIONS}/{created['id']}",
            json={"diagnosis": "Revised working diagnosis", "notes": "Amended after imaging."},
            headers=_auth(doctor),
        )

        assert response.status_code == 200, response.text
        assert response.json()["diagnosis"] == "Revised working diagnosis"
        assert response.json()["notes"] == "Amended after imaging."
        # Untouched fields survive a partial update.
        assert response.json()["complaint"] == created["complaint"]

    def test_doctor_cannot_edit_other_doctors_consultation(
        self, client: TestClient, other_doctor: str, consultation
    ) -> None:
        created = consultation()
        response = client.put(
            f"{CONSULTATIONS}/{created['id']}",
            json={"diagnosis": "Rewritten by someone else"},
            headers=_auth(other_doctor),
        )

        assert response.status_code == 403, response.text
        assert response.json()["code"] == "not_your_consultation"

    def test_consultation_list_defaults_to_the_doctors_own(
        self, client: TestClient, doctor: str, other_doctor: str, consultation
    ) -> None:
        consultation()
        mine = client.get(f"{CONSULTATIONS}?limit=200", headers=_auth(doctor)).json()
        theirs = client.get(f"{CONSULTATIONS}?limit=200", headers=_auth(other_doctor)).json()

        assert mine["total"] >= 1
        assert {row["doctor"] for row in mine["items"]} == {"Dr. Arjun Sharma"}
        assert all(row["doctor"] != "Dr. Arjun Sharma" for row in theirs["items"])

    def test_consultation_can_be_filtered_by_patient(
        self, client: TestClient, doctor: str, consultation
    ) -> None:
        consultation()
        body = client.get(
            f"{CONSULTATIONS}?patient={PATIENT}&limit=200", headers=_auth(doctor)
        ).json()

        assert body["items"]
        assert {row["patientId"] for row in body["items"]} == {PATIENT}

    def test_consultation_against_an_appointment(
        self, client: TestClient, doctor: str, receptionist: str
    ) -> None:
        """An encounter can be tied to the appointment it was held under."""
        booked = client.post(
            "/api/appointments",
            json={
                "patientId": PATIENT,
                "doctorId": "USR-1003",
                "date": (date.today() + timedelta(days=400)).isoformat(),
                "time": "09:00",
                "type": "Follow-up",
            },
            headers=_auth(receptionist),
        )
        assert booked.status_code == 201, booked.text
        appointment = booked.json()

        # A scheduled appointment is not ready for an encounter.
        too_early = client.post(
            CONSULTATIONS,
            json={"patientId": PATIENT, "appointmentId": appointment["uuid"], "diagnosis": "Too soon"},
            headers=_auth(doctor),
        )
        assert too_early.status_code == 409
        assert too_early.json()["code"] == "appointment_not_ready"

        client.post(f"/api/appointments/{appointment['uuid']}/check-in", headers=_auth(receptionist))

        first = client.post(
            CONSULTATIONS,
            json={
                "patientId": PATIENT,
                "appointmentId": appointment["uuid"],
                "diagnosis": "Week 8 review",
            },
            headers=_auth(doctor),
        )
        assert first.status_code == 201, first.text
        assert first.json()["appointmentId"] == appointment["id"]

        # One encounter per appointment.
        duplicate = client.post(
            CONSULTATIONS,
            json={
                "patientId": PATIENT,
                "appointmentId": appointment["uuid"],
                "diagnosis": "Second attempt",
            },
            headers=_auth(doctor),
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["code"] == "consultation_exists"

        from app.core.database import SessionLocal
        from app.models import Appointment

        with SessionLocal() as db:
            db.execute(delete(Consultation).where(Consultation.appointment_id == appointment["uuid"]))
            db.execute(delete(Appointment).where(Appointment.id == appointment["uuid"]))
            db.commit()

    def test_consultation_requires_a_diagnosis(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            CONSULTATIONS, json={"patientId": PATIENT, "complaint": "Sore knee"}, headers=_auth(doctor)
        )
        assert response.status_code == 422

    def test_follow_up_is_stored_as_a_date(self, client: TestClient, doctor: str, consultation) -> None:
        due = date.today() - timedelta(days=3)
        created = consultation(followUpDate=due.isoformat())

        assert created["followUpDate"] == due.isoformat()

        overdue = client.get(f"{CONSULTATIONS}/follow-ups", headers=_auth(doctor))
        assert overdue.status_code == 200, overdue.text
        assert any(row["id"] == created["id"] for row in overdue.json())


# ---------------------------------------------------------------------------
# Medical history
# ---------------------------------------------------------------------------


class TestMedicalHistory:
    def test_get_patient_history(self, client: TestClient, doctor: str) -> None:
        response = client.get(f"{PATIENTS}/{PATIENT}/medical-history", headers=_auth(doctor))

        assert response.status_code == 200, response.text
        entries = response.json()
        assert entries, "PT-10248 has seeded history"
        # Newest first, and using the frontend's own vocabulary.
        assert entries == sorted(entries, key=lambda e: e["date"], reverse=True)
        assert set(e["type"] for e in entries) <= {
            "Diagnosis",
            "Surgery",
            "Injury",
            "Allergy",
            "Chronic Condition",
            "Lab Result",
        }

    def test_create_history_entry(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            f"{PATIENTS}/{PATIENT}/medical-history",
            json={
                "type": "Diagnosis",
                "title": "Patellofemoral pain syndrome",
                "detail": "Secondary to quadriceps weakness post-reconstruction.",
            },
            headers=_auth(doctor),
        )

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["title"] == "Patellofemoral pain syndrome"
        assert body["type"] == "Diagnosis"
        # The clinician is the authenticated user.
        assert body["clinician"] == "Dr. Arjun Sharma"
        assert body["date"] == date.today().isoformat()

        listed = client.get(f"{PATIENTS}/{PATIENT}/medical-history", headers=_auth(doctor)).json()
        assert any(e["id"] == body["id"] for e in listed)

    def test_history_entry_rejects_an_unknown_type(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            f"{PATIENTS}/{PATIENT}/medical-history",
            json={"type": "Complication", "title": "Invented category"},
            headers=_auth(doctor),
        )
        assert response.status_code == 422

    def test_history_entry_cannot_be_future_dated(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            f"{PATIENTS}/{PATIENT}/medical-history",
            json={
                "type": "Diagnosis",
                "title": "Tomorrow",
                "date": (date.today() + timedelta(days=1)).isoformat(),
            },
            headers=_auth(doctor),
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Vitals
# ---------------------------------------------------------------------------


class TestVitals:
    def test_get_patient_vitals(self, client: TestClient, doctor: str) -> None:
        response = client.get(f"{PATIENTS}/{PATIENT}/vitals", headers=_auth(doctor))

        assert response.status_code == 200, response.text
        rows = response.json()
        assert rows, "PT-10248 has seeded observations"
        stamps = [r["recordedAt"] for r in rows]
        assert stamps == sorted(stamps, reverse=True)
        assert {"systolic", "diastolic", "heartRate", "temperature", "spo2", "respiratoryRate"} <= set(
            rows[0]
        )

    def test_record_vitals(self, client: TestClient, nurse: str) -> None:
        response = client.post(
            f"{PATIENTS}/{PATIENT}/vitals",
            json={
                "systolic": 124,
                "diastolic": 78,
                "heartRate": 72,
                "temperature": 36.7,
                "spo2": 98,
                "respiratoryRate": 15,
            },
            headers=_auth(nurse),
        )

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["systolic"] == 124
        assert body["temperature"] == 36.7
        assert body["recordedBy"] == "Sister Anita Fernandes"

        latest = client.get(f"{PATIENTS}/{PATIENT}/vitals/latest", headers=_auth(nurse))
        assert latest.status_code == 200
        assert latest.json()["id"] == body["id"]

    def test_a_doctor_can_record_vitals_during_a_consultation(
        self, client: TestClient, doctor: str
    ) -> None:
        response = client.post(
            f"{PATIENTS}/{PATIENT}/vitals",
            json={"systolic": 118, "diastolic": 76},
            headers=_auth(doctor),
        )
        assert response.status_code == 201, response.text
        assert response.json()["recordedBy"] == "Dr. Arjun Sharma"

    def test_empty_vitals_are_rejected(self, client: TestClient, nurse: str) -> None:
        response = client.post(f"{PATIENTS}/{PATIENT}/vitals", json={}, headers=_auth(nurse))
        assert response.status_code == 422

    def test_impossible_readings_are_rejected_before_the_database(
        self, client: TestClient, nurse: str
    ) -> None:
        """A 422, not a 503 from the CHECK constraint."""
        response = client.post(
            f"{PATIENTS}/{PATIENT}/vitals", json={"spo2": 5}, headers=_auth(nurse)
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Labs
# ---------------------------------------------------------------------------


class TestLabs:
    def test_get_lab_results(self, client: TestClient, doctor: str) -> None:
        response = client.get(f"{LABS}?limit=200", headers=_auth(doctor))

        assert response.status_code == 200, response.text
        rows = response.json()["items"]
        assert rows
        first = rows[0]
        assert set(first) >= {"id", "test", "reportedOn", "flag", "summary", "values", "reviewed"}
        assert first["id"].startswith("LAB-")
        assert set(first["values"][0]) >= {"analyte", "value", "reference", "abnormal"}

    def test_get_one_lab_by_code(self, client: TestClient, doctor: str) -> None:
        response = client.get(f"{LABS}/LAB-3301", headers=_auth(doctor))
        assert response.status_code == 200, response.text
        assert response.json()["test"] == "Complete Blood Count"

    def test_review_lab(self, client: TestClient, doctor: str) -> None:
        from app.core.database import SessionLocal

        # LAB-3301 is Raj Kumar's, in this doctor's own branch. LAB-3302 belongs
        # to a Powai patient and is correctly invisible here — see
        # test_labs_from_another_branch_are_not_visible.
        target = "LAB-3301"
        response = client.post(f"{LABS}/{target}/review", headers=_auth(doctor))

        try:
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["reviewed"] is True
            # Set by the server from the authenticated user.
            assert body["reviewedBy"] == "Dr. Arjun Sharma"
            assert body["reviewedAt"] is not None

            # Reviewing twice is refused rather than silently re-stamped.
            again = client.post(f"{LABS}/{target}/review", headers=_auth(doctor))
            assert again.status_code == 409
            assert again.json()["code"] == "already_reviewed"
        finally:
            with SessionLocal() as db:
                row = db.execute(
                    select(LabResult).where(LabResult.lab_number == target)
                ).scalar_one()
                row.reviewed = False
                row.reviewed_by = None
                row.reviewed_at = None
                db.commit()

    def test_review_queue_filter(self, client: TestClient, doctor: str) -> None:
        pending = client.get(f"{LABS}?reviewed=false&limit=200", headers=_auth(doctor)).json()
        assert pending["items"]
        assert all(row["reviewed"] is False for row in pending["items"])

    def test_labs_can_be_filtered_by_patient(self, client: TestClient, doctor: str) -> None:
        """Filtered in SQL — the screen never pulls the list to filter one out."""
        response = client.get(f"{LABS}?patient={PATIENT}&limit=200", headers=_auth(doctor))

        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert items
        assert {row["patientId"] for row in items} == {PATIENT}

    def test_labs_filtered_by_an_out_of_branch_patient_are_404(
        self, client: TestClient, doctor: str
    ) -> None:
        """Not an empty list, which would read as "this patient has no reports"."""
        response = client.get(f"{LABS}?patient=PT-10263", headers=_auth(doctor))
        assert response.status_code == 404

    def test_a_nurse_can_read_but_not_sign_off_a_report(
        self, client: TestClient, nurse: str
    ) -> None:
        assert client.get(f"{LABS}/LAB-3301", headers=_auth(nurse)).status_code == 200
        assert client.post(f"{LABS}/LAB-3301/review", headers=_auth(nurse)).status_code == 403

    def test_labs_from_another_branch_are_not_visible(
        self, client: TestClient, doctor: str
    ) -> None:
        """LAB-3302 is a Powai patient's; an Andheri West doctor gets a 404.

        404 rather than 403 — a 403 would confirm the report exists.
        """
        assert client.get(f"{LABS}/LAB-3302", headers=_auth(doctor)).status_code == 404
        assert client.post(f"{LABS}/LAB-3302/review", headers=_auth(doctor)).status_code == 404

        listed = client.get(f"{LABS}?limit=200", headers=_auth(doctor)).json()["items"]
        assert "LAB-3302" not in {row["id"] for row in listed}


# ---------------------------------------------------------------------------
# Prescriptions
# ---------------------------------------------------------------------------


class TestPrescriptions:
    def test_create_prescription(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "priority": "Routine",
                "items": [
                    {
                        "medicine": "Etoricoxib 90 mg",
                        "dosage": "1 tablet",
                        "frequency": "Once daily after breakfast",
                        "duration": "10 days",
                        "quantity": 10,
                        "instructions": "Take with food.",
                    }
                ],
            },
            headers=_auth(doctor),
        )

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["id"].startswith("RX-")
        # A new prescription is always Pending; the client cannot set it.
        assert body["status"] == "Pending"
        assert body["priority"] == "Routine"
        # The prescriber is the authenticated user.
        assert body["doctor"] == "Dr. Arjun Sharma"

    def test_prescription_items(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "items": [
                    {
                        "medicine": "Etoricoxib 90 mg",
                        "dosage": "1 tablet",
                        "frequency": "Once daily",
                        "duration": "10 days",
                        "quantity": 10,
                    },
                    {
                        "medicine": "Pantoprazole 40 mg",
                        "dosage": "1 tablet",
                        "frequency": "Once daily before breakfast",
                        "duration": "10 days",
                        "quantity": 10,
                        "instructions": "30 minutes before food.",
                    },
                ],
            },
            headers=_auth(doctor),
        )

        assert response.status_code == 201, response.text
        items = response.json()["items"]
        assert len(items) == 2
        assert [i["medicine"] for i in items] == ["Etoricoxib 90 mg", "Pantoprazole 40 mg"]
        assert items[1]["instructions"] == "30 minutes before food."
        assert all(i["quantity"] == 10 for i in items)

    def test_invalid_medicine(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "items": [
                    {
                        "medicine": "Unobtainium 500 mg",
                        "dosage": "1 tablet",
                        "frequency": "Once daily",
                        "duration": "5 days",
                        "quantity": 5,
                    }
                ],
            },
            headers=_auth(doctor),
        )

        assert response.status_code == 422, response.text
        assert "catalogue" in response.json()["detail"]

    def test_prescription_transaction(self, client: TestClient, doctor: str) -> None:
        """A bad line rolls the whole prescription back — no orphan header."""
        from app.core.database import SessionLocal

        with SessionLocal() as db:
            before = db.execute(select(Prescription.id)).scalars().all()

        response = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "items": [
                    {
                        "medicine": "Etoricoxib 90 mg",
                        "dosage": "1 tablet",
                        "frequency": "Once daily",
                        "duration": "10 days",
                        "quantity": 10,
                    },
                    {
                        "medicine": "Not A Real Medicine",
                        "dosage": "1 tablet",
                        "frequency": "Once daily",
                        "duration": "10 days",
                        "quantity": 10,
                    },
                ],
            },
            headers=_auth(doctor),
        )
        assert response.status_code == 422

        with SessionLocal() as db:
            after = db.execute(select(Prescription.id)).scalars().all()
        assert set(after) == set(before), "the rejected prescription left nothing behind"

    def test_zero_quantity_is_rejected(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "items": [
                    {
                        "medicine": "Etoricoxib 90 mg",
                        "dosage": "1 tablet",
                        "frequency": "Once daily",
                        "duration": "10 days",
                        "quantity": 0,
                    }
                ],
            },
            headers=_auth(doctor),
        )
        assert response.status_code == 422

    def test_prescription_needs_at_least_one_item(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            PRESCRIPTIONS, json={"patientId": PATIENT, "items": []}, headers=_auth(doctor)
        )
        assert response.status_code == 422

    def test_medicine_catalogue_is_available_to_prescribe_from(
        self, client: TestClient, doctor: str
    ) -> None:
        """The consultation form's dropdown, without exposing inventory."""
        response = client.get(f"{PRESCRIPTIONS}/medicines", headers=_auth(doctor))

        assert response.status_code == 200, response.text
        catalogue = response.json()
        assert catalogue
        first = catalogue[0]
        assert set(first) == {"id", "name", "genericName", "category", "strength", "status"}
        # Pharmacy data stays in the pharmacy module.
        assert not {"quantity", "unitPrice", "mrp", "batch", "expiry"} & set(first)
        assert {m["status"] for m in catalogue} <= {
            "In Stock",
            "Low Stock",
            "Near Expiry",
            "Out of Stock",
        }

    def test_catalogue_is_closed_to_non_prescribers(
        self, client: TestClient, nurse: str, receptionist: str
    ) -> None:
        for token in (nurse, receptionist):
            assert (
                client.get(f"{PRESCRIPTIONS}/medicines", headers=_auth(token)).status_code == 403
            )

    def test_an_out_of_stock_medicine_can_still_be_prescribed(
        self, client: TestClient, doctor: str
    ) -> None:
        """Substitution is the pharmacy's decision, not a prescribing block."""
        catalogue = client.get(f"{PRESCRIPTIONS}/medicines", headers=_auth(doctor)).json()
        out_of_stock = next((m for m in catalogue if m["status"] == "Out of Stock"), None)
        if out_of_stock is None:
            pytest.skip("no out-of-stock medicine in the seeded catalogue")

        response = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "items": [
                    {
                        "medicine": out_of_stock["name"],
                        "dosage": "1 tablet",
                        "frequency": "Once daily",
                        "duration": "5 days",
                        "quantity": 5,
                    }
                ],
            },
            headers=_auth(doctor),
        )
        assert response.status_code == 201, response.text

    def test_doctor_sees_their_own_prescriptions(self, client: TestClient, doctor: str) -> None:
        body = client.get(f"{PRESCRIPTIONS}?limit=200", headers=_auth(doctor)).json()
        assert body["items"]
        assert {row["doctor"] for row in body["items"]} == {"Dr. Arjun Sharma"}

    def test_nothing_here_touches_stock(self, client: TestClient, doctor: str) -> None:
        """Prescribing must not move inventory — dispensing is a later module."""
        from app.core.database import SessionLocal
        from app.models import MedicineBatch

        def stock():
            with SessionLocal() as db:
                return dict(
                    db.execute(select(MedicineBatch.id, MedicineBatch.quantity)).all()
                )

        before = stock()
        response = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "items": [
                    {
                        "medicine": "Paracetamol 650 mg",
                        "dosage": "1 tablet",
                        "frequency": "Three times daily",
                        "duration": "5 days",
                        "quantity": 15,
                    }
                ],
            },
            headers=_auth(doctor),
        )
        assert response.status_code == 201, response.text
        assert stock() == before


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


class TestClinicalPermissions:
    def test_non_clinical_user_cannot_access_vitals(
        self, client: TestClient, receptionist: str
    ) -> None:
        """A receptionist can see the patient but not their observations."""
        assert client.get(f"{PATIENTS}/{PATIENT}", headers=_auth(receptionist)).status_code == 200
        assert (
            client.get(f"{PATIENTS}/{PATIENT}/vitals", headers=_auth(receptionist)).status_code
            == 403
        )
        assert (
            client.get(
                f"{PATIENTS}/{PATIENT}/vitals/latest", headers=_auth(receptionist)
            ).status_code
            == 403
        )
        assert (
            client.post(
                f"{PATIENTS}/{PATIENT}/vitals",
                json={"systolic": 120, "diastolic": 80},
                headers=_auth(receptionist),
            ).status_code
            == 403
        )

    def test_user_without_clinical_permission_cannot_access_history(
        self, client: TestClient, receptionist: str, accountant: str
    ) -> None:
        for token in (receptionist, accountant):
            assert (
                client.get(f"{PATIENTS}/{PATIENT}/medical-history", headers=_auth(token)).status_code
                == 403
            )
            assert (
                client.post(
                    f"{PATIENTS}/{PATIENT}/medical-history",
                    json={"type": "Diagnosis", "title": "Should not be written"},
                    headers=_auth(token),
                ).status_code
                == 403
            )

    def test_non_clinical_user_cannot_read_consultations_or_labs(
        self, client: TestClient, receptionist: str
    ) -> None:
        assert client.get(CONSULTATIONS, headers=_auth(receptionist)).status_code == 403
        assert client.get(LABS, headers=_auth(receptionist)).status_code == 403
        assert (
            client.get(f"{PATIENTS}/{PATIENT}/consultations", headers=_auth(receptionist)).status_code
            == 403
        )

    def test_a_nurse_cannot_record_a_consultation_or_prescribe(
        self, client: TestClient, nurse: str
    ) -> None:
        assert (
            client.post(
                CONSULTATIONS,
                json={"patientId": PATIENT, "diagnosis": "Nurse-written"},
                headers=_auth(nurse),
            ).status_code
            == 403
        )
        assert (
            client.post(
                PRESCRIPTIONS,
                json={
                    "patientId": PATIENT,
                    "items": [
                        {
                            "medicine": "Etoricoxib 90 mg",
                            "dosage": "1 tablet",
                            "frequency": "Once daily",
                            "duration": "5 days",
                            "quantity": 5,
                        }
                    ],
                },
                headers=_auth(nurse),
            ).status_code
            == 403
        )

    def test_clinical_endpoints_require_authentication(self, client: TestClient) -> None:
        assert client.get(CONSULTATIONS).status_code == 401
        assert client.get(LABS).status_code == 401
        assert client.get(f"{PATIENTS}/{PATIENT}/vitals").status_code == 401
        assert client.get(f"{PATIENTS}/{PATIENT}/medical-history").status_code == 401

    def test_patient_360_withholds_clinical_sections_without_permission(
        self, client: TestClient, receptionist: str
    ) -> None:
        body = client.get(f"{PATIENTS}/{PATIENT}/360", headers=_auth(receptionist)).json()

        assert body["patient"]["name"] == "Raj Kumar"
        assert body["vitals"] == []
        assert body["medicalHistory"] == []
        assert body["consultations"] == []
        assert body["labs"] == []
        # Named, so the UI says "restricted" rather than implying "none".
        # A receptionist holds neither the clinical nor the rehab permission.
        assert set(body["restrictedSections"]) == {
            "vitals",
            "medicalHistory",
            "consultations",
            "labs",
            "rehabPlan",
            "rehabPlans",
            "therapySessions",
            "progress",
            "milestones",
            # A prescription lists medicines and doses, so it is gated too.
            "prescriptions",
        }


# ---------------------------------------------------------------------------
# Patient 360
# ---------------------------------------------------------------------------


class TestPatient360Clinical:
    def test_360_returns_real_clinical_data(
        self, client: TestClient, doctor: str, consultation
    ) -> None:
        created = consultation()
        body = client.get(f"{PATIENTS}/{PATIENT}/360", headers=_auth(doctor)).json()

        assert body["vitals"], "seeded observations"
        assert body["medicalHistory"], "seeded history"
        assert body["appointments"], "seeded appointments"
        assert body["prescriptions"], "seeded prescriptions"
        assert body["labs"], "seeded lab results"
        assert any(c["id"] == created["id"] for c in body["consultations"])

        # A doctor holds the clinical permissions but not billing.view, so the
        # invoices section is withheld and says so rather than reading empty.
        assert body["restrictedSections"] == ["invoices"]
        # Only genuinely unbuilt modules remain pending.
        # Every section the frontend shows is real as of Step 11.
        assert body["pendingModules"] == []

    def test_history_entry_appears_in_patient_360(self, client: TestClient, doctor: str) -> None:
        created = client.post(
            f"{PATIENTS}/{PATIENT}/medical-history",
            json={"type": "Injury", "title": "Minor calf strain during rehabilitation"},
            headers=_auth(doctor),
        ).json()

        body = client.get(f"{PATIENTS}/{PATIENT}/360", headers=_auth(doctor)).json()
        assert any(e["id"] == created["id"] for e in body["medicalHistory"])
