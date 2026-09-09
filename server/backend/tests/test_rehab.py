"""Rehabilitation plan, milestone, therapy session and exercise tests.

Runs against real PostgreSQL with the demo data seeded:

    python seed.py && python seed_patients.py && python seed_appointments.py
    python seed_clinical.py && python seed_rehab.py

Every test that writes cleans up after itself, so a run leaves the seeded
rehabilitation data exactly as it found it.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import (
    ExerciseLibrary,
    Patient,
    RehabMilestone,
    RehabPlan,
    RehabProgressPoint,
    TherapySession,
    TherapySessionExercise,
    User,
)

DEMO_PASSWORD = "Rehab@123"
PLANS = "/api/rehab/plans"
SESSIONS = "/api/therapy/sessions"
EXERCISES = "/api/exercises"
PATIENTS = "/api/patients"

#: Raj Kumar — Meera Iyer's patient, with a seeded plan.
PATIENT = "PT-10248"
#: Amit Singh — Powai branch, so invisible to an Andheri West therapist.
OTHER_BRANCH_PATIENT = "PT-10263"
#: Simran Kaur — another of Meera Iyer's seeded plans. Used where a test needs
#: seeded data untouched by the plans these tests create for PT-10248.
SEEDED_PATIENT = "PT-10251"


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
            for model in (User, Patient, RehabPlan, ExerciseLibrary, TherapySession)
        )
    if not have:
        pytest.skip("Demo data not seeded — run seed_rehab.py")


@pytest.fixture(autouse=True, scope="module")
def _no_leaked_rehab_rows(seeded: None):
    """Remove every rehabilitation row this module writes."""
    from app.core.database import SessionLocal

    models = (
        TherapySessionExercise,
        TherapySession,
        RehabProgressPoint,
        RehabMilestone,
        RehabPlan,
        ExerciseLibrary,
    )

    def snapshot():
        with SessionLocal() as db:
            return {m: list(db.execute(select(m.id)).scalars()) for m in models}

    before = snapshot()
    yield
    with SessionLocal() as db:
        for model in models:
            keep = before[model]
            statement = delete(model)
            # An empty baseline needs an unconditional delete: `NOT IN (NULL)`
            # is NULL for every row and would silently match nothing.
            if keep:
                statement = statement.where(model.id.notin_(keep))
            db.execute(statement)
        db.commit()

    # Seeded plans cache values derived from sessions; restore them now that the
    # test sessions are gone, or a later run starts from skewed figures.
    from app.services import rehab_service

    with SessionLocal() as db:
        for plan in db.execute(select(RehabPlan)).scalars():
            rehab_service.recalculate(db, plan)
            db.add(plan)
        db.commit()


@pytest.fixture(scope="module")
def therapist(client: TestClient, seeded: None) -> str:
    """Meera Iyer — USR-1004, assigned to PT-10248's plan."""
    return _token(client, "therapist@rehab.com")


@pytest.fixture(scope="module")
def other_therapist(client: TestClient, seeded: None) -> str:
    """Kavya Reddy — USR-1011, same branch, a different caseload."""
    return _token(client, "kavya.reddy@rehab.com")


@pytest.fixture(scope="module")
def powai_therapist(client: TestClient, seeded: None) -> str:
    """Tanmay Joshi — USR-1012, the Powai branch."""
    return _token(client, "tanmay.joshi@rehab.com")


@pytest.fixture(scope="module")
def doctor(client: TestClient, seeded: None) -> str:
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def admin(client: TestClient, seeded: None) -> str:
    return _token(client, "admin@rehab.com")


@pytest.fixture(scope="module")
def pharmacist(client: TestClient, seeded: None) -> str:
    return _token(client, "pharmacy@rehab.com")


@pytest.fixture
def plan(client: TestClient, therapist: str):
    """Create a plan assigned to the signed-in therapist."""

    def _create(**overrides) -> dict:
        payload = {
            "patientId": PATIENT,
            "therapistId": "USR-1004",
            "title": "Test rehabilitation programme",
            "goal": "Restore full range of motion.",
            "startDate": date.today().isoformat(),
            "targetEndDate": (date.today() + timedelta(days=84)).isoformat(),
            "totalSessions": 12,
            "frequencyPerWeek": 3,
            "modalities": ["Manual therapy"],
        }
        payload.update(overrides)
        response = client.post(PLANS, json=payload, headers=_auth(therapist))
        assert response.status_code == 201, response.text
        return response.json()

    return _create


# ---------------------------------------------------------------------------
# Rehab plans
# ---------------------------------------------------------------------------


class TestRehabPlans:
    def test_create_rehab_plan(self, plan) -> None:
        body = plan()

        assert body["patientId"] == PATIENT
        assert body["patientName"] == "Raj Kumar"
        assert body["title"] == "Test rehabilitation programme"
        assert body["totalSessions"] == 12
        assert body["primaryTherapist"] == "Meera Iyer"
        assert body["status"] == "Active"
        # Progress is derived, so a brand-new plan has none.
        assert body["completedSessions"] == 0
        assert body["progressPercentage"] == 0

    def test_get_rehab_plan(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()
        response = client.get(f"{PLANS}/{created['id']}", headers=_auth(therapist))

        assert response.status_code == 200, response.text
        assert response.json()["id"] == created["id"]
        assert response.json()["goal"] == created["goal"]

    def test_update_rehab_plan(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()
        response = client.put(
            f"{PLANS}/{created['id']}",
            json={"title": "Revised programme", "totalSessions": 18},
            headers=_auth(therapist),
        )

        assert response.status_code == 200, response.text
        assert response.json()["title"] == "Revised programme"
        assert response.json()["totalSessions"] == 18
        assert response.json()["goal"] == created["goal"]

    def test_invalid_rehab_dates(self, client: TestClient, therapist: str) -> None:
        response = client.post(
            PLANS,
            json={
                "patientId": PATIENT,
                "therapistId": "USR-1004",
                "title": "Backwards programme",
                "startDate": "2026-10-01",
                "targetEndDate": "2026-09-01",
                "totalSessions": 12,
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 422

    def test_total_sessions_must_be_positive(self, client: TestClient, therapist: str) -> None:
        response = client.post(
            PLANS,
            json={
                "patientId": PATIENT,
                "therapistId": "USR-1004",
                "title": "Empty programme",
                "totalSessions": 0,
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 422

    def test_therapist_id_must_be_a_therapist(self, client: TestClient, doctor: str) -> None:
        """A doctor id in the therapist slot is refused, not trusted."""
        response = client.post(
            PLANS,
            json={
                "patientId": PATIENT,
                "therapistId": "USR-1003",
                "title": "Mis-assigned programme",
                "totalSessions": 12,
            },
            headers=_auth(doctor),
        )
        assert response.status_code == 422
        assert "not a therapist" in response.json()["detail"]

    def test_derived_progress_cannot_be_asserted(self, client: TestClient, therapist: str) -> None:
        """completedSessions and trend in the body are ignored, not honoured."""
        response = client.post(
            PLANS,
            json={
                "patientId": PATIENT,
                "therapistId": "USR-1004",
                "title": "Optimistic programme",
                "totalSessions": 12,
                "completedSessions": 11,
                "trend": "Ahead of Plan",
                "attendanceRate": 100,
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 201, response.text
        assert response.json()["completedSessions"] == 0
        assert response.json()["attendanceRate"] is None

    def test_total_cannot_drop_below_completed(
        self, client: TestClient, therapist: str, plan, session
    ) -> None:
        created = plan()
        made = session(created)
        client.post(f"{SESSIONS}/{made['uuid']}/complete", json={}, headers=_auth(therapist))

        response = client.put(
            f"{PLANS}/{created['id']}", json={"totalSessions": 0}, headers=_auth(therapist)
        )
        assert response.status_code == 422

    def test_started_plan_keeps_its_start_date(
        self, client: TestClient, therapist: str, plan, session
    ) -> None:
        created = plan(startDate=(date.today() - timedelta(days=10)).isoformat())
        made = session(created, date=(date.today() - timedelta(days=5)).isoformat())
        client.post(f"{SESSIONS}/{made['uuid']}/complete", json={}, headers=_auth(therapist))

        response = client.put(
            f"{PLANS}/{created['id']}",
            json={"startDate": date.today().isoformat()},
            headers=_auth(therapist),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "plan_already_started"


class TestPlanLifecycle:
    def test_plan_hold_and_resume(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()

        held = client.post(f"{PLANS}/{created['id']}/hold", headers=_auth(therapist))
        assert held.status_code == 200, held.text
        assert held.json()["status"] == "On Hold"

        resumed = client.post(f"{PLANS}/{created['id']}/resume", headers=_auth(therapist))
        assert resumed.status_code == 200, resumed.text
        assert resumed.json()["status"] == "Active"

    def test_sessions_are_refused_against_a_plan_on_hold(
        self, client: TestClient, therapist: str, plan
    ) -> None:
        created = plan()
        client.post(f"{PLANS}/{created['id']}/hold", headers=_auth(therapist))

        response = client.post(
            SESSIONS,
            json={"planId": created["id"], "date": date.today().isoformat()},
            headers=_auth(therapist),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "plan_not_active"

    def test_completion_is_explicit_not_automatic(
        self, client: TestClient, therapist: str, plan, session
    ) -> None:
        """Filling the session budget does not finish the programme by itself."""
        created = plan(totalSessions=1)
        made = session(created)
        done = client.post(f"{SESSIONS}/{made['uuid']}/complete", json={}, headers=_auth(therapist))

        assert done.status_code == 200, done.text
        after = client.get(f"{PLANS}/{created['id']}", headers=_auth(therapist)).json()
        assert after["completedSessions"] == 1
        assert after["totalSessions"] == 1
        # Budget full, but the plan is still active until a clinician says so.
        assert after["status"] == "Active"

        finished = client.post(f"{PLANS}/{created['id']}/complete", headers=_auth(therapist))
        assert finished.status_code == 200
        assert finished.json()["status"] == "Completed"
        assert finished.json()["trend"] == "Completed"

    def test_invalid_transition_returns_409(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()
        client.post(f"{PLANS}/{created['id']}/cancel", headers=_auth(therapist))

        response = client.post(f"{PLANS}/{created['id']}/resume", headers=_auth(therapist))
        assert response.status_code == 409
        assert response.json()["code"] == "invalid_transition"


# ---------------------------------------------------------------------------
# Therapist assignment
# ---------------------------------------------------------------------------


class TestTherapistAssignment:
    def test_therapist_sees_assigned_plan(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()
        body = client.get(f"{PLANS}?limit=200", headers=_auth(therapist)).json()

        assert created["id"] in {p["id"] for p in body["items"]}
        assert {p["primaryTherapist"] for p in body["items"]} == {"Meera Iyer"}

    def test_therapist_cannot_access_unassigned_plan(
        self, client: TestClient, other_therapist: str, plan
    ) -> None:
        created = plan()

        # 404, not 403 — a 403 would confirm the plan exists.
        assert client.get(f"{PLANS}/{created['id']}", headers=_auth(other_therapist)).status_code == 404
        listed = client.get(f"{PLANS}?limit=200", headers=_auth(other_therapist)).json()
        assert created["id"] not in {p["id"] for p in listed["items"]}

    def test_therapist_cannot_modify_unassigned_plan(
        self, client: TestClient, other_therapist: str, plan
    ) -> None:
        created = plan()
        response = client.put(
            f"{PLANS}/{created['id']}",
            json={"title": "Hijacked"},
            headers=_auth(other_therapist),
        )
        assert response.status_code == 404

    def test_therapist_cannot_assign_a_plan_to_someone_else(
        self, client: TestClient, therapist: str
    ) -> None:
        response = client.post(
            PLANS,
            json={
                "patientId": PATIENT,
                "therapistId": "USR-1011",
                "title": "Someone else's programme",
                "totalSessions": 12,
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 403
        assert response.json()["code"] == "not_your_plan"

    def test_therapist_cannot_access_other_branch(
        self, client: TestClient, therapist: str
    ) -> None:
        """PT-10263 is a Powai patient; this therapist is Andheri West."""
        response = client.post(
            PLANS,
            json={
                "patientId": OTHER_BRANCH_PATIENT,
                "therapistId": "USR-1004",
                "title": "Cross-branch programme",
                "totalSessions": 12,
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 404

        listed = client.get(f"{PLANS}?scope=all&limit=200", headers=_auth(admin_free := therapist))
        assert listed.status_code == 403  # a therapist cannot widen scope at all

    def test_a_doctor_sees_the_branch_not_a_caseload(
        self, client: TestClient, doctor: str, plan
    ) -> None:
        plan()
        body = client.get(f"{PLANS}?limit=200", headers=_auth(doctor)).json()
        assert len({p["primaryTherapist"] for p in body["items"]}) > 1


# ---------------------------------------------------------------------------
# Caseload
# ---------------------------------------------------------------------------


class TestCaseload:
    def test_caseload_is_derived_from_active_plans(
        self, client: TestClient, therapist: str, plan
    ) -> None:
        created = plan()
        response = client.get("/api/rehab/caseload", headers=_auth(therapist))

        assert response.status_code == 200, response.text
        entries = response.json()
        assert entries
        assert created["id"] in {e["planId"] for e in entries}
        first = entries[0]
        assert set(first) >= {
            "patientId",
            "patientName",
            "planId",
            "planTitle",
            "totalSessions",
            "completedSessions",
            "progressPercentage",
            "trend",
        }

    def test_caseload_excludes_other_therapists(
        self, client: TestClient, other_therapist: str, plan
    ) -> None:
        created = plan()
        entries = client.get("/api/rehab/caseload", headers=_auth(other_therapist)).json()
        assert created["id"] not in {e["planId"] for e in entries}

    def test_caseload_excludes_closed_plans(
        self, client: TestClient, therapist: str, plan
    ) -> None:
        created = plan()
        client.post(f"{PLANS}/{created['id']}/cancel", headers=_auth(therapist))

        entries = client.get("/api/rehab/caseload", headers=_auth(therapist)).json()
        assert created["id"] not in {e["planId"] for e in entries}


# ---------------------------------------------------------------------------
# Milestones
# ---------------------------------------------------------------------------


class TestMilestones:
    def test_create_milestone(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()
        response = client.post(
            f"{PLANS}/{created['id']}/milestones",
            json={
                "label": "Full passive extension achieved",
                "date": (date.today() + timedelta(days=21)).isoformat(),
            },
            headers=_auth(therapist),
        )

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["label"] == "Full passive extension achieved"
        assert body["done"] is False
        assert body["status"] == "Pending"
        assert body["completedAt"] is None

    def test_complete_milestone(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()
        milestone = client.post(
            f"{PLANS}/{created['id']}/milestones",
            json={"label": "Independent stair negotiation"},
            headers=_auth(therapist),
        ).json()

        response = client.post(
            f"/api/rehab/milestones/{milestone['id']}/complete", headers=_auth(therapist)
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["done"] is True
        assert body["status"] == "Achieved"
        # The timestamp is server-set.
        assert body["completedAt"] is not None

        again = client.post(
            f"/api/rehab/milestones/{milestone['id']}/complete", headers=_auth(therapist)
        )
        assert again.status_code == 409
        assert again.json()["code"] == "already_achieved"

    def test_milestones_are_created_with_the_plan(self, client: TestClient, plan) -> None:
        created = plan(
            milestones=[
                {"label": "Week 4 review", "date": (date.today() + timedelta(days=28)).isoformat()},
                {"label": "Week 8 review", "date": (date.today() + timedelta(days=56)).isoformat()},
            ]
        )
        assert [m["label"] for m in created["milestones"]] == ["Week 4 review", "Week 8 review"]

    def test_achieving_through_update_is_refused(
        self, client: TestClient, therapist: str, plan
    ) -> None:
        """So the completion timestamp is always server-set."""
        created = plan()
        milestone = client.post(
            f"{PLANS}/{created['id']}/milestones",
            json={"label": "Backdoor completion"},
            headers=_auth(therapist),
        ).json()

        response = client.put(
            f"/api/rehab/milestones/{milestone['id']}",
            json={"status": "Achieved"},
            headers=_auth(therapist),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "use_complete_endpoint"

    def test_another_therapist_cannot_complete_a_milestone(
        self, client: TestClient, therapist: str, other_therapist: str, plan
    ) -> None:
        created = plan()
        milestone = client.post(
            f"{PLANS}/{created['id']}/milestones",
            json={"label": "Not yours"},
            headers=_auth(therapist),
        ).json()

        response = client.post(
            f"/api/rehab/milestones/{milestone['id']}/complete", headers=_auth(other_therapist)
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Therapy sessions
# ---------------------------------------------------------------------------


@pytest.fixture
def session(client: TestClient, therapist: str):
    """Log a session against a plan."""

    def _create(plan_body: dict, **overrides) -> dict:
        payload = {
            "planId": plan_body["id"],
            "date": date.today().isoformat(),
            "time": "09:00",
            "durationMinutes": 45,
            "type": "Physiotherapy",
            "room": "Gym 1",
        }
        payload.update(overrides)
        response = client.post(SESSIONS, json=payload, headers=_auth(therapist))
        assert response.status_code == 201, response.text
        return response.json()

    return _create


class TestTherapySessions:
    def test_create_session(self, plan, session) -> None:
        created = plan()
        body = session(created)

        assert body["id"].startswith("TS-")
        assert body["patientId"] == PATIENT
        # The therapist is the authenticated user, not anything the client sent.
        assert body["therapist"] == "Meera Iyer"
        assert body["status"] == "Scheduled"
        assert body["planId"] == created["id"]
        # Position in the programme is allocated by the backend.
        assert body["sequence"] == 1

    def test_session_numbers_are_sequential_within_a_plan(self, plan, session) -> None:
        created = plan()
        first = session(created)
        second = session(created, date=(date.today() + timedelta(days=2)).isoformat())
        third = session(created, date=(date.today() + timedelta(days=4)).isoformat())

        assert [first["sequence"], second["sequence"], third["sequence"]] == [1, 2, 3]
        assert len({first["id"], second["id"], third["id"]}) == 3

    def test_therapist_id_from_the_body_is_ignored(
        self, client: TestClient, therapist: str, plan
    ) -> None:
        created = plan()
        response = client.post(
            SESSIONS,
            json={
                "planId": created["id"],
                "date": date.today().isoformat(),
                "therapistId": "USR-1011",
                "therapist": "Kavya Reddy",
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 201, response.text
        assert response.json()["therapist"] == "Meera Iyer"

    def test_complete_session(self, client: TestClient, therapist: str, plan, session) -> None:
        created = plan()
        made = session(created)

        response = client.post(
            f"{SESSIONS}/{made['uuid']}/complete",
            json={
                "painBefore": 5,
                "painAfter": 3,
                "mobilityScore": 78,
                "strengthScore": 71,
                "notes": "Good quadriceps activation.",
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "Completed"
        assert body["painBefore"] == 5
        assert body["painAfter"] == 3
        assert body["attendance"] == "Attended"

        # The plan's progress moved with it.
        after = client.get(f"{PLANS}/{created['id']}", headers=_auth(therapist)).json()
        assert after["completedSessions"] == 1
        assert after["progressPercentage"] == round(1 / created["totalSessions"] * 100)

    def test_completed_session_count(self, client: TestClient, therapist: str, plan, session) -> None:
        created = plan(totalSessions=10)
        for offset in range(3):
            made = session(created, date=(date.today() + timedelta(days=offset)).isoformat())
            client.post(f"{SESSIONS}/{made['uuid']}/complete", json={}, headers=_auth(therapist))

        # One missed — it must not count as delivered.
        missed = session(created, date=(date.today() + timedelta(days=5)).isoformat())
        client.post(f"{SESSIONS}/{missed['uuid']}/no-show", headers=_auth(therapist))

        after = client.get(f"{PLANS}/{created['id']}", headers=_auth(therapist)).json()
        assert after["completedSessions"] == 3
        # 3 delivered of 4 expected.
        assert after["attendanceRate"] == 75.0

    def test_invalid_measurement(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()
        # Pain runs 0-10 and mobility 0-100 — the session form's own scales.
        for payload in ({"painBefore": 11}, {"painAfter": -1}, {"mobilityScore": 120}, {"strengthScore": 101}):
            response = client.post(
                SESSIONS,
                json={"planId": created["id"], "date": date.today().isoformat(), **payload},
                headers=_auth(therapist),
            )
            assert response.status_code == 422, (payload, response.text)

    def test_invalid_session_transition(
        self, client: TestClient, therapist: str, plan, session
    ) -> None:
        created = plan()
        made = session(created)
        client.post(f"{SESSIONS}/{made['uuid']}/complete", json={}, headers=_auth(therapist))

        # Completed is terminal.
        response = client.post(f"{SESSIONS}/{made['uuid']}/start", headers=_auth(therapist))
        assert response.status_code == 409
        assert response.json()["code"] == "invalid_transition"

        amend = client.put(
            f"{SESSIONS}/{made['uuid']}", json={"room": "Gym 2"}, headers=_auth(therapist)
        )
        assert amend.status_code == 409
        assert amend.json()["code"] == "session_closed"

    def test_session_workflow(self, client: TestClient, therapist: str, plan, session) -> None:
        created = plan()
        made = session(created)

        started = client.post(f"{SESSIONS}/{made['uuid']}/start", headers=_auth(therapist))
        assert started.status_code == 200
        assert started.json()["status"] == "In Progress"

        done = client.post(f"{SESSIONS}/{made['uuid']}/complete", json={}, headers=_auth(therapist))
        assert done.status_code == 200
        assert done.json()["status"] == "Completed"

    def test_a_no_show_is_not_a_completion(
        self, client: TestClient, therapist: str, plan, session
    ) -> None:
        created = plan()
        made = session(created)
        response = client.post(
            f"{SESSIONS}/{made['uuid']}/complete",
            json={"attendance": "No Show"},
            headers=_auth(therapist),
        )
        assert response.status_code == 422

    def test_therapist_only_sees_their_own_sessions(
        self, client: TestClient, other_therapist: str, plan, session
    ) -> None:
        created = plan()
        made = session(created)

        assert client.get(f"{SESSIONS}/{made['uuid']}", headers=_auth(other_therapist)).status_code == 404
        listed = client.get(f"{SESSIONS}?limit=200", headers=_auth(other_therapist)).json()
        assert made["id"] not in {s["id"] for s in listed["items"]}


# ---------------------------------------------------------------------------
# Exercises
# ---------------------------------------------------------------------------


class TestExercises:
    def test_exercise_library_is_searchable(self, client: TestClient, therapist: str) -> None:
        every = client.get(f"{EXERCISES}", headers=_auth(therapist))
        assert every.status_code == 200, every.text
        assert every.json()

        filtered = client.get(
            f"{EXERCISES}?category=Physiotherapy&search=knee", headers=_auth(therapist)
        )
        assert filtered.status_code == 200
        rows = filtered.json()
        assert rows
        assert all(r["category"] == "Physiotherapy" for r in rows)
        assert all("knee" in r["name"].lower() for r in rows)

    def test_create_exercise(self, client: TestClient, admin: str) -> None:
        response = client.post(
            EXERCISES,
            json={
                "name": "Testcase heel slide",
                "category": "Physiotherapy",
                "description": "Supine heel slide to tolerance.",
                "defaultDuration": 10,
            },
            headers=_auth(admin),
        )
        assert response.status_code == 201, response.text
        assert response.json()["name"] == "Testcase heel slide"
        assert response.json()["isActive"] is True

    def test_therapists_cannot_edit_the_shared_library(
        self, client: TestClient, therapist: str
    ) -> None:
        response = client.post(
            EXERCISES,
            json={"name": "Therapist-invented drill", "category": "Physiotherapy"},
            headers=_auth(therapist),
        )
        assert response.status_code == 403

    def test_session_exercise(self, client: TestClient, therapist: str, plan, session) -> None:
        created = plan()
        made = session(
            created,
            exercises=[
                {"name": "Terminal knee extension", "sets": 3, "repetitions": 12},
                {"name": "Step-up progression", "sets": 2, "repetitions": 10, "duration": 8},
            ],
        )

        assert made["exercises"] == ["Terminal knee extension", "Step-up progression"]
        detail = made["exerciseDetail"]
        assert len(detail) == 2
        assert detail[0]["sets"] == 3
        assert detail[0]["repetitions"] == 12
        assert detail[0]["exerciseId"] is not None
        assert detail[1]["duration"] == 8

    def test_exercises_can_be_replaced_on_a_session(
        self, client: TestClient, therapist: str, plan, session
    ) -> None:
        """Re-saving with a different set replaces it, and the response reflects it.

        Regression: clearing the old rows with a bulk DELETE emptied the table
        but left the loaded collection holding deleted instances, so serialising
        the response blew up with a 503.
        """
        created = plan()
        made = session(created, exercises=[{"name": "Terminal knee extension", "sets": 3}])
        assert made["exercises"] == ["Terminal knee extension"]

        amended = client.put(
            f"{SESSIONS}/{made['uuid']}",
            json={
                "exercises": [
                    {"name": "Step-up progression", "sets": 2, "repetitions": 10},
                    {"name": "Single-leg balance drill", "duration": 5},
                ]
            },
            headers=_auth(therapist),
        )
        assert amended.status_code == 200, amended.text
        assert amended.json()["exercises"] == ["Step-up progression", "Single-leg balance drill"]
        assert len(amended.json()["exerciseDetail"]) == 2

        # And completing with yet another set replaces it again.
        done = client.post(
            f"{SESSIONS}/{made['uuid']}/complete",
            json={"exercises": [{"name": "Calf raise (double to single)", "sets": 3}]},
            headers=_auth(therapist),
        )
        assert done.status_code == 200, done.text
        assert done.json()["exercises"] == ["Calf raise (double to single)"]

    def test_every_seeded_session_exercise_is_in_the_library(
        self, client: TestClient, therapist: str
    ) -> None:
        """A therapist reopening any seeded session must be able to re-save it.

        The frontend's mock library and its mock sessions disagreed: 17
        exercises appeared on sessions without being in their discipline's
        protocol, so re-saving one of those sessions was refused.
        """
        library = client.get(f"{EXERCISES}?limit=500", headers=_auth(therapist)).json()
        known = {(e["category"], e["name"].lower()) for e in library}

        listed = client.get(f"{SESSIONS}?limit=200", headers=_auth(therapist)).json()
        missing = [
            (s["type"], name)
            for s in listed["items"]
            for name in s["exercises"]
            if (s["type"], name.lower()) not in known
        ]
        assert not missing, f"session exercises absent from the library: {missing}"

    def test_unknown_exercise_is_rejected(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()
        response = client.post(
            SESSIONS,
            json={
                "planId": created["id"],
                "date": date.today().isoformat(),
                "exercises": [{"name": "Made-up manoeuvre"}],
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 422
        assert "exercise library" in response.json()["detail"]

    def test_inactive_exercise_rejected(
        self, client: TestClient, admin: str, therapist: str, plan
    ) -> None:
        retired = client.post(
            EXERCISES,
            json={"name": "Testcase retired drill", "category": "Physiotherapy"},
            headers=_auth(admin),
        ).json()
        client.put(f"{EXERCISES}/{retired['id']}", json={"isActive": False}, headers=_auth(admin))

        created = plan()
        response = client.post(
            SESSIONS,
            json={
                "planId": created["id"],
                "date": date.today().isoformat(),
                "exercises": [{"name": "Testcase retired drill"}],
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 422
        assert "retired" in response.json()["detail"]

        # It is still absent from the default (active-only) library listing.
        active = client.get(EXERCISES, headers=_auth(therapist)).json()
        assert retired["id"] not in {e["id"] for e in active}

    def test_a_bad_exercise_rolls_the_whole_session_back(
        self, client: TestClient, therapist: str, plan
    ) -> None:
        from app.core.database import SessionLocal

        created = plan()
        with SessionLocal() as db:
            before = db.execute(select(TherapySession.id)).scalars().all()

        response = client.post(
            SESSIONS,
            json={
                "planId": created["id"],
                "date": date.today().isoformat(),
                "exercises": [{"name": "Terminal knee extension"}, {"name": "Not a real exercise"}],
            },
            headers=_auth(therapist),
        )
        assert response.status_code == 422

        with SessionLocal() as db:
            after = db.execute(select(TherapySession.id)).scalars().all()
        assert set(after) == set(before), "the rejected session left nothing behind"


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------


class TestProgress:
    def test_rehab_progress(self, client: TestClient, therapist: str, plan, session) -> None:
        created = plan(totalSessions=12)
        made = session(created)
        client.post(
            f"{SESSIONS}/{made['uuid']}/complete",
            json={"painBefore": 6, "painAfter": 4, "mobilityScore": 70, "strengthScore": 65},
            headers=_auth(therapist),
        )

        response = client.get(f"{PLANS}/{created['id']}/progress", headers=_auth(therapist))
        assert response.status_code == 200, response.text
        body = response.json()

        assert body["planId"] == created["id"]
        assert body["patientId"] == PATIENT
        assert len(body["sessions"]) == 1
        assert body["sessions"][0]["painBefore"] == 6
        assert body["sessions"][0]["mobility"] == 70

        summary = body["summary"]
        assert summary["completedSessions"] == 1
        assert summary["totalSessions"] == 12
        assert summary["completionPercentage"] == round(1 / 12 * 100, 2)

    def test_progress_points_are_chart_shaped(
        self, client: TestClient, therapist: str, plan
    ) -> None:
        created = plan()
        recorded = client.post(
            f"{PLANS}/{created['id']}/progress",
            json={"pain": 4.5, "mobility": 72, "strength": 68, "adherence": 90},
            headers=_auth(therapist),
        )
        assert recorded.status_code == 201, recorded.text
        # Exactly the frontend's ProgressPoint shape.
        assert set(recorded.json()) == {"week", "pain", "mobility", "strength", "adherence"}
        assert recorded.json()["pain"] == 4.5

        body = client.get(f"{PLANS}/{created['id']}/progress", headers=_auth(therapist)).json()
        assert len(body["progress"]) == 1
        # Recording a point feeds the plan's adherence.
        after = client.get(f"{PLANS}/{created['id']}", headers=_auth(therapist)).json()
        assert after["adherenceRate"] == 90.0

    def test_one_progress_point_per_week(self, client: TestClient, therapist: str, plan) -> None:
        created = plan()
        for adherence in (80, 95):
            client.post(
                f"{PLANS}/{created['id']}/progress",
                json={"pain": 4, "mobility": 70, "strength": 65, "adherence": adherence},
                headers=_auth(therapist),
            )

        body = client.get(f"{PLANS}/{created['id']}/progress", headers=_auth(therapist)).json()
        # The second submission updated the week rather than duplicating it.
        assert len(body["progress"]) == 1
        assert body["progress"][0]["adherence"] == 95

    def test_progress_measurements_are_range_checked(
        self, client: TestClient, therapist: str, plan
    ) -> None:
        created = plan()
        response = client.post(
            f"{PLANS}/{created['id']}/progress",
            json={"pain": 12, "mobility": 70, "strength": 65, "adherence": 90},
            headers=_auth(therapist),
        )
        assert response.status_code == 422

    def test_seeded_plan_progress_is_real(self, client: TestClient, therapist: str) -> None:
        """The seeded caseload has charts backed by real progress points."""
        entries = client.get("/api/rehab/caseload", headers=_auth(therapist)).json()
        seeded = next(e for e in entries if e["patientId"] == SEEDED_PATIENT)

        body = client.get(f"{PLANS}/{seeded['planId']}/progress", headers=_auth(therapist)).json()
        assert len(body["progress"]) >= 6
        assert body["summary"]["completedSessions"] > 0
        # Pain trends down across the programme.
        assert body["progress"][-1]["pain"] < body["progress"][0]["pain"]


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


class TestRehabPermissions:
    def test_rehab_endpoints_require_authentication(self, client: TestClient) -> None:
        assert client.get(PLANS).status_code == 401
        assert client.get(SESSIONS).status_code == 401
        assert client.get("/api/rehab/caseload").status_code == 401

    def test_a_pharmacist_has_no_rehab_access(self, client: TestClient, pharmacist: str) -> None:
        for path in (PLANS, SESSIONS, "/api/rehab/caseload", EXERCISES):
            assert client.get(path, headers=_auth(pharmacist)).status_code == 403, path

    def test_a_doctor_cannot_deliver_a_session(
        self, client: TestClient, doctor: str, plan
    ) -> None:
        """Prescribing a programme is not the same as delivering it."""
        created = plan()
        response = client.post(
            SESSIONS,
            json={"planId": created["id"], "date": date.today().isoformat()},
            headers=_auth(doctor),
        )
        assert response.status_code == 403

    def test_therapist_notes_stay_out_of_patient_search(
        self, client: TestClient, therapist: str
    ) -> None:
        """Clinical notes must not leak through a generic lookup."""
        response = client.get(f"{PATIENTS}/search?q=Raj", headers=_auth(therapist))
        assert response.status_code == 200, response.text
        for row in response.json():
            assert "notes" not in row
            assert "therapistNotes" not in row
            assert "progress" not in row

    def test_patient_360_carries_the_rehabilitation_record(
        self, client: TestClient, therapist: str
    ) -> None:
        body = client.get(f"{PATIENTS}/{SEEDED_PATIENT}/360", headers=_auth(therapist)).json()

        assert body["rehabPlan"] is not None
        assert body["rehabPlans"]
        assert body["therapySessions"]
        assert body["progress"]
        assert body["milestones"]
        # Straight from rehab_progress_points, in the chart's own shape.
        assert set(body["progress"][0]) == {"week", "pain", "mobility", "strength", "adherence"}
        # Every section the frontend shows is real as of Step 11.
        assert body["pendingModules"] == []

    def test_patient_sub_resources(self, client: TestClient, therapist: str) -> None:
        plans = client.get(f"{PATIENTS}/{SEEDED_PATIENT}/rehab-plans", headers=_auth(therapist))
        sessions = client.get(f"{PATIENTS}/{SEEDED_PATIENT}/therapy-sessions", headers=_auth(therapist))
        progress = client.get(f"{PATIENTS}/{SEEDED_PATIENT}/progress", headers=_auth(therapist))

        assert plans.status_code == 200 and plans.json()
        assert sessions.status_code == 200 and sessions.json()
        assert progress.status_code == 200 and progress.json()
