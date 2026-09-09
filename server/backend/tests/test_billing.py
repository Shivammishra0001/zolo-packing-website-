"""Billing tests: invoices, payments, expenses and the finance dashboard.

Runs against real PostgreSQL with the demo data seeded:

    python seed.py && python seed_patients.py && python seed_billing.py

Money is asserted as `Decimal`, never as a float. Every test that writes cleans
up after itself, and the per-test fixture puts the seeded ledger back exactly as
it found it.
"""

from __future__ import annotations

import threading
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.config import settings
from app.core.enums import PaymentStatus
from app.models import Expense, Invoice, InvoiceItem, Notification, Patient, Payment, User

DEMO_PASSWORD = "Rehab@123"

INVOICES = "/api/invoices"
PAYMENTS = "/api/payments"
EXPENSES = "/api/expenses"
BILLING = "/api/billing"
PATIENTS = "/api/patients"

#: An Andheri West patient, safe to bill in a test.
BILLABLE = "PT-10277"
#: A Powai patient — used for the branch-isolation cases.
OTHER_BRANCH_PATIENT = "PT-10315"


def _token(client: TestClient, email: str) -> str:
    response = client.post(
        "/api/auth/login", json={"email": email, "password": DEMO_PASSWORD, "remember": False}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _clinic_today() -> date:
    return datetime.now(settings.clinic_tz).date()


def _rupees(value) -> Decimal:
    """Parse a money field the way the API sends it — as a string, not a float."""
    return Decimal(str(value))


@pytest.fixture(scope="module")
def seeded() -> None:
    from app.core.database import SessionLocal, check_database_connection

    ok, _ = check_database_connection()
    if not ok:
        pytest.skip("PostgreSQL is not reachable")

    with SessionLocal() as db:
        have = all(
            db.execute(select(model).limit(1)).scalar_one_or_none() is not None
            for model in (User, Patient, Invoice, Payment, Expense)
        )
    if not have:
        pytest.skip("Demo data not seeded — run seed.py, seed_patients.py and seed_billing.py")


@pytest.fixture(autouse=True)
def _no_leaked_financial_rows(seeded: None):
    """Delete every financial row a test writes and restore what it moved.

    Per test rather than per module: an invoice raised by one test would
    otherwise change the dashboard totals the next one asserts.
    """
    from app.core.database import SessionLocal

    # Children before parents: a payment references an invoice, which owns its
    # line items.
    # Notification is here because a settled payment now raises one; without
    # it every run would leave another alert in the accountants' bells.
    created = (Notification, Payment, InvoiceItem, Invoice, Expense)

    with SessionLocal() as db:
        before = {m: list(db.execute(select(m.id)).scalars()) for m in created}
        invoice_state = {
            row.id: (row.status, row.total, row.subtotal, row.discount, row.tax, row.due_date)
            for row in db.execute(select(Invoice)).scalars()
        }
        payment_state = {
            row.id: row.status for row in db.execute(select(Payment)).scalars()
        }
        expense_state = {
            row.id: (row.category, row.status, row.amount)
            for row in db.execute(select(Expense)).scalars()
        }

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

        for invoice in db.execute(select(Invoice)).scalars():
            if invoice.id in invoice_state:
                (
                    invoice.status,
                    invoice.total,
                    invoice.subtotal,
                    invoice.discount,
                    invoice.tax,
                    invoice.due_date,
                ) = invoice_state[invoice.id]
        for payment in db.execute(select(Payment)).scalars():
            if payment.id in payment_state:
                payment.status = payment_state[payment.id]
        for expense in db.execute(select(Expense)).scalars():
            if expense.id in expense_state:
                expense.category, expense.status, expense.amount = expense_state[expense.id]
        db.commit()


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def accountant(client: TestClient, seeded: None) -> str:
    return _token(client, "accounts@rehab.com")


@pytest.fixture(scope="module")
def receptionist(client: TestClient, seeded: None) -> str:
    return _token(client, "reception@rehab.com")


@pytest.fixture(scope="module")
def admin(client: TestClient, seeded: None) -> str:
    return _token(client, "admin@rehab.com")


@pytest.fixture(scope="module")
def doctor(client: TestClient, seeded: None) -> str:
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def nurse(client: TestClient, seeded: None) -> str:
    return _token(client, "nurse@rehab.com")


@pytest.fixture(scope="module")
def therapist(client: TestClient, seeded: None) -> str:
    return _token(client, "therapist@rehab.com")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def invoice(client: TestClient, receptionist: str):
    def _create(**overrides) -> dict:
        payload = {
            "patientId": BILLABLE,
            "department": "OPD",
            "items": [{"label": "Consultation", "qty": 1, "rate": "1000.00"}],
        }
        payload.update(overrides)
        response = client.post(INVOICES, json=payload, headers=_auth(receptionist))
        assert response.status_code == 201, response.text
        return response.json()

    return _create


@pytest.fixture
def pay(client: TestClient, receptionist: str):
    def _pay(inv: dict, amount: str, **overrides):
        payload = {"amount": amount, "method": "UPI"}
        payload.update(overrides)
        return client.post(
            f"{INVOICES}/{inv['id']}/payments", json=payload, headers=_auth(receptionist)
        )

    return _pay


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------


class TestInvoices:
    def test_create_invoice(self, client: TestClient, invoice) -> None:
        body = invoice()
        assert body["patientId"] == BILLABLE
        assert body["department"] == "OPD"
        assert body["status"] == "Unpaid"
        assert _rupees(body["amount"]) == Decimal("1000.00")
        assert _rupees(body["paid"]) == Decimal("0.00")
        assert _rupees(body["balance"]) == Decimal("1000.00")
        assert body["date"] == _clinic_today().isoformat()

    def test_invoice_total_calculation(self, client: TestClient, invoice) -> None:
        """Every total is `qty × rate` summed here, never a client's figure."""
        body = invoice(
            items=[
                {"label": "Therapy block", "qty": 12, "rate": "1100.00"},
                {"label": "Assessment", "qty": 1, "rate": "1600.00"},
            ],
            discount="200.00",
            tax="150.00",
        )
        assert _rupees(body["subtotal"]) == Decimal("14800.00")
        assert _rupees(body["discount"]) == Decimal("200.00")
        assert _rupees(body["tax"]) == Decimal("150.00")
        assert _rupees(body["amount"]) == Decimal("14750.00")

    def test_a_total_sent_by_the_client_is_not_read(self, client: TestClient, invoice) -> None:
        """There is no total field to send, so an extra key changes nothing."""
        body = invoice(amount="999999.00", total="999999.00", paid="500000.00")
        assert _rupees(body["amount"]) == Decimal("1000.00")
        assert _rupees(body["paid"]) == Decimal("0.00")

    def test_invoice_items(self, client: TestClient, invoice) -> None:
        body = invoice(
            items=[
                {"label": "Room charge", "qty": 6, "rate": "1800.00"},
                {"label": "Physiotherapy", "qty": 4, "rate": "1100.00"},
            ]
        )
        assert len(body["items"]) == 2
        room = next(i for i in body["items"] if i["label"] == "Room charge")
        assert room["qty"] == 6
        assert _rupees(room["rate"]) == Decimal("1800.00")
        assert _rupees(room["amount"]) == Decimal("10800.00")

    def test_invoice_number_unique(self, client: TestClient, invoice) -> None:
        numbers = {invoice()["id"] for _ in range(5)}
        assert len(numbers) == 5
        assert all(n.startswith(f"INV-{_clinic_today().year}-") for n in numbers)

    def test_invoice_numbers_are_unique_under_concurrency(
        self, client: TestClient, receptionist: str
    ) -> None:
        """Five tills billing at once must not collide on a number."""
        from app.core.database import SessionLocal
        from app.schemas.billing import InvoiceCreate
        from app.services import billing_service as service

        permissions = ["patient.view", "billing.view", "billing.manage"]
        barrier = threading.Barrier(5)
        issued: list[str] = []
        guard = threading.Lock()

        def raise_one() -> None:
            with SessionLocal() as db:
                staff = db.execute(
                    select(User).where(User.email == "reception@rehab.com")
                ).scalar_one()
                payload = InvoiceCreate(
                    patientId=BILLABLE,
                    items=[{"label": "Concurrent line", "qty": 1, "rate": Decimal("100.00")}],
                )
                barrier.wait(timeout=10)
                try:
                    body = service.create_invoice(
                        db, payload=payload, user=staff, permissions=permissions, ip=None
                    )
                    result = body.id
                except Exception as exc:  # pragma: no cover - surfaced on failure
                    db.rollback()
                    result = f"error: {exc}"
            with guard:
                issued.append(result)

        threads = [threading.Thread(target=raise_one) for _ in range(5)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        assert len(issued) == 5, issued
        assert all(not n.startswith("error") for n in issued), issued
        assert len(set(issued)) == 5, f"duplicate invoice numbers issued: {issued}"

    def test_a_discount_larger_than_the_bill_is_refused(self, client: TestClient, receptionist: str) -> None:
        response = client.post(
            INVOICES,
            json={
                "patientId": BILLABLE,
                "items": [{"label": "Consultation", "qty": 1, "rate": "1000.00"}],
                "discount": "5000.00",
            },
            headers=_auth(receptionist),
        )
        assert response.status_code == 422
        assert response.json()["code"] == "discount_exceeds_subtotal"

    def test_a_zero_quantity_line_is_refused(self, client: TestClient, receptionist: str) -> None:
        response = client.post(
            INVOICES,
            json={
                "patientId": BILLABLE,
                "items": [{"label": "Nothing", "qty": 0, "rate": "1000.00"}],
            },
            headers=_auth(receptionist),
        )
        assert response.status_code == 422

    def test_an_invoice_with_no_lines_is_refused(self, client: TestClient, receptionist: str) -> None:
        response = client.post(
            INVOICES, json={"patientId": BILLABLE, "items": []}, headers=_auth(receptionist)
        )
        assert response.status_code == 422

    def test_status_cannot_be_set_by_the_client(
        self, client: TestClient, receptionist: str, invoice
    ) -> None:
        """`Paid → Unpaid` is impossible because there is no status to send."""
        body = invoice()
        response = client.put(
            f"{INVOICES}/{body['id']}", json={"status": "Paid"}, headers=_auth(receptionist)
        )
        assert response.status_code == 200
        assert response.json()["status"] == "Unpaid", "an unpaid bill stayed unpaid"

    def test_a_collected_invoice_cannot_be_recosted(
        self, client: TestClient, receptionist: str, invoice, pay
    ) -> None:
        body = invoice()
        assert pay(body, "400.00").status_code == 201

        response = client.put(
            f"{INVOICES}/{body['id']}",
            json={"items": [{"label": "Revised", "qty": 1, "rate": "50.00"}]},
            headers=_auth(receptionist),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "invoice_has_payments"

    def test_an_invoice_from_another_branch_is_not_visible(
        self, client: TestClient, receptionist: str
    ) -> None:
        """Reception is Andheri; a Powai patient's bills are not theirs to read."""
        response = client.get(
            INVOICES, params={"patient": OTHER_BRANCH_PATIENT}, headers=_auth(receptionist)
        )
        assert response.status_code == 404

    def test_patient_invoices_endpoint(self, client: TestClient, accountant: str, invoice) -> None:
        body = invoice()
        rows = client.get(f"{PATIENTS}/{BILLABLE}/invoices", headers=_auth(accountant)).json()
        assert body["id"] in {row["id"] for row in rows}


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


class TestPayments:
    def test_create_payment(self, client: TestClient, invoice, pay) -> None:
        body = invoice()
        response = pay(body, "1000.00")
        assert response.status_code == 201
        payment = response.json()
        assert _rupees(payment["amount"]) == Decimal("1000.00")
        assert payment["method"] == "UPI"
        assert payment["status"] == "Settled"
        # Never taken from the request — the collector is the caller.
        assert payment["collectedBy"] == "Sneha Patil"
        assert payment["invoiceId"] == body["id"]

    def test_partial_payment(self, client: TestClient, accountant: str, invoice, pay) -> None:
        body = invoice()
        assert pay(body, "500.00").status_code == 201

        after = client.get(f"{INVOICES}/{body['id']}", headers=_auth(accountant)).json()
        assert after["status"] == "Partially Paid"
        assert _rupees(after["paid"]) == Decimal("500.00")
        assert _rupees(after["balance"]) == Decimal("500.00")

    def test_full_payment(self, client: TestClient, accountant: str, invoice, pay) -> None:
        body = invoice()
        assert pay(body, "500.00").status_code == 201
        assert pay(body, "500.00").status_code == 201

        after = client.get(f"{INVOICES}/{body['id']}", headers=_auth(accountant)).json()
        assert after["status"] == "Paid"
        assert _rupees(after["paid"]) == Decimal("1000.00")
        assert _rupees(after["balance"]) == Decimal("0.00")

    def test_payment_exceeds_outstanding(self, client: TestClient, invoice, pay) -> None:
        body = invoice()
        response = pay(body, "1500.00")
        assert response.status_code == 409
        assert response.json()["code"] == "amount_exceeds_outstanding"

    def test_paying_a_settled_invoice_is_refused(
        self, client: TestClient, accountant: str, invoice, pay
    ) -> None:
        body = invoice()
        assert pay(body, "1000.00").status_code == 201

        response = pay(body, "100.00")
        assert response.status_code == 409
        assert response.json()["code"] == "invoice_settled"

        after = client.get(f"{INVOICES}/{body['id']}", headers=_auth(accountant)).json()
        assert _rupees(after["amount"]) == Decimal("1000.00"), "the total must not move"
        assert _rupees(after["paid"]) == Decimal("1000.00")

    def test_a_zero_payment_is_refused(self, client: TestClient, invoice, pay) -> None:
        assert pay(invoice(), "0.00").status_code == 422

    def test_a_negative_payment_is_refused(self, client: TestClient, invoice, pay) -> None:
        assert pay(invoice(), "-100.00").status_code == 422

    def test_money_in_flight_does_not_settle_a_balance(
        self, client: TestClient, accountant: str, invoice, pay
    ) -> None:
        """A Processing transfer has not paid anything yet."""
        body = invoice()
        assert pay(body, "1000.00", method="Bank Transfer", status="Processing").status_code == 201

        after = client.get(f"{INVOICES}/{body['id']}", headers=_auth(accountant)).json()
        assert _rupees(after["paid"]) == Decimal("0.00")
        assert after["status"] == "Unpaid"

    def test_settling_a_processing_payment_closes_the_invoice(
        self, client: TestClient, accountant: str, invoice, pay
    ) -> None:
        body = invoice()
        payment = pay(body, "1000.00", method="Bank Transfer", status="Processing").json()

        response = client.patch(
            f"{PAYMENTS}/{payment['id']}/status",
            json={"status": "Settled"},
            headers=_auth(accountant),
        )
        assert response.status_code == 200

        after = client.get(f"{INVOICES}/{body['id']}", headers=_auth(accountant)).json()
        assert after["status"] == "Paid"
        assert _rupees(after["paid"]) == Decimal("1000.00")

    def test_settled_money_cannot_be_put_back_in_flight(
        self, client: TestClient, accountant: str, invoice, pay
    ) -> None:
        payment = pay(invoice(), "1000.00").json()
        response = client.patch(
            f"{PAYMENTS}/{payment['id']}/status",
            json={"status": "Processing"},
            headers=_auth(accountant),
        )
        assert response.status_code == 409

    def test_a_failed_payment_leaves_the_balance_alone(
        self, client: TestClient, accountant: str, invoice, pay
    ) -> None:
        body = invoice()
        assert pay(body, "1000.00", method="Bank Transfer", status="Failed").status_code == 201

        after = client.get(f"{INVOICES}/{body['id']}", headers=_auth(accountant)).json()
        assert _rupees(after["paid"]) == Decimal("0.00")
        assert _rupees(after["balance"]) == Decimal("1000.00")

    def test_a_reference_is_stored_but_never_required(
        self, client: TestClient, invoice, pay
    ) -> None:
        cash = pay(invoice(), "1000.00", method="Cash").json()
        assert cash["reference"] is None, "cash needs no reference"

        upi = pay(invoice(), "1000.00", method="UPI", reference="UPI-77120934").json()
        assert upi["reference"] == "UPI-77120934"

    def test_concurrent_payment(self, client: TestClient, invoice) -> None:
        """Two tills, one ₹1,000 balance, both taking all of it at once.

        Without `FOR UPDATE` both would read ₹1,000 outstanding, both would pass
        the check, and the invoice would end up ₹2,000 collected against a
        ₹1,000 bill with no way to tell which payment was the mistake.
        """
        from app.core.database import SessionLocal
        from app.core.errors import ConflictError
        from app.schemas.billing import PaymentCreate
        from app.services import billing_service as service

        body = invoice()
        permissions = ["patient.view", "billing.view", "billing.manage"]
        barrier = threading.Barrier(2)
        outcomes: list[str] = []
        guard = threading.Lock()

        def take() -> None:
            with SessionLocal() as db:
                staff = db.execute(
                    select(User).where(User.email == "reception@rehab.com")
                ).scalar_one()
                payload = PaymentCreate(amount=Decimal("1000.00"), method="UPI")
                # Both threads reach the lock at the same moment.
                barrier.wait(timeout=10)
                try:
                    service.record_payment(
                        db,
                        identifier=body["id"],
                        payload=payload,
                        user=staff,
                        permissions=permissions,
                        ip=None,
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

        threads = [threading.Thread(target=take) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        assert sorted(outcomes) == ["ok", "refused"], outcomes

        with SessionLocal() as db:
            invoice_id = uuid.UUID(body["uuid"])
            collected = sum(
                (
                    row.amount
                    for row in db.execute(
                        select(Payment).where(
                            Payment.invoice_id == invoice_id,
                            Payment.status == PaymentStatus.SETTLED,
                        )
                    ).scalars()
                ),
                Decimal("0.00"),
            )
        assert collected == Decimal("1000.00"), "an invoice must never be over-collected"


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


class TestExpenses:
    def test_create_expense(self, client: TestClient, accountant: str) -> None:
        response = client.post(
            EXPENSES,
            json={
                "vendor": "Testcase Office Supplies",
                "amount": "2000.00",
                "category": "Utilities",
                "reference": "TEST-0001",
            },
            headers=_auth(accountant),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert _rupees(body["amount"]) == Decimal("2000.00")
        assert body["category"] == "Utilities"
        assert body["status"] == "Recorded"
        assert body["date"] == _clinic_today().isoformat()

    def test_an_uncategorised_expense_lands_in_the_review_queue(
        self, client: TestClient, accountant: str
    ) -> None:
        body = client.post(
            EXPENSES,
            json={"vendor": "Unknown UPI Credit", "amount": "1500.00"},
            headers=_auth(accountant),
        ).json()
        assert body["category"] == "Uncategorised"
        assert body["status"] == "Pending Categorisation"

    def test_update_expense(self, client: TestClient, accountant: str) -> None:
        body = client.post(
            EXPENSES,
            json={"vendor": "Testcase Vendor", "amount": "500.00", "category": "Marketing"},
            headers=_auth(accountant),
        ).json()

        response = client.put(
            f"{EXPENSES}/{body['id']}",
            json={"amount": "750.00", "vendor": "Testcase Vendor Ltd"},
            headers=_auth(accountant),
        )
        assert response.status_code == 200
        updated = response.json()
        assert _rupees(updated["amount"]) == Decimal("750.00")
        assert updated["vendor"] == "Testcase Vendor Ltd"

    def test_categorising_clears_the_review_queue(
        self, client: TestClient, accountant: str
    ) -> None:
        body = client.post(
            EXPENSES,
            json={"vendor": "Unknown UPI Credit", "amount": "1500.00"},
            headers=_auth(accountant),
        ).json()

        updated = client.put(
            f"{EXPENSES}/{body['id']}", json={"category": "Utilities"}, headers=_auth(accountant)
        ).json()
        assert updated["category"] == "Utilities"
        assert updated["status"] == "Recorded"

    def test_a_zero_expense_is_refused(self, client: TestClient, accountant: str) -> None:
        response = client.post(
            EXPENSES, json={"vendor": "Nothing", "amount": "0.00"}, headers=_auth(accountant)
        )
        assert response.status_code == 422

    def test_expense_branch_isolation(
        self, client: TestClient, accountant: str, receptionist: str
    ) -> None:
        """An expense belongs to a branch, and a branch-bound user sees only theirs.

        Reception is the branch-bound reader here, not the admin: the admin
        holds `branches.manage`, which is one of the cross-branch permissions,
        so they see every site by design.
        """
        from app.core.database import SessionLocal
        from app.models import Branch

        with SessionLocal() as db:
            other = (
                db.execute(select(Branch).where(Branch.name.like("Powai%"))).scalars().first()
            )
            assert other is not None
            other_id = str(other.id)

        body = client.post(
            EXPENSES,
            json={
                "vendor": "Powai Facilities",
                "amount": "3000.00",
                "category": "Maintenance",
                "branchId": other_id,
            },
            headers=_auth(accountant),
        ).json()

        # Reception is bound to Andheri West and must not see it, by id or in a list.
        assert (
            client.get(f"{EXPENSES}/{body['id']}", headers=_auth(receptionist)).status_code == 404
        )
        listed = client.get(EXPENSES, params={"limit": 100}, headers=_auth(receptionist)).json()
        assert body["id"] not in {row["id"] for row in listed["items"]}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class TestDashboard:
    def test_revenue_calculation(self, client: TestClient, accountant: str, invoice, pay) -> None:
        """Revenue is collected money, so raising a bill moves nothing."""
        before = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()

        body = invoice(items=[{"label": "Consultation", "qty": 1, "rate": "1000.00"}])
        raised = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()
        assert _rupees(raised["todayRevenue"]) == _rupees(before["todayRevenue"])

        pay(body, "1000.00")
        collected = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()
        assert _rupees(collected["todayRevenue"]) == _rupees(before["todayRevenue"]) + Decimal(
            "1000.00"
        )

    def test_outstanding_calculation(
        self, client: TestClient, accountant: str, invoice, pay
    ) -> None:
        before = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()

        body = invoice(items=[{"label": "Therapy", "qty": 1, "rate": "5000.00"}])
        after = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()
        assert _rupees(after["outstandingAmount"]) == _rupees(
            before["outstandingAmount"]
        ) + Decimal("5000.00")
        assert after["outstandingInvoices"] == before["outstandingInvoices"] + 1

        pay(body, "2000.00")
        part = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()
        assert _rupees(part["outstandingAmount"]) == _rupees(
            before["outstandingAmount"]
        ) + Decimal("3000.00")

    def test_expense_calculation(self, client: TestClient, accountant: str) -> None:
        before = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()

        client.post(
            EXPENSES,
            json={"vendor": "Testcase Utilities", "amount": "2000.00", "category": "Utilities"},
            headers=_auth(accountant),
        )
        after = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()
        assert _rupees(after["totalExpenses"]) == _rupees(before["totalExpenses"]) + Decimal(
            "2000.00"
        )

    def test_net_revenue(self, client: TestClient, accountant: str) -> None:
        body = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()
        assert _rupees(body["netRevenue"]) == _rupees(body["monthlyRevenue"]) - _rupees(
            body["totalExpenses"]
        )

    def test_a_negative_net_is_shown_not_hidden(
        self, client: TestClient, accountant: str
    ) -> None:
        """A month that spent more than it collected reports a loss."""
        client.post(
            EXPENSES,
            json={"vendor": "Testcase Overspend", "amount": "99999999.00", "category": "Equipment"},
            headers=_auth(accountant),
        )
        body = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()
        assert _rupees(body["netRevenue"]) < Decimal("0")

    def test_the_ageing_buckets_add_up_to_the_outstanding_total(
        self, client: TestClient, accountant: str
    ) -> None:
        dashboard = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()
        buckets = client.get(f"{BILLING}/ageing", headers=_auth(accountant)).json()

        assert [b["bucket"] for b in buckets] == [
            "Not yet due",
            "1–15 days",
            "16–30 days",
            "30+ days",
        ]
        assert sum((_rupees(b["amount"]) for b in buckets), Decimal("0")) == _rupees(
            dashboard["outstandingAmount"]
        )

    def test_the_profit_and_loss_series_is_continuous(
        self, client: TestClient, accountant: str
    ) -> None:
        """A quiet month is a zero column, not a missing one."""
        series = client.get(
            f"{BILLING}/reports/revenue", params={"months": 6}, headers=_auth(accountant)
        ).json()
        assert len(series) == 6
        for row in series:
            assert _rupees(row["profit"]) == _rupees(row["revenue"]) - _rupees(row["expenses"])

    def test_pharmacy_sale_not_double_counted(
        self, client: TestClient, accountant: str, receptionist: str
    ) -> None:
        """A counter sale is revenue exactly once — never as sale *and* invoice.

        POS sales live in their own table and are never mirrored into
        `invoices`, so the dashboard adds the two sources without overlap. A
        ₹500 sale must move the day's takings by ₹500, not ₹1,000.
        """
        pharmacist = _token(client, "pharmacy@rehab.com")
        before = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()

        products = client.get("/api/pharmacy/pos/products", headers=_auth(pharmacist)).json()
        sellable = next((p for p in products if p["quantity"] > 0), None)
        assert sellable is not None, "the seeded catalogue must have something in stock"

        sale = client.post(
            "/api/pharmacy/pos/sale",
            json={
                "items": [{"medicineId": sellable["id"], "quantity": 1}],
                "paymentMethod": "Cash",
            },
            headers=_auth(pharmacist),
        )
        assert sale.status_code == 201, sale.text
        total = _rupees(sale.json()["total"])

        after = client.get(f"{BILLING}/dashboard", headers=_auth(accountant)).json()
        moved = _rupees(after["todayRevenue"]) - _rupees(before["todayRevenue"])
        assert moved == total, f"the sale moved revenue by {moved}, not {total}"

        # And it did not appear as an invoice.
        invoices = client.get(
            INVOICES, params={"limit": 100, "date_from": _clinic_today().isoformat()},
            headers=_auth(accountant),
        ).json()
        assert sale.json()["id"] not in {row["id"] for row in invoices["items"]}


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


class TestFinancialPermissions:
    @pytest.mark.parametrize("role", ["doctor", "nurse", "therapist"])
    def test_doctor_cannot_access_financial_data(
        self, client: TestClient, request: pytest.FixtureRequest, role: str
    ) -> None:
        """Clinical staff hold none of the billing keys, by design."""
        token = request.getfixturevalue(role)
        for path in (
            f"{BILLING}/dashboard",
            INVOICES,
            PAYMENTS,
            EXPENSES,
            f"{BILLING}/reports/revenue",
        ):
            assert client.get(path, headers=_auth(token)).status_code == 403, path

    def test_a_doctor_cannot_raise_an_invoice(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            INVOICES,
            json={
                "patientId": BILLABLE,
                "items": [{"label": "Consultation", "qty": 1, "rate": "1000.00"}],
            },
            headers=_auth(doctor),
        )
        assert response.status_code == 403

    def test_a_doctor_cannot_see_invoices_on_patient_360(
        self, client: TestClient, doctor: str
    ) -> None:
        body = client.get(f"{PATIENTS}/{BILLABLE}/360", headers=_auth(doctor)).json()
        assert body["invoices"] == []
        assert "invoices" in body["restrictedSections"]

    def test_accountant_can_view_financial_data(self, client: TestClient, accountant: str) -> None:
        for path in (
            f"{BILLING}/dashboard",
            f"{BILLING}/ageing",
            f"{BILLING}/reports/revenue",
            f"{BILLING}/reports/expenses",
            f"{BILLING}/reports/departments",
            INVOICES,
            PAYMENTS,
            EXPENSES,
        ):
            assert client.get(path, headers=_auth(accountant)).status_code == 200, path

    def test_reception_can_bill_and_collect(self, client: TestClient, receptionist: str) -> None:
        assert client.get(INVOICES, headers=_auth(receptionist)).status_code == 200
        assert client.get(EXPENSES, headers=_auth(receptionist)).status_code == 200

    def test_reception_cannot_record_expenses(self, client: TestClient, receptionist: str) -> None:
        """`expenses.manage` belongs to the accountant, not the front desk."""
        response = client.post(
            EXPENSES,
            json={"vendor": "Front desk stationery", "amount": "500.00"},
            headers=_auth(receptionist),
        )
        assert response.status_code == 403

    def test_reception_cannot_read_the_finance_reports(
        self, client: TestClient, receptionist: str
    ) -> None:
        assert (
            client.get(f"{BILLING}/reports/revenue", headers=_auth(receptionist)).status_code == 403
        )
