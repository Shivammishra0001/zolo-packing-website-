"""Appointment module tests.

Runs against real PostgreSQL with the demo data seeded:

    python seed.py && python seed_patients.py && python seed_appointments.py

Every test that books a slot cleans up after itself, so the seeded diary stays
exactly as the frontend screens expect it.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import Appointment, Patient, User

DEMO_PASSWORD = "Rehab@123"
APPOINTMENTS = "/api/appointments"

#: Far enough ahead that no seeded row occupies these slots.
FUTURE = date(2027, 3, 15)


def _token(client: TestClient, email: str) -> str:
    response = client.post(
        "/api/auth/login", json={"email": email, "password": DEMO_PASSWORD, "remember": False}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _cleanup(uuids: list[str]) -> None:
    from app.core.database import SessionLocal

    if not uuids:
        return
    with SessionLocal() as db:
        db.execute(delete(Appointment).where(Appointment.id.in_(uuids)))
        db.commit()


@pytest.fixture(autouse=True)
def _no_leaked_notifications():
    """Checking a patient in now alerts their clinician.

    The alert outlives the appointment that raised it — nothing cascades from
    `appointments` to `notifications` — so each test clears its own.
    """
    from app.core.database import SessionLocal
    from app.models import Notification

    with SessionLocal() as db:
        before = list(db.execute(select(Notification.id)).scalars())

    yield

    with SessionLocal() as db:
        statement = delete(Notification)
        if before:
            statement = statement.where(Notification.id.notin_(before))
        db.execute(statement)
        db.commit()


@pytest.fixture(scope="module")
def seeded() -> None:
    from app.core.database import SessionLocal, check_database_connection

    ok, _ = check_database_connection()
    if not ok:
        pytest.skip("PostgreSQL is not reachable")

    with SessionLocal() as db:
        has_users = db.execute(select(User).limit(1)).scalar_one_or_none()
        has_patients = db.execute(select(Patient).limit(1)).scalar_one_or_none()
        has_appointments = db.execute(select(Appointment).limit(1)).scalar_one_or_none()
    if not (has_users and has_patients and has_appointments):
        pytest.skip(
            "Demo data not seeded — run seed.py, seed_patients.py and seed_appointments.py"
        )


@pytest.fixture(scope="module")
def receptionist(client: TestClient, seeded: None) -> str:
    return _token(client, "reception@rehab.com")


@pytest.fixture(scope="module")
def doctor(client: TestClient, seeded: None) -> str:
    """Dr. Arjun Sharma — USR-1003, the doctor most seeded rows belong to."""
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def other_doctor(client: TestClient, seeded: None) -> str:
    """Dr. Sanjay Bhatt — USR-1010, deliberately not the seeded clinician."""
    return _token(client, "sanjay.bhatt@rehab.com")


@pytest.fixture(scope="module")
def pharmacist(client: TestClient, seeded: None) -> str:
    return _token(client, "pharmacy@rehab.com")


@pytest.fixture
def booked(client: TestClient, receptionist: str):
    """Book appointments and remove them afterwards."""
    created: list[str] = []

    def _book(**overrides) -> dict:
        payload = {
            "patientId": "PT-10248",
            "doctorId": "USR-1003",
            "date": FUTURE.isoformat(),
            "time": "09:00",
            "type": "Follow-up",
        }
        payload.update(overrides)
        response = client.post(APPOINTMENTS, json=payload, headers=_auth(receptionist))
        assert response.status_code == 201, response.text
        body = response.json()
        created.append(body["uuid"])
        return body

    yield _book
    _cleanup(created)


# ---------------------------------------------------------------------------
# 1. Creation
# ---------------------------------------------------------------------------


def test_create_appointment_returns_backend_generated_number(booked) -> None:
    """The appointment number comes from the backend, in the canonical format."""
    appointment = booked(time="08:00")

    assert appointment["id"].startswith(f"APT-{FUTURE.year}-")
    assert len(appointment["id"].rsplit("-", 1)[1]) == 5
    assert appointment["status"] == "Scheduled"
    assert appointment["doctor"] == "Dr. Arjun Sharma"
    assert appointment["patientName"] == "Raj Kumar"
    # The 30-minute default slot was applied.
    assert (appointment["time"], appointment["endTime"]) == ("08:00", "08:30")


def test_create_appointment_allocates_a_daily_token(booked) -> None:
    """Tokens are per-day and sequential, matching the reception board."""
    first = booked(time="08:00")
    second = booked(time="08:30")

    assert first["tokenNumber"] >= 1
    assert second["tokenNumber"] == first["tokenNumber"] + 1

    # A different day restarts its own run rather than continuing globally.
    next_day = booked(date=(FUTURE + timedelta(days=1)).isoformat(), time="08:00")
    assert next_day["tokenNumber"] == 1


def test_create_appointment_rejects_a_double_booking(
    client: TestClient, receptionist: str, booked
) -> None:
    """Two appointments cannot overlap for the same clinician."""
    booked(time="11:00")

    response = client.post(
        APPOINTMENTS,
        json={
            "patientId": "PT-10251",
            "doctorId": "USR-1003",
            "date": FUTURE.isoformat(),
            "time": "11:15",
            "type": "Follow-up",
        },
        headers=_auth(receptionist),
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "appointment_conflict"


def test_back_to_back_slots_are_not_a_conflict(booked) -> None:
    """09:00-09:30 and 09:30-10:00 are adjacent, not overlapping."""
    first = booked(time="13:00")
    second = booked(time="13:30")
    assert first["uuid"] != second["uuid"]


def test_double_booking_is_refused_by_the_database_too(
    client: TestClient, receptionist: str, booked
) -> None:
    """The exclusion constraint holds even when the API check is bypassed."""
    from sqlalchemy.exc import IntegrityError

    from app.core.database import SessionLocal
    from app.core.enums import AppointmentStatus, AppointmentType

    existing = booked(time="14:00")

    with SessionLocal() as db:
        row = db.execute(
            select(Appointment).where(Appointment.id == existing["uuid"])
        ).scalar_one()
        clash = Appointment(
            appointment_number="APT-2027-99999",
            patient_id=row.patient_id,
            doctor_id=row.doctor_id,
            appointment_date=row.appointment_date,
            start_time=row.start_time,
            end_time=row.end_time,
            appointment_type=AppointmentType.FOLLOW_UP,
            status=AppointmentStatus.SCHEDULED,
        )
        db.add(clash)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_create_requires_a_clinician(client: TestClient, receptionist: str) -> None:
    response = client.post(
        APPOINTMENTS,
        json={
            "patientId": "PT-10248",
            "date": FUTURE.isoformat(),
            "time": "07:00",
            "type": "Follow-up",
        },
        headers=_auth(receptionist),
    )
    assert response.status_code == 422


def test_create_rejects_a_clinician_with_the_wrong_role(
    client: TestClient, receptionist: str
) -> None:
    """A pharmacist cannot be booked as the doctor."""
    response = client.post(
        APPOINTMENTS,
        json={
            "patientId": "PT-10248",
            "doctorId": "USR-1006",
            "date": FUTURE.isoformat(),
            "time": "07:00",
            "type": "Follow-up",
        },
        headers=_auth(receptionist),
    )
    assert response.status_code == 422
    assert "not a doctor" in response.json()["detail"]


# ---------------------------------------------------------------------------
# 2. The state machine
# ---------------------------------------------------------------------------


def test_full_workflow_scheduled_to_completed(
    client: TestClient, receptionist: str, doctor: str, booked
) -> None:
    appointment = booked(time="15:00")
    identifier = appointment["uuid"]

    checked_in = client.post(
        f"{APPOINTMENTS}/{identifier}/check-in", headers=_auth(receptionist)
    )
    assert checked_in.status_code == 200, checked_in.text
    assert checked_in.json()["status"] == "Waiting"
    # The arrival time is stamped by the server, not sent by the client.
    assert checked_in.json()["checkedInAt"] is not None

    started = client.post(f"{APPOINTMENTS}/{identifier}/start", headers=_auth(doctor))
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "In Consultation"

    completed = client.post(f"{APPOINTMENTS}/{identifier}/complete", headers=_auth(doctor))
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "Completed"


def test_invalid_transition_returns_409(client: TestClient, doctor: str, booked) -> None:
    """A scheduled appointment cannot jump straight to completed."""
    appointment = booked(time="15:30")

    response = client.post(
        f"{APPOINTMENTS}/{appointment['uuid']}/complete", headers=_auth(doctor)
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "invalid_transition"


def test_completed_appointment_cannot_be_cancelled(
    client: TestClient, receptionist: str, doctor: str, booked
) -> None:
    appointment = booked(time="16:00")
    identifier = appointment["uuid"]

    client.post(f"{APPOINTMENTS}/{identifier}/check-in", headers=_auth(receptionist))
    client.post(f"{APPOINTMENTS}/{identifier}/start", headers=_auth(doctor))
    client.post(f"{APPOINTMENTS}/{identifier}/complete", headers=_auth(doctor))

    response = client.post(
        f"{APPOINTMENTS}/{identifier}/cancel", json={}, headers=_auth(receptionist)
    )
    assert response.status_code == 409


def test_status_cannot_be_set_through_update(
    client: TestClient, receptionist: str, booked
) -> None:
    """PUT ignores a client-supplied status — transitions go through workflow endpoints."""
    appointment = booked(time="17:00")

    response = client.put(
        f"{APPOINTMENTS}/{appointment['uuid']}",
        json={"status": "Completed", "notes": "Reschedule note"},
        headers=_auth(receptionist),
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "Scheduled"
    assert response.json()["notes"] == "Reschedule note"


def test_cancellation_frees_the_slot(client: TestClient, receptionist: str, booked) -> None:
    """Cancelling releases the time for rebooking, and keeps the row."""
    appointment = booked(time="18:00")

    cancelled = client.post(
        f"{APPOINTMENTS}/{appointment['uuid']}/cancel",
        json={"reason": "Patient travelling"},
        headers=_auth(receptionist),
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "Cancelled"
    assert "Patient travelling" in cancelled.json()["notes"]

    rebooked = booked(time="18:00", patientId="PT-10251")
    assert rebooked["status"] == "Scheduled"

    # The cancelled appointment is still retrievable — nothing was deleted.
    still_there = client.get(
        f"{APPOINTMENTS}/{appointment['uuid']}", headers=_auth(receptionist)
    )
    assert still_there.status_code == 200
    assert still_there.json()["status"] == "Cancelled"


def test_no_show_is_recorded(client: TestClient, receptionist: str, booked) -> None:
    appointment = booked(time="19:00")
    response = client.post(
        f"{APPOINTMENTS}/{appointment['uuid']}/no-show", headers=_auth(receptionist)
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "No Show"


def test_only_the_assigned_clinician_may_start(
    client: TestClient, receptionist: str, other_doctor: str, booked
) -> None:
    appointment = booked(time="19:30")
    identifier = appointment["uuid"]
    client.post(f"{APPOINTMENTS}/{identifier}/check-in", headers=_auth(receptionist))

    response = client.post(f"{APPOINTMENTS}/{identifier}/start", headers=_auth(other_doctor))
    assert response.status_code == 403
    assert response.json()["code"] == "not_your_appointment"


# ---------------------------------------------------------------------------
# 3. There is no hard delete
# ---------------------------------------------------------------------------


def test_delete_is_not_exposed(client: TestClient, receptionist: str, booked) -> None:
    appointment = booked(time="20:00")
    response = client.delete(
        f"{APPOINTMENTS}/{appointment['uuid']}", headers=_auth(receptionist)
    )
    assert response.status_code == 405


# ---------------------------------------------------------------------------
# 4. Visibility
# ---------------------------------------------------------------------------


def test_doctor_sees_only_their_own_diary_by_default(
    client: TestClient, doctor: str
) -> None:
    response = client.get(
        f"{APPOINTMENTS}?date=2026-08-24&limit=200", headers=_auth(doctor)
    )
    assert response.status_code == 200, response.text
    doctors = {row["doctor"] for row in response.json()["items"]}
    assert doctors == {"Dr. Arjun Sharma"}


def test_branch_scope_returns_the_whole_clinic_diary(
    client: TestClient, receptionist: str
) -> None:
    response = client.get(
        f"{APPOINTMENTS}?date=2026-08-24&scope=branch&limit=200",
        headers=_auth(receptionist),
    )
    assert response.status_code == 200, response.text
    doctors = {row["doctor"] for row in response.json()["items"]}
    assert len(doctors) > 1


def test_appointments_require_authentication(client: TestClient) -> None:
    assert client.get(APPOINTMENTS).status_code == 401


def test_pharmacist_cannot_view_appointments(client: TestClient, pharmacist: str) -> None:
    """The pharmacist role has no appointment.view permission."""
    response = client.get(APPOINTMENTS, headers=_auth(pharmacist))
    assert response.status_code == 403


def test_pharmacist_cannot_book(client: TestClient, pharmacist: str) -> None:
    response = client.post(
        APPOINTMENTS,
        json={
            "patientId": "PT-10248",
            "doctorId": "USR-1003",
            "date": FUTURE.isoformat(),
            "time": "07:30",
            "type": "Follow-up",
        },
        headers=_auth(pharmacist),
    )
    assert response.status_code == 403


def test_doctor_cannot_check_patients_in(client: TestClient, doctor: str, booked) -> None:
    """Check-in is a front-desk permission the doctor role does not hold."""
    appointment = booked(time="20:30")
    response = client.post(
        f"{APPOINTMENTS}/{appointment['uuid']}/check-in", headers=_auth(doctor)
    )
    assert response.status_code == 403


def test_unknown_appointment_is_404(client: TestClient, receptionist: str) -> None:
    import uuid as uuid_lib

    response = client.get(f"{APPOINTMENTS}/{uuid_lib.uuid4()}", headers=_auth(receptionist))
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# 5. Queue, history and rescheduling
# ---------------------------------------------------------------------------


def test_queue_exposes_checked_in_at_not_a_waiting_string(
    client: TestClient, receptionist: str
) -> None:
    """Waiting time is derived in the UI from this timestamp — never stored as text."""
    response = client.get(
        f"{APPOINTMENTS}?date=2026-08-24&scope=branch&status=Waiting&limit=200",
        headers=_auth(receptionist),
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert items, "the seeded diary has patients waiting"
    for row in items:
        assert row["checkedInAt"] is not None
        assert ":" in row["checkedInAt"] and len(row["checkedInAt"]) == 5


def test_patient_360_returns_real_appointments(
    client: TestClient, receptionist: str
) -> None:
    response = client.get("/api/patients/PT-10248/360", headers=_auth(receptionist))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["appointments"], "PT-10248 has seeded appointments"
    assert "appointments" not in body["pendingModules"]
    assert all(row["patientId"] == "PT-10248" for row in body["appointments"])


def test_rescheduling_to_another_day_reissues_the_token(
    client: TestClient, receptionist: str, booked
) -> None:
    appointment = booked(time="21:00")
    moved_to = FUTURE + timedelta(days=2)

    response = client.put(
        f"{APPOINTMENTS}/{appointment['uuid']}",
        json={"date": moved_to.isoformat(), "time": "09:00", "endTime": "09:30"},
        headers=_auth(receptionist),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["date"] == moved_to.isoformat()
    assert body["tokenNumber"] == 1


def test_rescheduling_onto_a_taken_slot_is_refused(
    client: TestClient, receptionist: str, booked
) -> None:
    booked(time="21:30")
    movable = booked(time="22:00")

    response = client.put(
        f"{APPOINTMENTS}/{movable['uuid']}",
        json={"time": "21:30", "endTime": "22:00"},
        headers=_auth(receptionist),
    )
    assert response.status_code == 409
    assert response.json()["code"] == "appointment_conflict"


def test_appointment_history_is_filterable_by_patient(
    client: TestClient, receptionist: str
) -> None:
    response = client.get(
        f"{APPOINTMENTS}?patient=PT-10290&scope=branch&limit=200",
        headers=_auth(receptionist),
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) >= 2, "PT-10290 has more than one seeded appointment"
    assert {row["patientId"] for row in items} == {"PT-10290"}
