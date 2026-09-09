"""Cross-system tests: notifications, global search, reports and exports.

Runs against real PostgreSQL with the demo data seeded.

The security cases are the point of this module. Search is reachable from every
screen by every role, and a report summarises records most callers cannot read
directly — so both are places where a leak would be cheap and quiet.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.enums import NotificationIcon, NotificationSeverity
from app.models import Notification, Patient, User

DEMO_PASSWORD = "Rehab@123"

NOTIFICATIONS = "/api/notifications"
SEARCH = "/api/search"
REPORTS = "/api/reports"
INVOICES = "/api/invoices"


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
            for model in (User, Patient)
        )
    if not have:
        pytest.skip("Demo data not seeded — run seed.py and seed_patients.py")


@pytest.fixture(autouse=True)
def _no_leaked_notifications(seeded: None):
    """Every alert this module raises is cleared again."""
    from app.core.database import SessionLocal

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
def doctor(client: TestClient, seeded: None) -> str:
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def receptionist(client: TestClient, seeded: None) -> str:
    return _token(client, "reception@rehab.com")


@pytest.fixture(scope="module")
def accountant(client: TestClient, seeded: None) -> str:
    return _token(client, "accounts@rehab.com")


@pytest.fixture(scope="module")
def therapist(client: TestClient, seeded: None) -> str:
    return _token(client, "therapist@rehab.com")


@pytest.fixture(scope="module")
def admin(client: TestClient, seeded: None) -> str:
    return _token(client, "admin@rehab.com")


@pytest.fixture
def alert():
    """Raise an alert directly for a named account."""
    from app.core.database import SessionLocal
    from app.services import notification_service as service

    def _raise(email: str, title: str = "Testcase alert") -> str:
        with SessionLocal() as db:
            owner = db.execute(select(User).where(User.email == email)).scalar_one()
            row = service.notify(
                db,
                user_id=owner.id,
                title=title,
                body="Raised by a test.",
                icon=NotificationIcon.SYSTEM,
                severity=NotificationSeverity.INFO,
                href="/",
            )
            db.commit()
            return str(row.id)

    return _raise


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


class TestNotifications:
    def test_a_user_sees_their_own(self, client: TestClient, doctor: str, alert) -> None:
        alert("doctor@rehab.com", "For the doctor")
        body = client.get(NOTIFICATIONS, headers=_auth(doctor)).json()

        assert body["total"] >= 1
        assert any(row["title"] == "For the doctor" for row in body["items"])
        assert body["unread"] >= 1
        assert body["items"][0]["time"], "the bell renders a relative time"

    def test_a_user_never_sees_another_persons(
        self, client: TestClient, doctor: str, accountant: str, alert
    ) -> None:
        alert("doctor@rehab.com", "Only for the doctor")
        body = client.get(NOTIFICATIONS, headers=_auth(accountant)).json()
        assert not any(row["title"] == "Only for the doctor" for row in body["items"])

    def test_unread_count(self, client: TestClient, doctor: str, alert) -> None:
        before = client.get(f"{NOTIFICATIONS}/unread-count", headers=_auth(doctor)).json()["unread"]
        alert("doctor@rehab.com")
        after = client.get(f"{NOTIFICATIONS}/unread-count", headers=_auth(doctor)).json()["unread"]
        assert after == before + 1

    def test_marking_one_read_decreases_the_count(
        self, client: TestClient, doctor: str, alert
    ) -> None:
        identifier = alert("doctor@rehab.com")
        before = client.get(f"{NOTIFICATIONS}/unread-count", headers=_auth(doctor)).json()["unread"]

        response = client.post(f"{NOTIFICATIONS}/{identifier}/read", headers=_auth(doctor))
        assert response.status_code == 200
        body = response.json()
        assert body["updated"] == 1
        assert body["unread"] == before - 1

    def test_marking_an_already_read_alert_reports_no_work(
        self, client: TestClient, doctor: str, alert
    ) -> None:
        identifier = alert("doctor@rehab.com")
        client.post(f"{NOTIFICATIONS}/{identifier}/read", headers=_auth(doctor))

        again = client.post(f"{NOTIFICATIONS}/{identifier}/read", headers=_auth(doctor)).json()
        assert again["updated"] == 0

    def test_one_user_cannot_mark_anothers_read(
        self, client: TestClient, accountant: str, alert
    ) -> None:
        """A valid id belonging to somebody else is a 404, not a 403."""
        identifier = alert("doctor@rehab.com")
        response = client.post(f"{NOTIFICATIONS}/{identifier}/read", headers=_auth(accountant))
        assert response.status_code == 404

    def test_mark_all_read(self, client: TestClient, doctor: str, alert) -> None:
        alert("doctor@rehab.com")
        alert("doctor@rehab.com")

        body = client.post(f"{NOTIFICATIONS}/read-all", headers=_auth(doctor)).json()
        assert body["unread"] == 0
        assert client.get(f"{NOTIFICATIONS}/unread-count", headers=_auth(doctor)).json()["unread"] == 0

    def test_a_settled_payment_notifies_the_accountants(
        self, client: TestClient, receptionist: str, accountant: str
    ) -> None:
        """Notifications come from backend events, not from the browser."""
        before = client.get(f"{NOTIFICATIONS}/unread-count", headers=_auth(accountant)).json()["unread"]

        invoice = client.post(
            INVOICES,
            json={
                "patientId": "PT-10277",
                "items": [{"label": "Testcase consultation", "qty": 1, "rate": "500.00"}],
            },
            headers=_auth(receptionist),
        ).json()
        paid = client.post(
            f"{INVOICES}/{invoice['id']}/payments",
            json={"amount": "500.00", "method": "Cash"},
            headers=_auth(receptionist),
        )
        assert paid.status_code == 201, paid.text

        after = client.get(f"{NOTIFICATIONS}/unread-count", headers=_auth(accountant)).json()["unread"]
        assert after > before, "the accountant was told money arrived"

        # Clean up the invoice this test raised.
        from app.core.database import SessionLocal
        from app.models import Invoice, InvoiceItem, Payment

        with SessionLocal() as db:
            invoice_id = uuid.UUID(invoice["uuid"])
            db.execute(delete(Payment).where(Payment.invoice_id == invoice_id))
            db.execute(delete(InvoiceItem).where(InvoiceItem.invoice_id == invoice_id))
            db.execute(delete(Invoice).where(Invoice.id == invoice_id))
            db.commit()


# ---------------------------------------------------------------------------
# Global search
# ---------------------------------------------------------------------------


class TestGlobalSearch:
    def test_an_exact_patient_number_ranks_first(self, client: TestClient, doctor: str) -> None:
        body = client.get(SEARCH, params={"q": "PT-10248"}, headers=_auth(doctor)).json()
        patients = next(g for g in body["groups"] if g["type"] == "patient")
        assert patients["hits"][0]["id"] == "PT-10248"

    def test_a_name_finds_the_patient(self, client: TestClient, doctor: str) -> None:
        body = client.get(SEARCH, params={"q": "raj kumar"}, headers=_auth(doctor)).json()
        patients = next(g for g in body["groups"] if g["type"] == "patient")
        assert patients["hits"][0]["title"] == "Raj Kumar"

    def test_a_hit_carries_no_clinical_or_financial_detail(
        self, client: TestClient, doctor: str
    ) -> None:
        """The palette answers navigation, never data."""
        body = client.get(SEARCH, params={"q": "raj"}, headers=_auth(doctor)).json()
        for group in body["groups"]:
            for hit in group["hits"]:
                assert set(hit) == {"type", "id", "title", "subtitle", "url"}
                blob = f"{hit['title']} {hit['subtitle']}".lower()
                for leaked in ("diagnos", "mg", "stroke", "fracture", "outstanding", "balance"):
                    assert leaked not in blob, f"{leaked!r} leaked into a search hit"

    def test_categories_follow_the_callers_permissions(
        self, client: TestClient, receptionist: str, accountant: str, doctor: str
    ) -> None:
        def groups(token: str) -> set[str]:
            body = client.get(SEARCH, params={"q": "raj"}, headers=_auth(token)).json()
            return {g["type"] for g in body["groups"]}

        # Reception books appointments and takes money, but writes no prescriptions.
        assert "prescription" not in groups(receptionist)
        # The accountant has no appointment permission at all.
        assert "appointment" not in groups(accountant)
        # The doctor prescribes, so that category is theirs.
        assert "prescription" in groups(doctor)

    def test_search_is_branch_scoped(self, client: TestClient, receptionist: str) -> None:
        """Reception is Andheri; a Powai patient is not theirs to find."""
        body = client.get(SEARCH, params={"q": "Lakshmi"}, headers=_auth(receptionist)).json()
        patients = [g for g in body["groups"] if g["type"] == "patient"]
        found = {hit["id"] for group in patients for hit in group["hits"]}
        assert "PT-10315" not in found

    def test_a_short_query_returns_nothing(self, client: TestClient, doctor: str) -> None:
        """One character matches most of the database and helps nobody."""
        body = client.get(SEARCH, params={"q": "r"}, headers=_auth(doctor)).json()
        assert body["groups"] == []
        assert body["total"] == 0

    def test_results_are_capped(self, client: TestClient, doctor: str) -> None:
        body = client.get(SEARCH, params={"q": "a", "limit": 20}, headers=_auth(doctor)).json()
        for group in body["groups"]:
            assert len(group["hits"]) <= 20


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


class TestReports:
    def test_patient_report_is_a_continuous_series(self, client: TestClient, admin: str) -> None:
        body = client.get(f"{REPORTS}/patients", headers=_auth(admin)).json()
        assert body["totalPatients"] > 0
        # Six months, every one present — a quiet month is a zero, not a gap.
        assert len(body["volume"]) == 6
        assert all("month" in point for point in body["volume"])

    def test_appointment_report_counts_match_their_own_total(
        self, client: TestClient, admin: str
    ) -> None:
        body = client.get(f"{REPORTS}/appointments", headers=_auth(admin)).json()
        assert body["total"] == sum(row["count"] for row in body["byStatus"])

    def test_occupancy_counts_a_stay_across_its_whole_span(
        self, client: TestClient, admin: str
    ) -> None:
        """A fortnight-long admission occupies a bed for a fortnight."""
        body = client.get(f"{REPORTS}/ipd", headers=_auth(admin)).json()
        assert body["totalBeds"] > 0
        assert len(body["trend"]) == 7
        # Seeded stays are open, so every day in the window shows occupancy.
        assert all(point["occupancy"] > 0 for point in body["trend"])
        assert body["occupancyRate"] == round(body["occupiedNow"] / body["totalBeds"] * 100)

    def test_therapy_report_never_reports_more_delivered_than_booked(
        self, client: TestClient, therapist: str
    ) -> None:
        body = client.get(f"{REPORTS}/therapy", headers=_auth(therapist)).json()
        for point in body["byWeek"]:
            assert point["sessions"] <= point["capacity"]
        for row in body["workload"]:
            assert row["completed"] <= row["booked"]

    def test_a_report_returns_no_records(self, client: TestClient, admin: str) -> None:
        """Aggregates only — a report is not a way around row permissions."""
        body = client.get(f"{REPORTS}/patients", headers=_auth(admin)).json()
        assert set(body) == {"window", "totalPatients", "volume"}
        for point in body["volume"]:
            assert set(point) == {"month", "newPatients", "returning"}

    @pytest.mark.parametrize(
        "path,denied",
        [
            ("/payments", "therapist"),
            ("/therapy", "accountant"),
        ],
    )
    def test_reports_inherit_their_modules_permissions(
        self, client: TestClient, request: pytest.FixtureRequest, path: str, denied: str
    ) -> None:
        token = request.getfixturevalue(denied)
        assert client.get(f"{REPORTS}{path}", headers=_auth(token)).status_code == 403


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------


class TestExports:
    def test_csv_export_is_a_real_file(self, client: TestClient, therapist: str) -> None:
        response = client.get(f"{REPORTS}/therapy/export", headers=_auth(therapist))
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")

        disposition = response.headers["content-disposition"]
        assert disposition.startswith("attachment;")
        assert ".csv" in disposition

        rows = response.text.strip().split("\n")
        assert rows[0] == "Therapist,Booked,Completed"
        assert len(rows) > 1

    def test_csv_export_inherits_the_reports_permission(
        self, client: TestClient, accountant: str
    ) -> None:
        assert (
            client.get(f"{REPORTS}/therapy/export", headers=_auth(accountant)).status_code == 403
        )

    def test_invoice_pdf(self, client: TestClient, accountant: str) -> None:
        invoice = client.get(f"{INVOICES}?limit=1", headers=_auth(accountant)).json()["items"][0]
        response = client.get(f"{INVOICES}/{invoice['id']}/pdf", headers=_auth(accountant))

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.content[:5] == b"%PDF-", "a real PDF, not an error page"
        assert invoice["id"] in response.headers["content-disposition"]

    def test_invoice_pdf_needs_billing_permission(
        self, client: TestClient, accountant: str, therapist: str
    ) -> None:
        invoice = client.get(f"{INVOICES}?limit=1", headers=_auth(accountant)).json()["items"][0]
        assert (
            client.get(f"{INVOICES}/{invoice['id']}/pdf", headers=_auth(therapist)).status_code
            == 403
        )

    def test_a_csv_value_containing_a_comma_is_quoted(self) -> None:
        """Written through a CSV writer, so a comma cannot shift the columns."""
        from app.services import report_service as service

        body = service.to_csv(["Vendor", "Amount"], [["Smith, Jones & Co", "1200.00"]])
        assert '"Smith, Jones & Co",1200.00' in body
