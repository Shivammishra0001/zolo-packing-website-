"""Pharmacy tests: catalogue, batches, inventory, dispensing and the till.

Runs against real PostgreSQL with the demo data seeded:

    python seed.py && python seed_patients.py && python seed_appointments.py
    python seed_clinical.py && python seed_rehab.py

Every test that writes cleans up after itself, so a run leaves the seeded
inventory exactly as it found it.
"""

from __future__ import annotations

import threading
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import (
    DispenseRecord,
    Medicine,
    MedicineBatch,
    Patient,
    PharmacySale,
    PharmacySaleItem,
    Prescription,
    PrescriptionItem,
    User,
)

DEMO_PASSWORD = "Rehab@123"
MEDICINES = "/api/medicines"
PHARMACY = "/api/pharmacy"
POS = "/api/pharmacy/pos"
PRESCRIPTIONS = "/api/prescriptions"

PATIENT = "PT-10248"


def _token(client: TestClient, email: str) -> str:
    response = client.post(
        "/api/auth/login", json={"email": email, "password": DEMO_PASSWORD, "remember": False}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _unique(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


@pytest.fixture(scope="module")
def seeded() -> None:
    from app.core.database import SessionLocal, check_database_connection

    ok, _ = check_database_connection()
    if not ok:
        pytest.skip("PostgreSQL is not reachable")

    with SessionLocal() as db:
        have = all(
            db.execute(select(model).limit(1)).scalar_one_or_none() is not None
            for model in (User, Patient, Medicine, Prescription)
        )
    if not have:
        pytest.skip("Demo data not seeded — run seed.py, seed_patients.py and seed_clinical.py")


@pytest.fixture(autouse=True, scope="module")
def _no_leaked_pharmacy_rows(seeded: None):
    """Remove every pharmacy row this module writes, and restore batch stock."""
    from app.core.database import SessionLocal

    # Ordered so children go before parents: a test prescription references a
    # test medicine, which cannot be deleted while that reference stands.
    created = (
        PharmacySaleItem,
        PharmacySale,
        DispenseRecord,
        PrescriptionItem,
        Prescription,
        MedicineBatch,
        Medicine,
    )

    with SessionLocal() as db:
        before = {m: list(db.execute(select(m.id)).scalars()) for m in created}
        # Batch quantities and dispensed counts move during the run, so both are
        # snapshotted and put back.
        stock = dict(db.execute(select(MedicineBatch.id, MedicineBatch.quantity)).all())
        issued = dict(
            db.execute(select(PrescriptionItem.id, PrescriptionItem.quantity_dispensed)).all()
        )
        statuses = dict(db.execute(select(Prescription.id, Prescription.status)).all())

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

        for batch in db.execute(select(MedicineBatch)).scalars():
            if batch.id in stock:
                batch.quantity = stock[batch.id]
                db.add(batch)
        for item in db.execute(select(PrescriptionItem)).scalars():
            if item.id in issued:
                item.quantity_dispensed = issued[item.id]
                db.add(item)
        for prescription in db.execute(select(Prescription)).scalars():
            if prescription.id in statuses:
                prescription.status = statuses[prescription.id]
                db.add(prescription)
        db.commit()


@pytest.fixture(scope="module")
def pharmacist(client: TestClient, seeded: None) -> str:
    return _token(client, "pharmacy@rehab.com")


@pytest.fixture(scope="module")
def doctor(client: TestClient, seeded: None) -> str:
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def receptionist(client: TestClient, seeded: None) -> str:
    return _token(client, "reception@rehab.com")


@pytest.fixture(scope="module")
def accountant(client: TestClient, seeded: None) -> str:
    return _token(client, "accounts@rehab.com")


@pytest.fixture
def medicine(client: TestClient, pharmacist: str):
    """Create a medicine, optionally with an opening batch."""

    def _create(**overrides) -> dict:
        payload = {
            "name": _unique("Testcase Paracetamol"),
            "genericName": "Paracetamol",
            "category": "Analgesic",
            "manufacturer": "Cipla",
            "rackLocation": "Z-9-99",
            "threshold": 20,
        }
        payload.update(overrides)
        response = client.post(MEDICINES, json=payload, headers=_auth(pharmacist))
        assert response.status_code == 201, response.text
        return response.json()

    return _create


@pytest.fixture
def batch(client: TestClient, pharmacist: str):
    """Receive a batch into a medicine."""

    def _add(med: dict, **overrides) -> dict:
        payload = {
            "batchNumber": _unique("B"),
            "quantity": 100,
            "purchasePrice": "8.00",
            "sellingPrice": "10.00",
            "mrp": "12.00",
            "expiry": (date.today() + timedelta(days=365)).isoformat(),
        }
        payload.update(overrides)
        response = client.post(
            f"{MEDICINES}/{med['id']}/batches", json=payload, headers=_auth(pharmacist)
        )
        assert response.status_code == 201, response.text
        return response.json()

    return _add


# ---------------------------------------------------------------------------
# Medicines
# ---------------------------------------------------------------------------


class TestMedicines:
    def test_create_medicine(self, medicine) -> None:
        body = medicine()

        assert body["id"].startswith("MED-")
        assert body["genericName"] == "Paracetamol"
        assert body["threshold"] == 20
        # Stock lives on batches, so a fresh medicine has none.
        assert body["quantity"] == 0
        assert body["status"] == "Out of Stock"
        assert body["batches"] == []

    def test_create_medicine_with_opening_batch(self, medicine) -> None:
        body = medicine(
            batch={
                "batchNumber": "OPENING-1",
                "quantity": 100,
                "purchasePrice": "8.00",
                "sellingPrice": "10.00",
                "mrp": "12.00",
                "expiry": (date.today() + timedelta(days=400)).isoformat(),
            }
        )
        assert body["quantity"] == 100
        assert body["status"] == "In Stock"
        assert len(body["batches"]) == 1

    def test_duplicate_medicine_is_refused(self, client: TestClient, pharmacist: str, medicine) -> None:
        existing = medicine()
        response = client.post(
            MEDICINES,
            json={"name": existing["name"], "threshold": 10},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "duplicate_medicine"

    def test_negative_reorder_level_is_refused(self, client: TestClient, pharmacist: str) -> None:
        response = client.post(
            MEDICINES, json={"name": _unique("Negative"), "threshold": -5}, headers=_auth(pharmacist)
        )
        assert response.status_code == 422

    def test_search_medicines(self, client: TestClient, pharmacist: str) -> None:
        """Search spans name, generic name, category and manufacturer."""
        for term, expect in (
            ("para", "name"),
            ("analgesic", "category"),
            ("cipla", "manufacturer"),
        ):
            response = client.get(f"{MEDICINES}?search={term}", headers=_auth(pharmacist))
            assert response.status_code == 200, response.text
            assert response.json()["items"], f"no match for {term!r} ({expect})"

        empty = client.get(f"{MEDICINES}?search=zzzznotamedicine", headers=_auth(pharmacist))
        assert empty.json()["items"] == []

    def test_get_medicine_by_code_and_uuid(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        created = medicine()
        batch(created)

        by_code = client.get(f"{MEDICINES}/{created['id']}", headers=_auth(pharmacist))
        by_uuid = client.get(f"{MEDICINES}/{created['uuid']}", headers=_auth(pharmacist))
        assert by_code.status_code == 200 and by_uuid.status_code == 200
        assert by_code.json()["uuid"] == by_uuid.json()["uuid"]
        assert by_code.json()["quantity"] == 100

    def test_update_medicine(self, client: TestClient, pharmacist: str, medicine) -> None:
        created = medicine()
        response = client.put(
            f"{MEDICINES}/{created['id']}",
            json={"threshold": 75, "rackLocation": "B-2-01"},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 200, response.text
        assert response.json()["threshold"] == 75
        assert response.json()["rackLocation"] == "B-2-01"

    def test_unknown_medicine_is_404(self, client: TestClient, pharmacist: str) -> None:
        assert client.get(f"{MEDICINES}/MED-9999", headers=_auth(pharmacist)).status_code == 404


# ---------------------------------------------------------------------------
# Batches
# ---------------------------------------------------------------------------


class TestBatches:
    def test_create_batch(self, medicine, batch) -> None:
        created = medicine()
        body = batch(created, quantity=250)

        assert body["quantity"] == 250
        assert body["expired"] is False
        assert body["daysToExpiry"] > 300

    def test_duplicate_batch(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        created = medicine()
        first = batch(created)

        response = client.post(
            f"{MEDICINES}/{created['id']}/batches",
            json={
                "batchNumber": first["batchNumber"],
                "quantity": 50,
                "purchasePrice": "8.00",
                "sellingPrice": "10.00",
                "expiry": (date.today() + timedelta(days=200)).isoformat(),
            },
            headers=_auth(pharmacist),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "duplicate_batch"

    def test_expired_batch_cannot_be_received(
        self, client: TestClient, pharmacist: str, medicine
    ) -> None:
        created = medicine()
        response = client.post(
            f"{MEDICINES}/{created['id']}/batches",
            json={
                "batchNumber": "PAST-1",
                "quantity": 50,
                "purchasePrice": "8.00",
                "sellingPrice": "10.00",
                "expiry": (date.today() - timedelta(days=1)).isoformat(),
            },
            headers=_auth(pharmacist),
        )
        assert response.status_code == 422
        assert "expired" in response.json()["detail"].lower()

    def test_negative_quantity_is_refused(self, client: TestClient, pharmacist: str, medicine) -> None:
        created = medicine()
        response = client.post(
            f"{MEDICINES}/{created['id']}/batches",
            json={
                "batchNumber": "NEG-1",
                "quantity": -5,
                "purchasePrice": "8.00",
                "sellingPrice": "10.00",
                "expiry": (date.today() + timedelta(days=200)).isoformat(),
            },
            headers=_auth(pharmacist),
        )
        assert response.status_code == 422

    def test_batches_are_listed_earliest_expiry_first(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        created = medicine()
        batch(created, expiry=(date.today() + timedelta(days=300)).isoformat())
        batch(created, expiry=(date.today() + timedelta(days=100)).isoformat())

        response = client.get(f"{MEDICINES}/{created['id']}/batches", headers=_auth(pharmacist))
        assert response.status_code == 200
        expiries = [b["expiry"] for b in response.json()]
        assert expiries == sorted(expiries)

    def test_batch_correction_is_allowed_and_audited(
        self, client: TestClient, pharmacist: str, medicine, batch
    ) -> None:
        from app.core.database import SessionLocal
        from app.models import AuditLog

        created = medicine()
        made = batch(created, quantity=100)

        response = client.put(
            f"/api/medicine-batches/{made['id']}", json={"quantity": 92}, headers=_auth(pharmacist)
        )
        assert response.status_code == 200, response.text
        assert response.json()["quantity"] == 92

        with SessionLocal() as db:
            entry = db.execute(
                select(AuditLog)
                .where(AuditLog.target_id == uuid.UUID(made["id"]))
                .order_by(AuditLog.created_at.desc())
                .limit(1)
            ).scalar_one()
        assert entry.action == "INVENTORY_UPDATED"
        assert "100 -> 92" in entry.summary


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------


class TestInventory:
    def test_inventory_aggregation(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        """Stock is the sum across batches, not one arbitrary batch."""
        created = medicine()
        batch(created, quantity=100, expiry=(date.today() + timedelta(days=300)).isoformat())
        batch(created, quantity=50, expiry=(date.today() + timedelta(days=200)).isoformat())
        batch(created, quantity=75, expiry=(date.today() + timedelta(days=400)).isoformat())

        detail = client.get(f"{MEDICINES}/{created['id']}", headers=_auth(pharmacist)).json()
        assert detail["quantity"] == 225
        assert len(detail["batches"]) == 3
        # The flat display shows the batch the next unit would come from.
        assert detail["expiry"] == (date.today() + timedelta(days=200)).isoformat()

        listed = client.get(f"{PHARMACY}/inventory", headers=_auth(pharmacist)).json()
        row = next(m for m in listed if m["id"] == created["id"])
        assert row["quantity"] == 225

    def test_low_stock(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        created = medicine(threshold=100)
        batch(created, quantity=40)

        rows = client.get(f"{PHARMACY}/inventory/low-stock", headers=_auth(pharmacist)).json()
        row = next((m for m in rows if m["id"] == created["id"]), None)
        assert row is not None, "40 of a 100 threshold is low stock"
        assert row["quantity"] <= row["threshold"]
        assert all(m["quantity"] <= m["threshold"] for m in rows)

    def test_near_expiry(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        """The window is 45 days, taken from the frontend's own threshold."""
        created = medicine()
        batch(created, quantity=60, expiry=(date.today() + timedelta(days=30)).isoformat())

        rows = client.get(f"{PHARMACY}/inventory/near-expiry", headers=_auth(pharmacist)).json()
        assert created["id"] in {m["id"] for m in rows}

        outside = medicine()
        batch(outside, quantity=60, expiry=(date.today() + timedelta(days=60)).isoformat())
        rows = client.get(f"{PHARMACY}/inventory/near-expiry", headers=_auth(pharmacist)).json()
        assert outside["id"] not in {m["id"] for m in rows}

    def test_expired_batch_is_not_stock(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        """An expired batch holds units but none of them count as stock."""
        from app.core.database import SessionLocal

        created = medicine()
        made = batch(created, quantity=80)

        # Age it past today, which the API refuses to do directly.
        with SessionLocal() as db:
            row = db.execute(
                select(MedicineBatch).where(MedicineBatch.id == uuid.UUID(made["id"]))
            ).scalar_one()
            row.expiry_date = date.today() - timedelta(days=2)
            db.add(row)
            db.commit()

        detail = client.get(f"{MEDICINES}/{created['id']}", headers=_auth(pharmacist)).json()
        assert detail["quantity"] == 0
        assert detail["status"] == "Out of Stock"
        assert detail["batches"][0]["expired"] is True
        # And the value of expired stock is excluded.
        assert Decimal(detail["stockValueAtCost"]) == 0

    def test_inventory_status_filter(self, client: TestClient, pharmacist: str) -> None:
        rows = client.get(f"{PHARMACY}/inventory?status=Low Stock", headers=_auth(pharmacist)).json()
        assert all(m["status"] == "Low Stock" for m in rows)


# ---------------------------------------------------------------------------
# Dispensing
# ---------------------------------------------------------------------------


@pytest.fixture
def prescription(client: TestClient, doctor: str, medicine, batch):
    """Write a prescription for a freshly stocked medicine."""

    def _create(quantity: int = 20, stock: int = 100, **kwargs) -> tuple[dict, dict]:
        med = medicine(**kwargs.pop("medicine_kwargs", {}))
        batch(med, quantity=stock, **kwargs.pop("batch_kwargs", {}))

        response = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "items": [
                    {
                        "medicine": med["name"],
                        "dosage": "1 tablet",
                        "frequency": "Twice daily",
                        "duration": "10 days",
                        "quantity": quantity,
                    }
                ],
            },
            headers=_auth(doctor),
        )
        assert response.status_code == 201, response.text
        return response.json(), med

    return _create


def _item_ids(client: TestClient, token: str, prescription_id: str) -> list[str]:
    from app.core.database import SessionLocal

    with SessionLocal() as db:
        row = db.execute(
            select(Prescription).where(Prescription.prescription_number == prescription_id)
        ).scalar_one()
        return [str(i.id) for i in row.items]


class TestDispensing:
    def test_dispense_prescription(self, client: TestClient, pharmacist: str, prescription) -> None:
        rx, med = prescription(quantity=20, stock=100)
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        response = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 20}]},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "Dispensed"
        assert sum(r["quantity"] for r in body["records"]) == 20

        # Stock fell by exactly what was issued.
        detail = client.get(f"{MEDICINES}/{med['id']}", headers=_auth(pharmacist)).json()
        assert detail["quantity"] == 80

    def test_partial_dispensing(self, client: TestClient, pharmacist: str, prescription) -> None:
        rx, med = prescription(quantity=20, stock=100)
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        first = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 8}]},
            headers=_auth(pharmacist),
        )
        assert first.status_code == 200, first.text
        assert first.json()["status"] == "Partially Dispensed"

        detail = client.get(f"{MEDICINES}/{med['id']}", headers=_auth(pharmacist)).json()
        assert detail["quantity"] == 92

    def test_full_dispensing_after_a_partial(self, client: TestClient, pharmacist: str, prescription) -> None:
        rx, _ = prescription(quantity=20, stock=100)
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 12}]},
            headers=_auth(pharmacist),
        )
        second = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 8}]},
            headers=_auth(pharmacist),
        )
        assert second.status_code == 200, second.text
        assert second.json()["status"] == "Dispensed"

        # A third attempt has nothing left to give.
        third = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 1}]},
            headers=_auth(pharmacist),
        )
        assert third.status_code == 409
        assert third.json()["code"] == "already_dispensed"

    def test_cannot_dispense_more_than_prescribed(
        self, client: TestClient, pharmacist: str, prescription
    ) -> None:
        rx, _ = prescription(quantity=20, stock=100)
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        response = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 25}]},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 422
        assert "remain on this prescription" in response.json()["detail"]

    def test_insufficient_stock(self, client: TestClient, pharmacist: str, prescription) -> None:
        rx, med = prescription(quantity=50, stock=10)
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        response = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 50}]},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "insufficient_stock"

        # Nothing moved.
        detail = client.get(f"{MEDICINES}/{med['id']}", headers=_auth(pharmacist)).json()
        assert detail["quantity"] == 10

    def test_expired_stock(self, client: TestClient, pharmacist: str, prescription) -> None:
        from app.core.database import SessionLocal

        rx, med = prescription(quantity=10, stock=100)
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        with SessionLocal() as db:
            for row in db.execute(
                select(MedicineBatch).where(MedicineBatch.medicine_id == uuid.UUID(med["uuid"]))
            ).scalars():
                row.expiry_date = date.today() - timedelta(days=1)
                db.add(row)
            db.commit()

        response = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 10}]},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "expired_stock"

    def test_fefo_batch_selection(self, client: TestClient, pharmacist: str, doctor: str, medicine, batch) -> None:
        """15 units from a 10-unit early batch and a 50-unit later one: 10 + 5."""
        from app.core.database import SessionLocal

        med = medicine()
        early = batch(med, quantity=10, expiry=(date.today() + timedelta(days=30)).isoformat())
        later = batch(med, quantity=50, expiry=(date.today() + timedelta(days=300)).isoformat())

        rx = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "items": [
                    {
                        "medicine": med["name"],
                        "dosage": "1 tablet",
                        "frequency": "Once daily",
                        "duration": "15 days",
                        "quantity": 15,
                    }
                ],
            },
            headers=_auth(doctor),
        ).json()
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        response = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 15}]},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 200, response.text

        by_batch = {r["batchNumber"]: r["quantity"] for r in response.json()["records"]}
        assert by_batch == {early["batchNumber"]: 10, later["batchNumber"]: 5}

        with SessionLocal() as db:
            quantities = {
                b.batch_number: b.quantity
                for b in db.execute(
                    select(MedicineBatch).where(MedicineBatch.medicine_id == uuid.UUID(med["uuid"]))
                ).scalars()
            }
        assert quantities[early["batchNumber"]] == 0
        assert quantities[later["batchNumber"]] == 45

    def test_dispense_records_are_written(self, client: TestClient, pharmacist: str, prescription) -> None:
        from app.core.database import SessionLocal

        rx, _ = prescription(quantity=10, stock=100)
        item_id = _item_ids(client, pharmacist, rx["id"])[0]
        client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 10}]},
            headers=_auth(pharmacist),
        )

        with SessionLocal() as db:
            records = db.execute(
                select(DispenseRecord).where(
                    DispenseRecord.prescription_item_id == uuid.UUID(item_id)
                )
            ).scalars().all()
        assert records
        assert sum(r.quantity for r in records) == 10
        assert all(r.dispensed_by is not None for r in records)
        assert all(r.medicine_batch_id is not None for r in records)

    def test_a_bad_line_rolls_the_whole_dispense_back(
        self, client: TestClient, pharmacist: str, doctor: str, medicine, batch
    ) -> None:
        """The first line must not be issued when the second is invalid."""
        good = medicine()
        batch(good, quantity=100)
        short = medicine()
        batch(short, quantity=2)

        rx = client.post(
            PRESCRIPTIONS,
            json={
                "patientId": PATIENT,
                "items": [
                    {"medicine": good["name"], "dosage": "1", "frequency": "Once daily", "duration": "5 days", "quantity": 10},
                    {"medicine": short["name"], "dosage": "1", "frequency": "Once daily", "duration": "5 days", "quantity": 10},
                ],
            },
            headers=_auth(doctor),
        ).json()
        items = _item_ids(client, pharmacist, rx["id"])

        response = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={
                "items": [
                    {"prescriptionItemId": items[0], "quantity": 10},
                    {"prescriptionItemId": items[1], "quantity": 10},
                ]
            },
            headers=_auth(pharmacist),
        )
        assert response.status_code == 409

        # Neither medicine moved.
        assert client.get(f"{MEDICINES}/{good['id']}", headers=_auth(pharmacist)).json()["quantity"] == 100
        assert client.get(f"{MEDICINES}/{short['id']}", headers=_auth(pharmacist)).json()["quantity"] == 2
        assert client.get(f"{PRESCRIPTIONS}/{rx['id']}", headers=_auth(pharmacist)).json()["status"] == "Pending"

    def test_invalid_quantity_is_refused(self, client: TestClient, pharmacist: str, prescription) -> None:
        rx, _ = prescription()
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        for quantity in (0, -5):
            response = client.post(
                f"{PRESCRIPTIONS}/{rx['id']}/dispense",
                json={"items": [{"prescriptionItemId": item_id, "quantity": quantity}]},
                headers=_auth(pharmacist),
            )
            assert response.status_code == 422, quantity

    def test_unknown_prescription_is_404(self, client: TestClient, pharmacist: str) -> None:
        response = client.post(
            f"{PRESCRIPTIONS}/{uuid.uuid4()}/dispense",
            json={"items": [{"prescriptionItemId": str(uuid.uuid4()), "quantity": 1}]},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------


class TestConcurrency:
    def test_concurrent_stock_protection(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        """Two tills, 10 units, 8 each: one succeeds, one is refused.

        Without `FOR UPDATE` both would read 10, both would pass the check and
        stock would end at -6.
        """
        from app.core.database import SessionLocal
        from app.core.errors import ConflictError
        from app.services import pharmacy_service as service

        med = medicine()
        batch(med, quantity=10)
        medicine_id = uuid.UUID(med["uuid"])

        barrier = threading.Barrier(2)
        outcomes: list[str] = []
        lock = threading.Lock()

        def draw() -> None:
            with SessionLocal() as db:
                row = db.execute(select(Medicine).where(Medicine.id == medicine_id)).scalar_one()
                # Both threads reach the deduction at the same moment.
                barrier.wait(timeout=10)
                try:
                    service._draw_stock(db, row, 8)
                    db.commit()
                    result = "ok"
                except ConflictError:
                    db.rollback()
                    result = "refused"
                except Exception as exc:  # pragma: no cover - surfaced on failure
                    db.rollback()
                    result = f"error: {exc}"
            with lock:
                outcomes.append(result)

        threads = [threading.Thread(target=draw) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        assert sorted(outcomes) == ["ok", "refused"], outcomes

        with SessionLocal() as db:
            remaining = db.execute(
                select(MedicineBatch.quantity).where(MedicineBatch.medicine_id == medicine_id)
            ).scalar_one()
        assert remaining == 2, "stock must never go negative"


# ---------------------------------------------------------------------------
# Point of sale
# ---------------------------------------------------------------------------


class TestPOS:
    def test_pos_sale(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        med = medicine()
        batch(med, quantity=100, mrp="12.00")

        response = client.post(
            f"{POS}/sale",
            json={"items": [{"medicineId": med["id"], "quantity": 3}], "paymentMethod": "UPI"},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 201, response.text
        body = response.json()

        assert body["id"].startswith("POS-")
        assert body["paymentMethod"] == "UPI"
        assert body["soldBy"] == "Rohit Malhotra"
        # A walk-in sale needs no patient.
        assert body["patientId"] is None
        assert len(body["items"]) == 1
        assert body["items"][0]["quantity"] == 3

    def test_pos_total_calculation(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        """3 x 12.00 = 36.00, less 10% = 32.40 -> 32, plus 12% GST."""
        med = medicine()
        batch(med, quantity=100, mrp="12.00")

        body = client.post(
            f"{POS}/sale",
            json={
                "items": [{"medicineId": med["id"], "quantity": 3}],
                "discountPercent": 10,
                "paymentMethod": "Cash",
            },
            headers=_auth(pharmacist),
        ).json()

        assert Decimal(body["subtotal"]) == Decimal("36")
        assert Decimal(body["discount"]) == Decimal("4")  # 3.60 rounded half-up
        assert Decimal(body["taxPercent"]) == Decimal("12")
        assert Decimal(body["tax"]) == Decimal("4")  # 12% of 32
        assert Decimal(body["total"]) == Decimal("36")  # 32 + 4

    def test_prices_are_not_taken_from_the_request(
        self, client: TestClient, pharmacist: str, medicine, batch
    ) -> None:
        med = medicine()
        batch(med, quantity=100, mrp="12.00")

        body = client.post(
            f"{POS}/sale",
            json={
                "items": [{"medicineId": med["id"], "quantity": 2, "unitPrice": "0.01"}],
                "subtotal": "0.02",
                "total": "0.02",
                "paymentMethod": "Cash",
            },
            headers=_auth(pharmacist),
        ).json()

        assert Decimal(body["items"][0]["unitPrice"]) == Decimal("12")
        assert Decimal(body["subtotal"]) == Decimal("24")

    def test_pos_stock_deduction(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        med = medicine()
        batch(med, quantity=100)

        client.post(
            f"{POS}/sale",
            json={"items": [{"medicineId": med["id"], "quantity": 7}], "paymentMethod": "Card"},
            headers=_auth(pharmacist),
        )

        detail = client.get(f"{MEDICINES}/{med['id']}", headers=_auth(pharmacist)).json()
        assert detail["quantity"] == 93

    def test_pos_uses_fefo(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        med = medicine()
        early = batch(med, quantity=4, expiry=(date.today() + timedelta(days=40)).isoformat())
        later = batch(med, quantity=50, expiry=(date.today() + timedelta(days=400)).isoformat())

        body = client.post(
            f"{POS}/sale",
            json={"items": [{"medicineId": med["id"], "quantity": 6}], "paymentMethod": "Cash"},
            headers=_auth(pharmacist),
        ).json()

        by_batch = {i["batchNumber"]: i["quantity"] for i in body["items"]}
        assert by_batch == {early["batchNumber"]: 4, later["batchNumber"]: 2}

    def test_pos_insufficient_stock(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        med = medicine()
        batch(med, quantity=3)

        response = client.post(
            f"{POS}/sale",
            json={"items": [{"medicineId": med["id"], "quantity": 10}], "paymentMethod": "Cash"},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "insufficient_stock"

        assert client.get(f"{MEDICINES}/{med['id']}", headers=_auth(pharmacist)).json()["quantity"] == 3

    def test_a_bad_line_rolls_the_whole_sale_back(
        self, client: TestClient, pharmacist: str, medicine, batch
    ) -> None:
        from app.core.database import SessionLocal

        good = medicine()
        batch(good, quantity=100)
        short = medicine()
        batch(short, quantity=1)

        with SessionLocal() as db:
            before = db.execute(select(PharmacySale.id)).scalars().all()

        response = client.post(
            f"{POS}/sale",
            json={
                "items": [
                    {"medicineId": good["id"], "quantity": 5},
                    {"medicineId": short["id"], "quantity": 5},
                ],
                "paymentMethod": "Cash",
            },
            headers=_auth(pharmacist),
        )
        assert response.status_code == 409

        assert client.get(f"{MEDICINES}/{good['id']}", headers=_auth(pharmacist)).json()["quantity"] == 100
        with SessionLocal() as db:
            after = db.execute(select(PharmacySale.id)).scalars().all()
        assert set(after) == set(before), "the rejected sale left nothing behind"

    def test_pos_sale_for_a_registered_patient(
        self, client: TestClient, pharmacist: str, medicine, batch
    ) -> None:
        med = medicine()
        batch(med, quantity=50)

        body = client.post(
            f"{POS}/sale",
            json={
                "items": [{"medicineId": med["id"], "quantity": 2}],
                "patientId": PATIENT,
                "paymentMethod": "Insurance",
            },
            headers=_auth(pharmacist),
        ).json()
        assert body["patientId"] == PATIENT
        assert body["patientName"] == "Raj Kumar"

    def test_sales_history_and_receipt(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        med = medicine()
        batch(med, quantity=50)
        sale = client.post(
            f"{POS}/sale",
            json={"items": [{"medicineId": med["id"], "quantity": 2}], "paymentMethod": "Cash"},
            headers=_auth(pharmacist),
        ).json()

        listed = client.get(f"{POS}/sales?limit=200", headers=_auth(pharmacist))
        assert listed.status_code == 200
        assert sale["id"] in {s["id"] for s in listed.json()["items"]}

        receipt = client.get(f"{POS}/sales/{sale['id']}", headers=_auth(pharmacist))
        assert receipt.status_code == 200
        assert receipt.json()["uuid"] == sale["uuid"]

    def test_pos_products_are_searchable(self, client: TestClient, pharmacist: str) -> None:
        response = client.get(f"{POS}/products?search=para", headers=_auth(pharmacist))
        assert response.status_code == 200, response.text
        assert response.json()
        assert all("quantity" in p and "mrp" in p for p in response.json())


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class TestDashboard:
    def test_dashboard_counts_are_real(self, client: TestClient, pharmacist: str) -> None:
        response = client.get(f"{PHARMACY}/dashboard", headers=_auth(pharmacist))
        assert response.status_code == 200, response.text
        body = response.json()

        assert set(body) >= {
            "pendingPrescriptions",
            "dispensedToday",
            "salesToday",
            "ordersToday",
            "lowStock",
            "outOfStock",
            "nearExpiry",
            "inventoryValueAtCost",
            "inventoryValueAtRetail",
            "salesTrend",
        }
        assert len(body["salesTrend"]) == 7

        # The four status counts partition the catalogue.
        inventory = client.get(f"{PHARMACY}/inventory", headers=_auth(pharmacist)).json()
        assert (
            body["inStock"] + body["lowStock"] + body["nearExpiry"] + body["outOfStock"]
            == len(inventory)
        )

        near = client.get(f"{PHARMACY}/inventory/near-expiry", headers=_auth(pharmacist)).json()
        assert body["nearExpiry"] == len(near)

        # The reorder list answers a different question from the status badge:
        # everything at or below its threshold, including stock that is also
        # flagged near-expiry. So it is a superset of the Low Stock count.
        low = client.get(f"{PHARMACY}/inventory/low-stock", headers=_auth(pharmacist)).json()
        assert all(m["quantity"] <= m["threshold"] for m in low)
        assert len(low) >= body["lowStock"] + body["outOfStock"]

    def test_dashboard_reflects_a_sale(self, client: TestClient, pharmacist: str, medicine, batch) -> None:
        before = client.get(f"{PHARMACY}/dashboard", headers=_auth(pharmacist)).json()

        med = medicine()
        batch(med, quantity=50, mrp="100.00")
        client.post(
            f"{POS}/sale",
            json={"items": [{"medicineId": med["id"], "quantity": 1}], "paymentMethod": "Cash"},
            headers=_auth(pharmacist),
        )

        after = client.get(f"{PHARMACY}/dashboard", headers=_auth(pharmacist)).json()
        assert after["ordersToday"] == before["ordersToday"] + 1
        assert Decimal(after["salesToday"]) > Decimal(before["salesToday"])


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


class TestPharmacyPermissions:
    def test_pharmacist_can_dispense(self, client: TestClient, pharmacist: str, prescription) -> None:
        rx, _ = prescription(quantity=5, stock=50)
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        response = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 5}]},
            headers=_auth(pharmacist),
        )
        assert response.status_code == 200, response.text

    def test_doctor_cannot_dispense(self, client: TestClient, doctor: str, pharmacist: str, prescription) -> None:
        rx, _ = prescription(quantity=5, stock=50)
        item_id = _item_ids(client, pharmacist, rx["id"])[0]

        response = client.post(
            f"{PRESCRIPTIONS}/{rx['id']}/dispense",
            json={"items": [{"prescriptionItemId": item_id, "quantity": 5}]},
            headers=_auth(doctor),
        )
        assert response.status_code == 403

    def test_doctor_cannot_manage_inventory(self, client: TestClient, doctor: str) -> None:
        assert client.get(MEDICINES, headers=_auth(doctor)).status_code == 403
        assert (
            client.post(MEDICINES, json={"name": "Doctor's medicine"}, headers=_auth(doctor)).status_code
            == 403
        )
        assert client.get(f"{PHARMACY}/inventory", headers=_auth(doctor)).status_code == 403

    def test_receptionist_cannot_manage_inventory(self, client: TestClient, receptionist: str) -> None:
        for path in (MEDICINES, f"{PHARMACY}/inventory", f"{PHARMACY}/dashboard", f"{POS}/products"):
            assert client.get(path, headers=_auth(receptionist)).status_code == 403, path

    def test_accountant_cannot_manage_inventory(self, client: TestClient, accountant: str) -> None:
        assert client.get(MEDICINES, headers=_auth(accountant)).status_code == 403
        assert client.get(f"{PHARMACY}/inventory", headers=_auth(accountant)).status_code == 403

    def test_only_the_pharmacist_runs_the_till(
        self, client: TestClient, doctor: str, receptionist: str, accountant: str
    ) -> None:
        for token, who in ((doctor, "doctor"), (receptionist, "receptionist"), (accountant, "accountant")):
            response = client.post(
                f"{POS}/sale",
                json={"items": [{"medicineId": "MED-2001", "quantity": 1}], "paymentMethod": "Cash"},
                headers=_auth(token),
            )
            assert response.status_code == 403, who

    def test_pharmacy_endpoints_require_authentication(self, client: TestClient) -> None:
        assert client.get(MEDICINES).status_code == 401
        assert client.get(f"{PHARMACY}/inventory").status_code == 401
        assert client.get(f"{PHARMACY}/dashboard").status_code == 401
        assert client.get(f"{POS}/products").status_code == 401
