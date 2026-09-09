"""Nursing tests: wards, beds, admissions, tasks, vitals and discharge.

Runs against real PostgreSQL with the demo data seeded:

    python seed.py && python seed_patients.py && python seed_appointments.py
    python seed_clinical.py && python seed_rehab.py && python seed_nursing.py

Most tests build their own ward and beds through the API rather than leaning on
the seeded ward layout, so they assert behaviour rather than fixtures. Every
test that writes cleans up after itself, and the module fixture puts the seeded
beds, admissions, tasks and patient statuses back exactly as it found them.
"""

from __future__ import annotations

import threading
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.config import settings
from app.core.enums import AdmissionStatus
from app.models import Patient, User, Vitals
from app.models.ward import Admission, Bed, DischargeChecklistItem, NursingTask, Ward

DEMO_PASSWORD = "Rehab@123"

WARDS = "/api/wards"
BEDS = "/api/beds"
ADMISSIONS = "/api/admissions"
NURSING = "/api/nursing"
PATIENTS = "/api/patients"

#: Andheri West outpatients, free to be admitted by a test.
ADMITTABLE = ("PT-10277", "PT-10341", "PT-10372")
#: A Powai patient — used to prove a bed cannot cross a branch boundary.
OTHER_BRANCH_PATIENT = "PT-10315"


def _token(client: TestClient, email: str) -> str:
    response = client.post(
        "/api/auth/login", json={"email": email, "password": DEMO_PASSWORD, "remember": False}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _unique(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6].upper()}"


def _clinic_today() -> date:
    """The date the API stamps, which is the clinic's rather than the runner's.

    Asserting `date.today()` would pass in Mumbai and fail on a UTC build agent
    after 18:30, because the two are on different days by then.
    """
    return datetime.now(settings.clinic_tz).date()


@pytest.fixture(scope="module")
def seeded() -> None:
    from app.core.database import SessionLocal, check_database_connection

    ok, _ = check_database_connection()
    if not ok:
        pytest.skip("PostgreSQL is not reachable")

    with SessionLocal() as db:
        have = all(
            db.execute(select(model).limit(1)).scalar_one_or_none() is not None
            for model in (User, Patient, Ward, Bed)
        )
    if not have:
        pytest.skip("Demo data not seeded — run seed.py, seed_patients.py and seed_nursing.py")


@pytest.fixture(autouse=True)
def _no_leaked_ward_rows(seeded: None):
    """Delete every ward row a test writes and restore what it moved.

    Per test rather than per module: a stay outlives the request that created
    it, so an admission left behind by one test would make the next one's
    admission fail as "already admitted". Each test therefore starts from the
    seeded ward exactly as the last one found it.
    """
    from app.core.database import SessionLocal

    # Children before parents: a checklist item references an admission, which
    # references a bed, which references a ward.
    created = (DischargeChecklistItem, NursingTask, Admission, Bed, Ward, Vitals)

    with SessionLocal() as db:
        before = {m: list(db.execute(select(m.id)).scalars()) for m in created}
        # Bed status, occupancy, task completion and patient status all move
        # during the run, so each is snapshotted and put back.
        bed_state = {
            row.id: (row.status, row.patient_id, row.reserved_for)
            for row in db.execute(select(Bed)).scalars()
        }
        admission_state = {
            row.id: (row.status, row.discharge_date)
            for row in db.execute(select(Admission)).scalars()
        }
        task_state = {
            row.id: (row.done, row.completed_by, row.completed_at)
            for row in db.execute(select(NursingTask)).scalars()
        }
        item_state = {
            row.id: (row.completed, row.completed_by, row.completed_at)
            for row in db.execute(select(DischargeChecklistItem)).scalars()
        }
        patient_state = dict(db.execute(select(Patient.id, Patient.status)).all())

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

        for bed in db.execute(select(Bed)).scalars():
            if bed.id in bed_state:
                bed.status, bed.patient_id, bed.reserved_for = bed_state[bed.id]
        for admission in db.execute(select(Admission)).scalars():
            if admission.id in admission_state:
                admission.status, admission.discharge_date = admission_state[admission.id]
        for task in db.execute(select(NursingTask)).scalars():
            if task.id in task_state:
                task.done, task.completed_by, task.completed_at = task_state[task.id]
        for item in db.execute(select(DischargeChecklistItem)).scalars():
            if item.id in item_state:
                item.completed, item.completed_by, item.completed_at = item_state[item.id]
        for patient in db.execute(select(Patient)).scalars():
            if patient.id in patient_state:
                patient.status = patient_state[patient.id]
        db.commit()


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def nurse(client: TestClient, seeded: None) -> str:
    return _token(client, "nurse@rehab.com")


@pytest.fixture(scope="module")
def admin(client: TestClient, seeded: None) -> str:
    return _token(client, "admin@rehab.com")


@pytest.fixture(scope="module")
def doctor(client: TestClient, seeded: None) -> str:
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def pharmacist(client: TestClient, seeded: None) -> str:
    return _token(client, "pharmacy@rehab.com")


@pytest.fixture(scope="module")
def other_branch_doctor(client: TestClient, seeded: None) -> str:
    """Powai's doctor — holds `beds.view`, but only for their own site.

    Powai's receptionist would read more naturally here, but that account is
    seeded `pending` on purpose, so it cannot sign in at all.
    """
    return _token(client, "priya.nair@rehab.com")


# ---------------------------------------------------------------------------
# Ward and bed fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def ward(client: TestClient, nurse: str) -> dict:
    response = client.post(WARDS, json={"name": _unique("Testcase Ward")}, headers=_auth(nurse))
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def bed(client: TestClient, nurse: str, ward: dict):
    def _create(**overrides) -> dict:
        payload = {
            "wardId": ward["id"],
            "bedNumber": _unique("T"),
            "room": "T-1",
            "type": "General",
            "dailyRate": "1400.00",
        }
        payload.update(overrides)
        response = client.post(BEDS, json=payload, headers=_auth(nurse))
        assert response.status_code == 201, response.text
        return response.json()

    return _create


@pytest.fixture
def admit(client: TestClient, nurse: str):
    def _admit(patient_id: str, bed_row: dict, **overrides) -> dict:
        payload = {"patientId": patient_id, "bedId": bed_row["id"]}
        payload.update(overrides)
        response = client.post(ADMISSIONS, json=payload, headers=_auth(nurse))
        assert response.status_code == 201, response.text
        return response.json()

    return _admit


def _tick_whole_checklist(client: TestClient, token: str, admission: dict) -> dict:
    body = admission
    for item in admission["checklist"]:
        response = client.patch(
            f"{ADMISSIONS}/checklist/{item['id']}", json={"done": True}, headers=_auth(token)
        )
        assert response.status_code == 200, response.text
        body = response.json()
    return body


# ---------------------------------------------------------------------------
# The bed board
# ---------------------------------------------------------------------------


class TestBedBoard:
    def test_the_board_lists_beds_with_their_ward(
        self, client: TestClient, nurse: str, bed
    ) -> None:
        created = bed()
        rows = client.get(BEDS, headers=_auth(nurse)).json()

        mine = next(row for row in rows if row["id"] == created["id"])
        assert mine["ward"] == created["ward"]
        assert mine["status"] == "Available"
        assert mine["patientName"] is None

    def test_the_summary_agrees_with_the_board(self, client: TestClient, nurse: str) -> None:
        rows = client.get(BEDS, headers=_auth(nurse)).json()
        summary = client.get(f"{BEDS}/summary", headers=_auth(nurse)).json()

        assert summary["total"] == len(rows)
        for state, key in (
            ("Occupied", "occupied"),
            ("Available", "available"),
            ("Reserved", "reserved"),
            ("Cleaning", "cleaning"),
        ):
            assert summary[key] == sum(1 for row in rows if row["status"] == state)

        expected = round(summary["occupied"] / summary["total"] * 100) if summary["total"] else 0
        assert summary["occupancyRate"] == expected

    def test_beds_can_be_filtered_by_ward_and_status(
        self, client: TestClient, nurse: str, ward: dict, bed
    ) -> None:
        bed()
        bed(type="ICU")

        rows = client.get(BEDS, params={"ward": ward["id"]}, headers=_auth(nurse)).json()
        assert len(rows) == 2
        assert {row["type"] for row in rows} == {"General", "ICU"}

        icu = client.get(
            BEDS, params={"ward": ward["id"], "type": "ICU"}, headers=_auth(nurse)
        ).json()
        assert [row["type"] for row in icu] == ["ICU"]

        available = client.get(
            BEDS, params={"ward": ward["id"], "status": "Available"}, headers=_auth(nurse)
        ).json()
        assert len(available) == 2

    def test_a_ward_from_another_branch_is_not_visible(
        self, client: TestClient, ward: dict, other_branch_doctor: str
    ) -> None:
        """404 rather than 403 — a 403 would confirm the ward exists."""
        response = client.get(
            BEDS, params={"ward": ward["id"]}, headers=_auth(other_branch_doctor)
        )
        assert response.status_code == 404

        wards = client.get(WARDS, headers=_auth(other_branch_doctor)).json()
        assert ward["id"] not in {row["id"] for row in wards}

    def test_a_pharmacist_cannot_read_the_bed_board(
        self, client: TestClient, pharmacist: str
    ) -> None:
        assert client.get(BEDS, headers=_auth(pharmacist)).status_code == 403

    def test_a_doctor_cannot_change_a_bed(
        self, client: TestClient, doctor: str, bed
    ) -> None:
        created = bed()
        response = client.patch(
            f"{BEDS}/{created['id']}/status", json={"status": "Cleaning"}, headers=_auth(doctor)
        )
        assert response.status_code == 403


class TestBedStatus:
    def test_housekeeping_can_move_a_bed(self, client: TestClient, nurse: str, bed) -> None:
        created = bed()
        response = client.patch(
            f"{BEDS}/{created['id']}/status", json={"status": "Cleaning"}, headers=_auth(nurse)
        )
        assert response.status_code == 200
        assert response.json()["status"] == "Cleaning"

    def test_reserving_records_who_the_bed_is_held_for(
        self, client: TestClient, nurse: str, bed
    ) -> None:
        created = bed()
        response = client.patch(
            f"{BEDS}/{created['id']}/status",
            json={"status": "Reserved", "reservedFor": "Nikhil Bharadwaj (admission 25 Aug)"},
            headers=_auth(nurse),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "Reserved"
        # The board shows the holder in the name slot, as the mock did.
        assert body["patientName"] == "Nikhil Bharadwaj (admission 25 Aug)"

    def test_occupied_cannot_be_set_from_the_board(
        self, client: TestClient, nurse: str, bed
    ) -> None:
        """Occupancy is a consequence of an admission, never an assertion."""
        created = bed()
        response = client.patch(
            f"{BEDS}/{created['id']}/status", json={"status": "Occupied"}, headers=_auth(nurse)
        )
        assert response.status_code == 422
        assert response.json()["code"] == "occupancy_not_settable"

    def test_an_occupied_bed_cannot_be_moved(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        admit(ADMITTABLE[0], created)

        response = client.patch(
            f"{BEDS}/{created['id']}/status", json={"status": "Available"}, headers=_auth(nurse)
        )
        assert response.status_code == 409
        assert response.json()["code"] == "bed_occupied"

    def test_leaving_a_reservation_clears_the_holder(
        self, client: TestClient, nurse: str, bed
    ) -> None:
        created = bed()
        client.patch(
            f"{BEDS}/{created['id']}/status",
            json={"status": "Reserved", "reservedFor": "Someone"},
            headers=_auth(nurse),
        )
        body = client.patch(
            f"{BEDS}/{created['id']}/status", json={"status": "Available"}, headers=_auth(nurse)
        ).json()
        assert body["patientName"] is None


# ---------------------------------------------------------------------------
# Admission
# ---------------------------------------------------------------------------


class TestAdmission:
    def test_admitting_occupies_the_bed_and_builds_the_checklist(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        admission = admit(ADMITTABLE[0], created)

        assert admission["status"] == "Admitted"
        assert admission["bed"] == created["bed"]
        assert admission["admissionDate"] == _clinic_today().isoformat()
        # The frontend's BASE_CHECKLIST is six mandatory lines.
        assert len(admission["checklist"]) == 6
        assert admission["checklistComplete"] is False
        assert admission["checklistProgress"] == 0

        board = client.get(f"{BEDS}", params={"ward": created["wardId"]}, headers=_auth(nurse)).json()
        row = next(r for r in board if r["id"] == created["id"])
        assert row["status"] == "Occupied"
        assert row["patientId"] == ADMITTABLE[0]
        assert row["admissionId"] == admission["id"]
        assert row["since"] == admission["admissionDate"]

    def test_admission_moves_the_patient_to_admitted_ipd(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        admit(ADMITTABLE[0], created)

        patient = client.get(f"{PATIENTS}/{ADMITTABLE[0]}", headers=_auth(nurse)).json()
        assert patient["status"] == "Admitted - IPD"
        assert patient["bed"] == created["bed"]
        assert patient["ward"] == created["ward"]
        assert patient["admittedOn"] == _clinic_today().isoformat()

    def test_admitted_by_is_the_caller_not_the_request(
        self, client: TestClient, nurse: str, bed
    ) -> None:
        """A forged `admittedBy` is ignored: identity comes from the token."""
        created = bed()
        response = client.post(
            ADMISSIONS,
            json={
                "patientId": ADMITTABLE[0],
                "bedId": created["id"],
                "admittedBy": "Dr. Somebody Else",
            },
            headers=_auth(nurse),
        )
        assert response.status_code == 201
        assert response.json()["admittedBy"] == "Sister Anita Fernandes"

    def test_a_second_admission_to_the_same_bed_is_refused(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        admit(ADMITTABLE[0], created)

        response = client.post(
            ADMISSIONS,
            json={"patientId": ADMITTABLE[1], "bedId": created["id"]},
            headers=_auth(nurse),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "bed_unavailable"

    def test_a_patient_cannot_hold_two_beds(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        first = bed()
        second = bed()
        admit(ADMITTABLE[0], first)

        response = client.post(
            ADMISSIONS,
            json={"patientId": ADMITTABLE[0], "bedId": second["id"]},
            headers=_auth(nurse),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "already_admitted"

    def test_a_reserved_bed_can_be_admitted_into(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        """A reservation exists to become an admission, so it is not a blocker."""
        created = bed()
        client.patch(
            f"{BEDS}/{created['id']}/status",
            json={"status": "Reserved", "reservedFor": "Expected admission"},
            headers=_auth(nurse),
        )
        admission = admit(ADMITTABLE[0], created)
        assert admission["status"] == "Admitted"

    def test_a_bed_being_cleaned_cannot_be_admitted_into(
        self, client: TestClient, nurse: str, bed
    ) -> None:
        created = bed()
        client.patch(
            f"{BEDS}/{created['id']}/status", json={"status": "Cleaning"}, headers=_auth(nurse)
        )
        response = client.post(
            ADMISSIONS,
            json={"patientId": ADMITTABLE[0], "bedId": created["id"]},
            headers=_auth(nurse),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "bed_unavailable"

    def test_a_patient_cannot_be_admitted_to_another_branchs_bed(
        self, client: TestClient, nurse: str, bed
    ) -> None:
        created = bed()
        response = client.post(
            ADMISSIONS,
            json={"patientId": OTHER_BRANCH_PATIENT, "bedId": created["id"]},
            headers=_auth(nurse),
        )
        # The patient is invisible to this nurse, so the request never reaches
        # the branch check — a 404 rather than a leak.
        assert response.status_code == 404

    def test_an_expected_discharge_before_admission_is_rejected(
        self, client: TestClient, nurse: str, bed
    ) -> None:
        created = bed()
        response = client.post(
            ADMISSIONS,
            json={
                "patientId": ADMITTABLE[0],
                "bedId": created["id"],
                "admissionDate": _clinic_today().isoformat(),
                "expectedDischarge": (_clinic_today() - timedelta(days=1)).isoformat(),
            },
            headers=_auth(nurse),
        )
        assert response.status_code == 422

    def test_a_doctor_cannot_admit(self, client: TestClient, doctor: str, bed) -> None:
        created = bed()
        response = client.post(
            ADMISSIONS,
            json={"patientId": ADMITTABLE[0], "bedId": created["id"]},
            headers=_auth(doctor),
        )
        assert response.status_code == 403

    def test_an_admission_from_another_branch_is_not_visible(
        self, client: TestClient, other_branch_doctor: str, bed, admit
    ) -> None:
        created = bed()
        admission = admit(ADMITTABLE[0], created)

        response = client.get(
            f"{ADMISSIONS}/{admission['id']}", headers=_auth(other_branch_doctor)
        )
        assert response.status_code == 404

    def test_concurrent_bed_assignment(self, client: TestClient, nurse: str, bed) -> None:
        """Two staff, one bed, at the same instant: one wins, one is refused.

        Without `FOR UPDATE` both would read the bed as Available, both would
        pass the check, and the bed would carry two active admissions.
        """
        from app.core.database import SessionLocal
        from app.core.errors import ConflictError
        from app.schemas.nursing import AdmissionCreate
        from app.services import nursing_service as service

        created = bed()
        permissions = ["patient.view", "beds.view", "beds.manage"]
        barrier = threading.Barrier(2)
        outcomes: list[str] = []
        guard = threading.Lock()

        def attempt(patient_id: str) -> None:
            with SessionLocal() as db:
                staff = db.execute(
                    select(User).where(User.email == "nurse@rehab.com")
                ).scalar_one()
                payload = AdmissionCreate(patientId=patient_id, bedId=created["id"])
                # Both threads reach the lock at the same moment.
                barrier.wait(timeout=10)
                try:
                    service.admit(
                        db, payload=payload, user=staff, permissions=permissions, ip=None
                    )
                    result = "ok"
                except ConflictError:
                    db.rollback()
                    result = "refused"
                except Exception as exc:  # pragma: no cover - surfaced on failure
                    db.rollback()
                    result = f"error: {exc}"
            with guard:
                outcomes.append(result)

        threads = [
            threading.Thread(target=attempt, args=(ADMITTABLE[0],)),
            threading.Thread(target=attempt, args=(ADMITTABLE[1],)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        assert sorted(outcomes) == ["ok", "refused"], outcomes

        with SessionLocal() as db:
            active = db.execute(
                select(Admission).where(
                    Admission.bed_id == uuid.UUID(created["id"]),
                    Admission.status == AdmissionStatus.ADMITTED,
                )
            ).scalars().all()
        assert len(active) == 1, "a bed must never hold two active admissions"


# ---------------------------------------------------------------------------
# The discharge checklist
# ---------------------------------------------------------------------------


class TestDischargeChecklist:
    def test_ticking_an_item_records_who_did_it(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        item = admission["checklist"][0]

        response = client.patch(
            f"{ADMISSIONS}/checklist/{item['id']}", json={"done": True}, headers=_auth(nurse)
        )
        assert response.status_code == 200
        body = response.json()

        ticked = next(row for row in body["checklist"] if row["id"] == item["id"])
        assert ticked["done"] is True
        assert ticked["completedBy"] == "Sister Anita Fernandes"
        assert ticked["completedAt"] is not None
        # Progress is the server's figure, not React's.
        assert body["checklistProgress"] == round(1 / 6 * 100)

    def test_unticking_clears_the_completer(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        item = admission["checklist"][0]

        client.patch(
            f"{ADMISSIONS}/checklist/{item['id']}", json={"done": True}, headers=_auth(nurse)
        )
        body = client.patch(
            f"{ADMISSIONS}/checklist/{item['id']}", json={"done": False}, headers=_auth(nurse)
        ).json()

        cleared = next(row for row in body["checklist"] if row["id"] == item["id"])
        assert cleared["done"] is False
        assert cleared["completedBy"] is None
        assert body["checklistProgress"] == 0

    def test_the_checklist_is_complete_only_when_every_item_is_ticked(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        body = _tick_whole_checklist(client, nurse, admission)

        assert body["checklistComplete"] is True
        assert body["checklistProgress"] == 100


class TestDischarge:
    def test_discharge_is_refused_while_the_checklist_is_outstanding(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        admission = admit(ADMITTABLE[0], created)

        response = client.post(
            f"{ADMISSIONS}/{admission['id']}/discharge", json={}, headers=_auth(nurse)
        )
        assert response.status_code == 422
        assert response.json()["code"] == "checklist_incomplete"

        # Nothing moved: the patient still holds the bed.
        board = client.get(BEDS, params={"ward": created["wardId"]}, headers=_auth(nurse)).json()
        assert board[0]["status"] == "Occupied"

    def test_discharge_releases_the_bed_and_closes_the_stay(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        admission = admit(ADMITTABLE[0], created)
        _tick_whole_checklist(client, nurse, admission)

        response = client.post(
            f"{ADMISSIONS}/{admission['id']}/discharge", json={}, headers=_auth(nurse)
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "Discharged"
        assert body["dischargeDate"] == _clinic_today().isoformat()

        board = client.get(BEDS, params={"ward": created["wardId"]}, headers=_auth(nurse)).json()
        row = board[0]
        # Cleaning by default: a bed someone has just left is not re-lettable.
        assert row["status"] == "Cleaning"
        assert row["patientName"] is None
        assert row["admissionId"] is None

        patient = client.get(f"{PATIENTS}/{ADMITTABLE[0]}", headers=_auth(nurse)).json()
        assert patient["status"] == "Discharged"
        assert patient["bed"] is None

    def test_the_bed_can_be_released_straight_to_available(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        admission = admit(ADMITTABLE[0], created)
        _tick_whole_checklist(client, nurse, admission)

        client.post(
            f"{ADMISSIONS}/{admission['id']}/discharge",
            json={"bedStatus": "Available"},
            headers=_auth(nurse),
        )
        board = client.get(BEDS, params={"ward": created["wardId"]}, headers=_auth(nurse)).json()
        assert board[0]["status"] == "Available"

    def test_a_bed_cannot_be_left_occupied_by_a_discharge(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        _tick_whole_checklist(client, nurse, admission)

        response = client.post(
            f"{ADMISSIONS}/{admission['id']}/discharge",
            json={"bedStatus": "Occupied"},
            headers=_auth(nurse),
        )
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_bed_status"

    def test_discharging_twice_is_refused(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        _tick_whole_checklist(client, nurse, admission)
        client.post(f"{ADMISSIONS}/{admission['id']}/discharge", json={}, headers=_auth(nurse))

        response = client.post(
            f"{ADMISSIONS}/{admission['id']}/discharge", json={}, headers=_auth(nurse)
        )
        assert response.status_code == 409
        assert response.json()["code"] == "already_discharged"

    def test_a_discharge_date_before_the_admission_is_rejected(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        admission = admit(ADMITTABLE[0], created)
        _tick_whole_checklist(client, nurse, admission)

        response = client.post(
            f"{ADMISSIONS}/{admission['id']}/discharge",
            json={"dischargeDate": (_clinic_today() - timedelta(days=3)).isoformat()},
            headers=_auth(nurse),
        )
        assert response.status_code == 422

        # The refusal left the bed exactly as it was.
        board = client.get(BEDS, params={"ward": created["wardId"]}, headers=_auth(nurse)).json()
        assert board[0]["status"] == "Occupied"

    def test_beginning_a_discharge_keeps_the_bed(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        admission = admit(ADMITTABLE[0], created)

        response = client.post(
            f"{ADMISSIONS}/{admission['id']}/discharge-pending", headers=_auth(nurse)
        )
        assert response.status_code == 200
        assert response.json()["status"] == "Discharge Pending"

        board = client.get(BEDS, params={"ward": created["wardId"]}, headers=_auth(nurse)).json()
        assert board[0]["status"] == "Occupied", "the patient has not left yet"

    def test_a_freed_bed_can_be_admitted_into_again(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        created = bed()
        first = admit(ADMITTABLE[0], created)
        _tick_whole_checklist(client, nurse, first)
        client.post(
            f"{ADMISSIONS}/{first['id']}/discharge",
            json={"bedStatus": "Available"},
            headers=_auth(nurse),
        )

        second = admit(ADMITTABLE[1], created)
        assert second["status"] == "Admitted"


# ---------------------------------------------------------------------------
# Nursing tasks
# ---------------------------------------------------------------------------


class TestNursingTasks:
    def test_a_nurse_reads_the_task_list(self, client: TestClient, nurse: str) -> None:
        response = client.get(f"{NURSING}/tasks", headers=_auth(nurse))
        assert response.status_code == 200
        rows = response.json()
        assert rows, "the seed provides nursing tasks"
        assert {"id", "patientName", "type", "label", "due", "priority", "done"} <= set(rows[0])

    def test_a_doctor_cannot_read_nursing_tasks(self, client: TestClient, doctor: str) -> None:
        assert client.get(f"{NURSING}/tasks", headers=_auth(doctor)).status_code == 403

    def test_completing_a_task_stamps_the_caller(self, client: TestClient, nurse: str) -> None:
        pending = client.get(f"{NURSING}/tasks", params={"done": False}, headers=_auth(nurse)).json()
        task = pending[0]

        response = client.post(
            f"{NURSING}/tasks/{task['id']}/complete", headers=_auth(nurse)
        )
        assert response.status_code == 200
        body = response.json()
        assert body["done"] is True
        assert body["completedBy"] == "Sister Anita Fernandes"
        assert body["completedAt"] is not None

    def test_a_forged_completed_by_is_ignored(self, client: TestClient, nurse: str) -> None:
        """`completed_by` is never read from the request."""
        pending = client.get(f"{NURSING}/tasks", params={"done": False}, headers=_auth(nurse)).json()
        task = pending[0]

        body = client.patch(
            f"{NURSING}/tasks/{task['id']}",
            json={"done": True, "completedBy": "Dr. Somebody Else"},
            headers=_auth(nurse),
        ).json()
        assert body["completedBy"] == "Sister Anita Fernandes"

    def test_reopening_clears_the_completer(self, client: TestClient, nurse: str) -> None:
        pending = client.get(f"{NURSING}/tasks", params={"done": False}, headers=_auth(nurse)).json()
        task = pending[0]

        client.post(f"{NURSING}/tasks/{task['id']}/complete", headers=_auth(nurse))
        body = client.post(f"{NURSING}/tasks/{task['id']}/reopen", headers=_auth(nurse)).json()

        assert body["done"] is False
        assert body["completedBy"] is None
        assert body["completedAt"] is None

    def test_tasks_can_be_filtered_by_type(self, client: TestClient, nurse: str) -> None:
        rows = client.get(
            f"{NURSING}/tasks", params={"type": "Medication"}, headers=_auth(nurse)
        ).json()
        assert rows
        assert {row["type"] for row in rows} == {"Medication"}

    def test_recurring_work_keeps_its_phrase_and_is_never_overdue(
        self, client: TestClient, nurse: str
    ) -> None:
        """"Hourly" and "As needed" carry no due time, so they cannot be late."""
        rows = client.get(f"{NURSING}/tasks", headers=_auth(nurse)).json()
        recurring = [row for row in rows if row["due"] in {"Hourly", "As needed"}]
        assert recurring, "the seed carries recurring tasks"
        assert all(row["overdue"] is False for row in recurring)


# ---------------------------------------------------------------------------
# The vitals round
# ---------------------------------------------------------------------------


class TestWardVitals:
    def test_vitals_are_recorded_against_the_admission(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())

        response = client.post(
            f"{NURSING}/admissions/{admission['id']}/vitals",
            json={"systolic": 128, "diastolic": 82, "heartRate": 74, "spo2": 98},
            headers=_auth(nurse),
        )
        assert response.status_code == 201
        body = response.json()
        assert body["systolic"] == 128
        assert body["recordedBy"] == "Sister Anita Fernandes"

    def test_the_reading_lands_in_the_one_vitals_table(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        """Nursing does not keep a second copy — Step 7's table is the only one."""
        admission = admit(ADMITTABLE[0], bed())
        client.post(
            f"{NURSING}/admissions/{admission['id']}/vitals",
            json={"systolic": 131, "diastolic": 84, "heartRate": 77, "spo2": 97},
            headers=_auth(nurse),
        )

        history = client.get(
            f"{PATIENTS}/{ADMITTABLE[0]}/vitals", headers=_auth(nurse)
        ).json()
        assert history[0]["systolic"] == 131

    def test_vitals_cannot_be_recorded_on_a_closed_stay(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        _tick_whole_checklist(client, nurse, admission)
        client.post(f"{ADMISSIONS}/{admission['id']}/discharge", json={}, headers=_auth(nurse))

        response = client.post(
            f"{NURSING}/admissions/{admission['id']}/vitals",
            json={"systolic": 120, "diastolic": 80},
            headers=_auth(nurse),
        )
        assert response.status_code == 422
        assert response.json()["code"] == "not_admitted"

    def test_a_nurse_cannot_record_vitals_on_another_branchs_stay(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        """Holding `vitals.record` is not a licence to write for any patient."""
        from app.core.database import SessionLocal

        admission = admit(ADMITTABLE[0], bed())

        # Move the patient out of this nurse's branch behind the API's back, so
        # the only thing standing between the nurse and the record is scoping.
        with SessionLocal() as db:
            patient = db.execute(
                select(Patient).where(Patient.patient_number == ADMITTABLE[0])
            ).scalar_one()
            original = patient.branch_id
            other = db.execute(
                select(Patient.branch_id).where(Patient.patient_number == OTHER_BRANCH_PATIENT)
            ).scalar_one()
            patient.branch_id = other
            db.commit()

        try:
            response = client.post(
                f"{NURSING}/admissions/{admission['id']}/vitals",
                json={"systolic": 120, "diastolic": 80},
                headers=_auth(nurse),
            )
            assert response.status_code == 404
        finally:
            with SessionLocal() as db:
                patient = db.execute(
                    select(Patient).where(Patient.patient_number == ADMITTABLE[0])
                ).scalar_one()
                patient.branch_id = original
                db.commit()

    def test_an_impossible_reading_is_refused(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        response = client.post(
            f"{NURSING}/admissions/{admission['id']}/vitals",
            json={"systolic": 900, "diastolic": 80},
            headers=_auth(nurse),
        )
        assert response.status_code == 422

    def test_an_empty_reading_is_refused(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        response = client.post(
            f"{NURSING}/admissions/{admission['id']}/vitals", json={}, headers=_auth(nurse)
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Inpatients and the dashboard
# ---------------------------------------------------------------------------


class TestNurseDashboard:
    def test_only_a_nurse_reads_the_nurse_dashboard(
        self, client: TestClient, nurse: str, doctor: str
    ) -> None:
        assert client.get(f"{NURSING}/dashboard", headers=_auth(nurse)).status_code == 200
        assert client.get(f"{NURSING}/dashboard", headers=_auth(doctor)).status_code == 403

    def test_the_figures_come_from_the_database(self, client: TestClient, nurse: str) -> None:
        board = client.get(BEDS, headers=_auth(nurse)).json()
        tasks = client.get(f"{NURSING}/tasks", headers=_auth(nurse)).json()
        stays = client.get(f"{NURSING}/ipd-patients", headers=_auth(nurse)).json()

        body = client.get(f"{NURSING}/dashboard", headers=_auth(nurse)).json()

        assert body["beds"]["total"] == len(board)
        assert body["beds"]["occupied"] == sum(1 for r in board if r["status"] == "Occupied")
        assert body["pendingTasks"] == sum(1 for t in tasks if not t["done"])
        assert body["vitalsPending"] == sum(
            1 for t in tasks if not t["done"] and t["type"] == "Vitals"
        )
        assert body["medicationsDue"] == sum(
            1 for t in tasks if not t["done"] and t["type"] == "Medication"
        )
        assert body["admittedPatients"] == sum(1 for s in stays if s["status"] == "Admitted")
        assert body["dischargePending"] == sum(
            1 for s in stays if s["status"] == "Discharge Pending"
        )

    def test_the_dashboard_follows_a_new_admission(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        before = client.get(f"{NURSING}/dashboard", headers=_auth(nurse)).json()
        admit(ADMITTABLE[0], bed())
        after = client.get(f"{NURSING}/dashboard", headers=_auth(nurse)).json()

        assert after["admittedPatients"] == before["admittedPatients"] + 1
        assert after["beds"]["occupied"] == before["beds"]["occupied"] + 1

    def test_inpatients_are_the_open_stays(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        rows = client.get(f"{NURSING}/ipd-patients", headers=_auth(nurse)).json()

        assert admission["id"] in {row["id"] for row in rows}
        assert all(row["status"] != "Discharged" for row in rows)

    def test_a_discharged_stay_leaves_the_inpatient_list(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        _tick_whole_checklist(client, nurse, admission)
        client.post(f"{ADMISSIONS}/{admission['id']}/discharge", json={}, headers=_auth(nurse))

        rows = client.get(f"{NURSING}/ipd-patients", headers=_auth(nurse)).json()
        assert admission["id"] not in {row["id"] for row in rows}


# ---------------------------------------------------------------------------
# Patient 360
# ---------------------------------------------------------------------------


class TestPatient360Admissions:
    def test_the_record_carries_the_stay_and_its_checklist(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        body = client.get(f"{PATIENTS}/{ADMITTABLE[0]}/360", headers=_auth(nurse)).json()

        assert body["currentAdmission"]["id"] == admission["id"]
        assert len(body["currentAdmission"]["checklist"]) == 6
        assert admission["id"] in {row["id"] for row in body["admissions"]}
        # The module exists now, so it is no longer named as pending.
        assert "admissions" not in body["pendingModules"]

    def test_a_discharged_stay_stays_in_the_history(
        self, client: TestClient, nurse: str, bed, admit
    ) -> None:
        admission = admit(ADMITTABLE[0], bed())
        _tick_whole_checklist(client, nurse, admission)
        client.post(f"{ADMISSIONS}/{admission['id']}/discharge", json={}, headers=_auth(nurse))

        body = client.get(f"{PATIENTS}/{ADMITTABLE[0]}/360", headers=_auth(nurse)).json()
        assert body["currentAdmission"] is None
        assert admission["id"] in {row["id"] for row in body["admissions"]}
