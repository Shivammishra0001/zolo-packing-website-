"""AI layer tests.

Runs against real PostgreSQL with the demo data seeded.

Most of these are security and honesty tests rather than capability tests, and
that is deliberate. With no provider configured — which is how the application
ships and how CI runs — the interesting questions are not "does the summary
read well" but:

* does a caller without the underlying permission get in anyway?
* does an out-of-scope patient's record leak through an AI route?
* does anything reach a clinical record, or a patient's phone, without a person?
* does the response admit that no model ran, or does it present a template as
  though one had?

The unit tests at the bottom cover the two halves that would be untestable
through HTTP without a live model: the validation-and-repair loop, and the
outbound content filter.
"""

from __future__ import annotations

import uuid as uuid_lib
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.models import (
    AIAuditLog,
    AIDocument,
    Invoice,
    MedicalHistoryEntry,
    MessageDraft,
    Notification,
    Patient,
    User,
)

DEMO_PASSWORD = "Rehab@123"
AI = "/api/ai"

#: Raj Kumar — has seeded consultations, therapy sessions and appointments.
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
            for model in (User, Patient, Invoice)
        )
    if not have:
        pytest.skip("Demo data not seeded — run seed.py and the seed_*.py scripts")


@pytest.fixture(autouse=True, scope="module")
def _no_leaked_ai_rows(seeded: None):
    """Every row this module can create, removed afterwards.

    The AI tables are new, so this also guards the thing most likely to go
    wrong first: an agent writing rows on a read path.
    """
    from app.core.database import SessionLocal

    models = (AIAuditLog, AIDocument, MessageDraft, MedicalHistoryEntry, Notification)

    def snapshot():
        with SessionLocal() as db:
            return {m: list(db.execute(select(m.id)).scalars()) for m in models}

    before = snapshot()
    yield
    with SessionLocal() as db:
        for model in models:
            keep = before[model]
            statement = delete(model)
            if keep:
                statement = statement.where(model.id.notin_(keep))
            db.execute(statement)
        db.commit()


@pytest.fixture(scope="module")
def doctor(client: TestClient, seeded: None) -> str:
    return _token(client, "doctor@rehab.com")


@pytest.fixture(scope="module")
def nurse(client: TestClient, seeded: None) -> str:
    return _token(client, "nurse@rehab.com")


@pytest.fixture(scope="module")
def receptionist(client: TestClient, seeded: None) -> str:
    return _token(client, "reception@rehab.com")


@pytest.fixture(scope="module")
def pharmacist(client: TestClient, seeded: None) -> str:
    return _token(client, "pharmacy@rehab.com")


@pytest.fixture(scope="module")
def accountant(client: TestClient, seeded: None) -> str:
    return _token(client, "accounts@rehab.com")


@pytest.fixture(scope="module")
def owner(client: TestClient, seeded: None) -> str:
    return _token(client, "owner@rehab.com")


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------


class TestStatus:
    def test_status_reports_disabled_when_no_key_is_configured(
        self, client: TestClient, doctor: str
    ) -> None:
        """The default build must say plainly that AI is off.

        A frontend that cannot ask this ends up drawing a button that fails.
        """
        response = client.get(f"{AI}/status", headers=_auth(doctor))
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["enabled"] is False
        assert body["provider"] == "none"

    def test_status_never_returns_a_key(self, client: TestClient, doctor: str) -> None:
        body = client.get(f"{AI}/status", headers=_auth(doctor)).text.lower()
        for leak in ("api_key", "apikey", "secret", "authorization", "bearer"):
            assert leak not in body

    def test_status_lists_only_the_agents_the_caller_may_use(
        self, client: TestClient, pharmacist: str, doctor: str
    ) -> None:
        """Each role sees exactly the features its existing keys unlock.

        A pharmacist holds `billing.view` and nothing else on this list, so the
        invoice check is offered and the four clinical and financial agents are
        not. That is the mapping working, not a gap in it.
        """
        pharmacy_agents = client.get(f"{AI}/status", headers=_auth(pharmacist)).json()["agents"]
        assert pharmacy_agents == ["Billing Accuracy"]

        doctor_agents = set(client.get(f"{AI}/status", headers=_auth(doctor)).json()["agents"])
        assert "Patient Recap" in doctor_agents
        assert "Finance Insights" not in doctor_agents

    def test_status_requires_authentication(self, client: TestClient) -> None:
        assert client.get(f"{AI}/status").status_code == 401


# ---------------------------------------------------------------------------
# 1. Patient recap
# ---------------------------------------------------------------------------


class TestPatientRecap:
    def test_recap_returns_a_real_timeline_with_no_model_configured(
        self, client: TestClient, doctor: str
    ) -> None:
        """The whole point of the degraded path: it still answers."""
        response = client.post(f"{AI}/patients/{PATIENT}/recap", headers=_auth(doctor))
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["timeline"], "the timeline is built from SQL, not from a model"
        assert all(event["date"] for event in body["timeline"])

    def test_recap_admits_that_no_model_ran(self, client: TestClient, doctor: str) -> None:
        """A template must never be presented as a generated summary."""
        body = client.post(f"{AI}/patients/{PATIENT}/recap", headers=_auth(doctor)).json()
        assert body["meta"]["degraded"] is True
        assert body["meta"]["provider"] == "none"
        assert body["summary"] == ""
        assert body["meta"]["notice"]

    def test_recap_timeline_is_in_chronological_order(
        self, client: TestClient, doctor: str
    ) -> None:
        """Chronology is a query result. Nothing is asked to infer it."""
        body = client.post(f"{AI}/patients/{PATIENT}/recap", headers=_auth(doctor)).json()
        dates = [event["date"] for event in body["timeline"]]
        assert dates == sorted(dates)

    def test_recap_always_requires_review(self, client: TestClient, doctor: str) -> None:
        body = client.post(f"{AI}/patients/{PATIENT}/recap", headers=_auth(doctor)).json()
        assert body["meta"]["requiresReview"] is True

    def test_receptionist_cannot_read_clinical_notes_through_the_recap(
        self, client: TestClient, receptionist: str
    ) -> None:
        """The security test this whole design exists for.

        A receptionist holds `patient.view` but not `patient.clinical.view`.
        If the recap were gated on a single `ai.use` key, this route would hand
        them consultation notes the patients module refuses them.
        """
        response = client.post(f"{AI}/patients/{PATIENT}/recap", headers=_auth(receptionist))
        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_permission"

    def test_recap_of_an_unknown_patient_is_404(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            f"{AI}/patients/{uuid_lib.uuid4()}/recap", headers=_auth(doctor)
        )
        assert response.status_code == 404

    def test_recap_writes_one_audit_row_naming_no_clinical_content(
        self, client: TestClient, doctor: str
    ) -> None:
        from app.core.database import SessionLocal

        client.post(f"{AI}/patients/{PATIENT}/recap", headers=_auth(doctor))
        with SessionLocal() as db:
            row = db.execute(
                select(AIAuditLog).order_by(AIAuditLog.created_at.desc()).limit(1)
            ).scalar_one()
        assert row.agent_type.value == "PATIENT_RECAP"
        assert row.entity_type == "patients"
        # Payload storage is off by default, and the audit row is provenance
        # rather than a second copy of the record.
        assert row.prompt is None
        assert row.completion is None


# ---------------------------------------------------------------------------
# 2. Clinical documentation
# ---------------------------------------------------------------------------


def _upload(client: TestClient, token: str, text: str, patient: str = PATIENT):
    return client.post(
        f"{AI}/documents",
        headers=_auth(token),
        data={"patientId": patient},
        files={"file": ("prescription.txt", text.encode(), "text/plain")},
    )


PRESCRIPTION_TEXT = """Prescription
Dr. Arjun Sharma
Date: 2026-08-20
Rx
Tab Paracetamol 500mg 1-0-1 x 5 days
Cap Amoxicillin 250mg 1-1-1 x 7 days
Diagnosis: ?ligament strain
Review in one week
"""


class TestClinicalDocumentation:
    def test_upload_stages_an_extraction_without_touching_the_record(
        self, client: TestClient, doctor: str
    ) -> None:
        from app.core.database import SessionLocal

        with SessionLocal() as db:
            before = db.execute(select(MedicalHistoryEntry.id)).scalars().all()

        response = _upload(client, doctor, PRESCRIPTION_TEXT)
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["reviewStatus"] == "Pending review"
        assert body["applied"] is False

        with SessionLocal() as db:
            after = db.execute(select(MedicalHistoryEntry.id)).scalars().all()
        assert len(after) == len(before), "nothing may enter the record before review"

    def test_extraction_reads_the_medicines(self, client: TestClient, doctor: str) -> None:
        body = _upload(client, doctor, PRESCRIPTION_TEXT).json()
        names = [m["name"].lower() for m in body["extracted"]["medicines"]]
        assert any("paracetamol" in n for n in names)
        assert any("amoxicillin" in n for n in names)

    def test_uncertainty_survives_extraction(self, client: TestClient, doctor: str) -> None:
        """'?ligament strain' must not become 'ligament strain'.

        Turning a clinician's query into a confirmed diagnosis is the single
        most damaging thing this feature could do quietly.
        """
        body = _upload(client, doctor, PRESCRIPTION_TEXT).json()
        extracted = body["extracted"]
        assert extracted["diagnosis"] == "", "a queried diagnosis is not a diagnosis"
        assert any("?ligament strain" in fragment for fragment in extracted["uncertain"])

    def test_rule_based_reader_never_claims_high_confidence(
        self, client: TestClient, doctor: str
    ) -> None:
        body = _upload(client, doctor, PRESCRIPTION_TEXT).json()
        assert body["extracted"]["confidence"] in {"low", "medium"}

    def test_an_image_with_no_ocr_engine_is_stored_and_says_so(
        self, client: TestClient, doctor: str
    ) -> None:
        """Refusing to guess is the correct behaviour, not a failure."""
        response = client.post(
            f"{AI}/documents",
            headers=_auth(doctor),
            data={"patientId": PATIENT},
            files={"file": ("scan.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64, "image/png")},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["ocrText"] == ""
        assert body["reviewStatus"] == "Pending review"

    def test_unsupported_file_type_is_rejected(self, client: TestClient, doctor: str) -> None:
        response = client.post(
            f"{AI}/documents",
            headers=_auth(doctor),
            data={"patientId": PATIENT},
            files={"file": ("payload.exe", b"MZ\x90\x00", "application/x-msdownload")},
        )
        assert response.status_code == 422
        assert response.json()["code"] == "unsupported_document_type"

    def test_nurse_cannot_upload_clinical_documents(
        self, client: TestClient, nurse: str
    ) -> None:
        """A nurse may read clinical records but not edit them."""
        assert _upload(client, nurse, PRESCRIPTION_TEXT).status_code == 403

    def test_approval_writes_the_reviewers_version_and_attributes_it_to_them(
        self, client: TestClient, doctor: str
    ) -> None:
        from app.core.database import SessionLocal

        document = _upload(client, doctor, PRESCRIPTION_TEXT).json()
        response = client.post(
            f"{AI}/documents/{document['id']}/review",
            headers=_auth(doctor),
            json={
                "approve": True,
                "medicines": [{"name": "Paracetamol", "strength": "500mg", "dosage": "1-0-1"}],
                "diagnosis": "Ligament strain, confirmed on review",
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["applied"] is True

        with SessionLocal() as db:
            entry = db.execute(
                select(MedicalHistoryEntry)
                .order_by(MedicalHistoryEntry.created_at.desc())
                .limit(1)
            ).scalar_one()
            reviewer = db.get(User, entry.clinician_id)
        assert "confirmed on review" in entry.detail
        assert reviewer.email == "doctor@rehab.com", "the record belongs to the human"

    def test_the_ai_proposal_is_kept_separately_from_what_was_accepted(
        self, client: TestClient, doctor: str
    ) -> None:
        from app.core.database import SessionLocal

        document = _upload(client, doctor, PRESCRIPTION_TEXT).json()
        client.post(
            f"{AI}/documents/{document['id']}/review",
            headers=_auth(doctor),
            json={"approve": True, "diagnosis": "Something the reviewer typed"},
        )
        with SessionLocal() as db:
            row = db.get(AIDocument, uuid_lib.UUID(document["id"]))
            assert row.reviewed["diagnosis"] == "Something the reviewer typed"
            assert row.extracted["diagnosis"] != row.reviewed["diagnosis"]

    def test_a_document_cannot_be_approved_twice(
        self, client: TestClient, doctor: str
    ) -> None:
        document = _upload(client, doctor, PRESCRIPTION_TEXT).json()
        first = client.post(
            f"{AI}/documents/{document['id']}/review",
            headers=_auth(doctor),
            json={"approve": True},
        )
        assert first.status_code == 200
        second = client.post(
            f"{AI}/documents/{document['id']}/review",
            headers=_auth(doctor),
            json={"approve": True},
        )
        assert second.status_code == 409

    def test_rejection_keeps_the_evidence(self, client: TestClient, doctor: str) -> None:
        from app.core.database import SessionLocal

        document = _upload(client, doctor, PRESCRIPTION_TEXT).json()
        response = client.post(
            f"{AI}/documents/{document['id']}/review",
            headers=_auth(doctor),
            json={"approve": False, "reason": "Wrong patient"},
        )
        assert response.status_code == 200
        assert response.json()["reviewStatus"] == "Rejected"
        with SessionLocal() as db:
            row = db.get(AIDocument, uuid_lib.UUID(document["id"]))
            assert row.extracted, "a rejected extraction is still the evidence"
            assert row.applied is False


# ---------------------------------------------------------------------------
# 3. Billing accuracy
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def an_invoice(seeded: None) -> str:
    from app.core.database import SessionLocal

    with SessionLocal() as db:
        invoice = db.execute(select(Invoice).limit(1)).scalar_one()
        return str(invoice.id)


class TestBillingAccuracy:
    def test_check_recomputes_totals_and_never_changes_the_invoice(
        self, client: TestClient, accountant: str, an_invoice: str
    ) -> None:
        from app.core.database import SessionLocal

        with SessionLocal() as db:
            before = db.get(Invoice, uuid_lib.UUID(an_invoice))
            snapshot = (before.subtotal, before.discount, before.tax, before.total, before.status)

        response = client.post(f"{AI}/invoices/{an_invoice}/check", headers=_auth(accountant))
        assert response.status_code == 200, response.text
        assert "total" in response.json()["recomputed"]

        with SessionLocal() as db:
            after = db.get(Invoice, uuid_lib.UUID(an_invoice))
            assert (after.subtotal, after.discount, after.tax, after.total, after.status) == snapshot

    def test_a_clean_invoice_is_reported_as_clean(
        self, client: TestClient, accountant: str, an_invoice: str
    ) -> None:
        body = client.post(f"{AI}/invoices/{an_invoice}/check", headers=_auth(accountant)).json()
        assert isinstance(body["clean"], bool)
        assert body["clean"] is (
            len(body["findings"]) == 0 and len(body["systemErrors"]) == 0
        )

    def test_arithmetic_is_computed_not_generated(
        self, client: TestClient, accountant: str, an_invoice: str
    ) -> None:
        """Totals must be identical with no model available."""
        body = client.post(f"{AI}/invoices/{an_invoice}/check", headers=_auth(accountant)).json()
        assert body["meta"]["degraded"] is True
        assert Decimal(body["recomputed"]["subtotal"]) >= 0

    def test_a_tampered_total_is_caught(self, client: TestClient, accountant: str) -> None:
        """The rules engine has to actually find something.

        Written against a deliberately broken invoice so a passing suite means
        the check works, not merely that it runs.
        """
        from app.core.database import SessionLocal

        with SessionLocal() as db:
            invoice = db.execute(select(Invoice).limit(1)).scalar_one()
            invoice_id, original = invoice.id, invoice.total
            invoice.total = original + Decimal("500.00")
            db.commit()
        try:
            body = client.post(
                f"{AI}/invoices/{invoice_id}/check", headers=_auth(accountant)
            ).json()
            # A total that does not add up is a defect in the data, so it
            # belongs in systemErrors — not among the heuristics a clerk is
            # invited to weigh up and dismiss.
            codes = {f["code"] for f in body["systemErrors"]}
            assert "arithmetic" in codes
            assert "arithmetic" not in {f["code"] for f in body["findings"]}
            assert body["clean"] is False
        finally:
            with SessionLocal() as db:
                db.get(Invoice, invoice_id).total = original
                db.commit()

    def test_pharmacist_without_billing_view_is_refused(
        self, client: TestClient, an_invoice: str
    ) -> None:
        """A therapist holds no billing key at all."""
        therapist = _token(client, "therapist@rehab.com")
        response = client.post(f"{AI}/invoices/{an_invoice}/check", headers=_auth(therapist))
        assert response.status_code == 403

    def test_unknown_invoice_is_404(self, client: TestClient, accountant: str) -> None:
        response = client.post(
            f"{AI}/invoices/{uuid_lib.uuid4()}/check", headers=_auth(accountant)
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# 4. Follow-ups and reminders
# ---------------------------------------------------------------------------


class TestFollowUps:
    def test_generate_drafts_and_sends_nothing(
        self, client: TestClient, receptionist: str
    ) -> None:
        response = client.post(
            f"{AI}/followups/generate",
            headers=_auth(receptionist),
            json={"horizonDays": 30, "channel": "SMS", "limit": 10},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert all(draft["status"] == "Draft" for draft in body["drafts"])
        assert all(draft["sentAt"] is None for draft in body["drafts"])

    def test_every_suggested_date_comes_from_a_person_or_a_rule(
        self, client: TestClient, receptionist: str
    ) -> None:
        """No date in this feature originates with a model."""
        body = client.post(
            f"{AI}/followups/generate",
            headers=_auth(receptionist),
            json={"horizonDays": 90, "limit": 25},
        ).json()
        assert all(s["source"] in {"clinician", "rule"} for s in body["suggestions"])

    def test_drafts_carry_no_clinical_information(
        self, client: TestClient, receptionist: str
    ) -> None:
        """An SMS passes through a third party to a possibly shared handset."""
        body = client.post(
            f"{AI}/followups/generate",
            headers=_auth(receptionist),
            json={"horizonDays": 90, "limit": 25},
        ).json()
        forbidden = ("diagnos", "prescri", "therapy", "physio", "medicine", "mg")
        for draft in body["drafts"]:
            lowered = draft["body"].lower()
            assert not any(word in lowered for word in forbidden), draft["body"]

    def test_a_patient_without_consent_is_listed_not_messaged(
        self, client: TestClient, receptionist: str
    ) -> None:
        from app.core.database import SessionLocal

        with SessionLocal() as db:
            patient = db.execute(
                select(Patient).where(Patient.contact_consent.is_(True)).limit(1)
            ).scalar_one_or_none()
            if patient is None:
                pytest.skip("No consented demo patient to withdraw consent from")
            patient_id, name = patient.id, f"{patient.first_name} {patient.last_name}".strip()
            patient.contact_consent = False
            db.commit()
        try:
            body = client.post(
                f"{AI}/followups/generate",
                headers=_auth(receptionist),
                json={"horizonDays": 90, "limit": 50},
            ).json()
            drafted = {d["patientId"] for d in body["drafts"]}
            assert str(patient_id) not in drafted
            if any(s["patientId"] == str(patient_id) for s in body["suggestions"]):
                assert any(name in line for line in body["skipped"])
        finally:
            with SessionLocal() as db:
                db.get(Patient, patient_id).contact_consent = True
                db.commit()

    def test_approval_with_no_gateway_never_claims_the_message_was_sent(
        self, client: TestClient, receptionist: str
    ) -> None:
        """A provider that does not exist cannot have delivered anything."""
        from app.core.database import SessionLocal

        client.post(
            f"{AI}/followups/generate",
            headers=_auth(receptionist),
            json={"horizonDays": 90, "limit": 25},
        )
        with SessionLocal() as db:
            draft = db.execute(select(MessageDraft).limit(1)).scalar_one_or_none()
        if draft is None:
            pytest.skip("No draft was produced from the demo data")

        response = client.post(
            f"{AI}/messages/{draft.id}/approve",
            headers=_auth(receptionist),
            json={"approve": True},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "Pending"
        assert body["sentAt"] is None
        assert body["deliveredAt"] is None
        assert body["failureReason"]

    def test_a_reviewer_rewrite_stops_being_ai_generated(
        self, client: TestClient, receptionist: str
    ) -> None:
        from app.core.database import SessionLocal

        client.post(
            f"{AI}/followups/generate",
            headers=_auth(receptionist),
            json={"horizonDays": 90, "limit": 25},
        )
        with SessionLocal() as db:
            draft = db.execute(
                select(MessageDraft).where(MessageDraft.status == "DRAFT").limit(1)
            ).scalar_one_or_none()
        if draft is None:
            pytest.skip("No draft was produced from the demo data")

        body = client.post(
            f"{AI}/messages/{draft.id}/approve",
            headers=_auth(receptionist),
            json={"approve": True, "body": "Rewritten by the front desk."},
        ).json()
        assert body["body"] == "Rewritten by the front desk."
        assert body["aiGenerated"] is False

    def test_rejecting_a_reminder_is_not_recorded_as_a_delivery_failure(
        self, client: TestClient, receptionist: str
    ) -> None:
        """A person deciding against a message is a different fact from a
        gateway refusing it, and a queue that conflates them invites somebody
        to retry a decision."""
        from app.core.database import SessionLocal

        client.post(
            f"{AI}/followups/generate",
            headers=_auth(receptionist),
            json={"horizonDays": 90, "limit": 25},
        )
        with SessionLocal() as db:
            draft = db.execute(
                select(MessageDraft).where(MessageDraft.status == "DRAFT").limit(1)
            ).scalar_one_or_none()
        if draft is None:
            pytest.skip("No draft was produced from the demo data")

        body = client.post(
            f"{AI}/messages/{draft.id}/approve",
            headers=_auth(receptionist),
            json={"approve": False, "reason": "Patient already called"},
        ).json()
        assert body["status"] == "Rejected"
        assert body["sentAt"] is None

    def test_pharmacist_cannot_draft_reminders(
        self, client: TestClient, pharmacist: str
    ) -> None:
        response = client.post(
            f"{AI}/followups/generate", headers=_auth(pharmacist), json={"horizonDays": 14}
        )
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# 5. Finance insights
# ---------------------------------------------------------------------------


class TestFinanceInsights:
    def test_insights_return_computed_figures(
        self, client: TestClient, accountant: str
    ) -> None:
        response = client.post(f"{AI}/finance/insights", headers=_auth(accountant))
        assert response.status_code == 200, response.text
        labels = {m["label"] for m in response.json()["metrics"]}
        assert "Collections" in labels and "Expenses" in labels

    def test_no_cause_is_invented_for_a_movement(
        self, client: TestClient, accountant: str
    ) -> None:
        """The mandatory honesty rule.

        Where the records show a change but not a reason, the response has to
        say so rather than offering a plausible story.
        """
        body = client.post(
            f"{AI}/finance/insights",
            headers=_auth(accountant),
            params={"start_date": str(date.today() - timedelta(days=90)),
                    "end_date": str(date.today())},
        ).json()
        movement = next(m for m in body["metrics"] if m["label"] == "Collections")
        if abs(Decimal(movement["delta"])) >= Decimal("1000.00"):
            assert body["unexplained"], "a material movement with no stated cause must say so"
            assert "not why" in body["unexplained"]

    def test_percentage_against_a_zero_base_is_omitted_not_infinite(
        self, client: TestClient, accountant: str
    ) -> None:
        body = client.post(
            f"{AI}/finance/insights",
            headers=_auth(accountant),
            params={"start_date": "2020-01-01", "end_date": "2020-01-31"},
        ).json()
        for metric in body["metrics"]:
            if Decimal(metric["previous"]) == 0:
                assert metric["percent"] is None

    def test_receptionist_cannot_read_the_clinics_finances(
        self, client: TestClient, receptionist: str
    ) -> None:
        assert client.post(f"{AI}/finance/insights", headers=_auth(receptionist)).status_code == 403

    def test_owner_may_read_the_finances(self, client: TestClient, owner: str) -> None:
        assert client.post(f"{AI}/finance/insights", headers=_auth(owner)).status_code == 200


# ---------------------------------------------------------------------------
# Unit tests: the parts HTTP cannot reach without a live model
# ---------------------------------------------------------------------------


class _FakeProvider:
    """A provider that returns exactly what a test tells it to.

    Records every prompt it was handed, which is what lets the injection and
    isolation tests assert on what actually left the building rather than on
    what the model said about it.
    """

    name = "fake"
    model = "fake-1"
    available = True

    def __init__(self, replies: list) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []
        self.systems: list[str] = []

    def generate(self, *, system, prompt, max_tokens=800):  # pragma: no cover
        raise NotImplementedError

    def generate_structured(self, *, system, prompt, schema, max_tokens=800):
        from app.ai.provider import Usage

        self.prompts.append(prompt)
        self.systems.append(system)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply, Usage(input_tokens=120, output_tokens=40)


class TestValidationLoop:
    """The reject → repair → reject-for-good path required of every agent."""

    def _orchestrator(self, db, provider):
        from app.ai.orchestrator import Orchestrator
        from app.core.enums import AIAgentType

        user = db.execute(select(User).limit(1)).scalar_one()
        return Orchestrator(
            db=db,
            user=user,
            request_id="test",
            agent=AIAgentType.PATIENT_RECAP,
            provider=provider,
        )

    def test_valid_output_is_accepted_on_the_first_attempt(self, db) -> None:
        from app.ai.schemas import RecapNarrative
        from app.core.enums import AIRunStatus

        provider = _FakeProvider([{"summary": "A short recap.", "watchPoints": [], "gaps": []}])
        result, outcome = self._orchestrator(db, provider).structured(
            system="s", task="t", data="d", schema=RecapNarrative, prompt_version="test/v1"
        )
        assert result is not None and result.summary == "A short recap."
        assert outcome.status is AIRunStatus.SUCCEEDED

    def test_invalid_output_is_repaired_once(self, db) -> None:
        from app.ai.schemas import RecapNarrative
        from app.core.enums import AIRunStatus

        provider = _FakeProvider([
            {"watchPoints": []},  # no summary — fails validation
            {"summary": "Repaired.", "watchPoints": [], "gaps": []},
        ])
        result, outcome = self._orchestrator(db, provider).structured(
            system="s", task="t", data="d", schema=RecapNarrative, prompt_version="test/v1"
        )
        assert result is not None and result.summary == "Repaired."
        assert outcome.status is AIRunStatus.SUCCEEDED
        assert "did not validate" in provider.prompts[1]

    def test_output_that_fails_twice_is_discarded(self, db) -> None:
        from app.ai.schemas import RecapNarrative
        from app.core.enums import AIRunStatus

        provider = _FakeProvider([{"nonsense": 1}, {"still": "wrong"}])
        result, outcome = self._orchestrator(db, provider).structured(
            system="s", task="t", data="d", schema=RecapNarrative, prompt_version="test/v1"
        )
        assert result is None, "unvalidated output must never reach a caller"
        assert outcome.status is AIRunStatus.INVALID_OUTPUT
        assert outcome.degraded is True

    def test_a_provider_failure_degrades_rather_than_raising(self, db) -> None:
        from app.ai.provider import ProviderUnavailable
        from app.ai.schemas import RecapNarrative
        from app.core.enums import AIRunStatus

        provider = _FakeProvider([ProviderUnavailable("timeout")])
        result, outcome = self._orchestrator(db, provider).structured(
            system="s", task="t", data="d", schema=RecapNarrative, prompt_version="test/v1"
        )
        assert result is None
        assert outcome.status is AIRunStatus.FAILED


class TestFollowUpPriority:
    """Tier one: a date a clinician wrote down.

    Exercised as a unit test because the demo data has no consultation with a
    follow-up date, so an HTTP test would pass by never reaching the branch —
    the worst kind of green.
    """

    def test_a_clinician_written_date_wins_and_is_labelled_as_theirs(self, db) -> None:
        from datetime import timedelta

        from app.ai import retrieval
        from app.models import Consultation

        patient = db.execute(select(Patient).limit(1)).scalar_one()
        user = db.execute(
            select(User).where(User.email == "reception@rehab.com")
        ).scalar_one()
        due = date.today() + timedelta(days=7)

        db.add(
            Consultation(
                patient_id=patient.id,
                doctor_id=None,
                symptoms="Follow-up scheduling test",
                follow_up_date=due,
            )
        )
        db.flush()

        candidates = retrieval.follow_up_candidates(
            db,
            user=user,
            permissions=["patient.view", "appointment.create"],
            through=due,
            limit=50,
        )
        mine = [c for c in candidates if c["patient"].id == patient.id]
        assert mine, "a consultation with a follow-up date must produce a candidate"
        assert mine[0]["source"] == "clinician"
        assert mine[0]["dueOn"] == due, "the clinician's date is used exactly"

    def test_the_standard_interval_never_overrides_a_clinician(self, db) -> None:
        """Tier two must not produce a second, different date for the same
        patient — which is what would put two dates in front of a reviewer."""
        from datetime import timedelta

        from app.ai.agents import followup
        from app.models import Consultation

        patient = db.execute(select(Patient).limit(1)).scalar_one()
        user = db.execute(
            select(User).where(User.email == "reception@rehab.com")
        ).scalar_one()
        due = date.today() + timedelta(days=7)
        db.add(Consultation(patient_id=patient.id, follow_up_date=due))
        db.flush()

        permissions = ["patient.view", "appointment.create"]
        rule_rows = followup._by_standard_interval(
            db,
            user=user,
            permissions=permissions,
            through=due,
            limit=50,
            exclude={patient.id},
        )
        assert all(row["patient"].id != patient.id for row in rule_rows)


class TestOutboundSafety:
    """The last defence on what reaches a patient's phone."""

    def test_a_body_carrying_clinical_content_is_refused(self) -> None:
        from app.ai.agents.followup import _safe_to_send

        due = date(2026, 9, 15)
        assert _safe_to_send(f"Your follow-up is due on {due:%d %b %Y}.", due_on=due)
        assert not _safe_to_send(
            f"Your physiotherapy review is due on {due:%d %b %Y}.", due_on=due
        )
        assert not _safe_to_send(
            f"Bring your diabetes report on {due:%d %b %Y}.", due_on=due
        )

    def test_a_body_carrying_the_wrong_date_is_refused(self) -> None:
        """A reviewer must not be shown one date and approve another."""
        from app.ai.agents.followup import _safe_to_send

        assert not _safe_to_send("Your follow-up is due on 01 Jan 2027.", due_on=date(2026, 9, 15))


class TestRedaction:
    def test_stored_payloads_lose_direct_identifiers(self) -> None:
        from app.ai.orchestrator import redact

        cleaned = redact("Call Priya on +91 98450 12345 or priya@example.com about 100248")
        assert "98450" not in cleaned
        assert "priya@example.com" not in cleaned
        assert "[phone]" in cleaned and "[email]" in cleaned

    def test_payloads_are_not_stored_by_default(self, db) -> None:
        """The default has to be off, and has to actually be off."""
        from app.ai.orchestrator import Orchestrator
        from app.ai.schemas import RecapNarrative
        from app.core.config import settings
        from app.core.enums import AIAgentType

        assert settings.AI_STORE_PAYLOADS is False

        user = db.execute(select(User).limit(1)).scalar_one()
        provider = _FakeProvider([{"summary": "x", "watchPoints": [], "gaps": []}])
        Orchestrator(
            db=db,
            user=user,
            request_id="store-off",
            agent=AIAgentType.PATIENT_RECAP,
            provider=provider,
        ).structured(
            system="s",
            task="Summarise.",
            data="Patient phoned on +91 98450 12345",
            schema=RecapNarrative,
            prompt_version="test/v1",
        )
        db.flush()
        row = db.execute(
            select(AIAuditLog).where(AIAuditLog.request_id == "store-off")
        ).scalar_one()
        assert row.prompt is None and row.completion is None

    def test_the_debug_switch_redacts_before_it_stores(self, db, monkeypatch) -> None:
        """Turning payload storage on must not turn the audit table into a
        second copy of the record with phone numbers in it."""
        from app.ai.orchestrator import Orchestrator
        from app.ai.schemas import RecapNarrative
        from app.core.config import settings
        from app.core.enums import AIAgentType

        monkeypatch.setattr(settings, "AI_STORE_PAYLOADS", True)

        user = db.execute(select(User).limit(1)).scalar_one()
        provider = _FakeProvider([{"summary": "x", "watchPoints": [], "gaps": []}])
        Orchestrator(
            db=db,
            user=user,
            request_id="store-on",
            agent=AIAgentType.PATIENT_RECAP,
            provider=provider,
        ).structured(
            system="s",
            task="Summarise.",
            data="Patient phoned on +91 98450 12345 from priya@example.com",
            schema=RecapNarrative,
            prompt_version="test/v1",
        )
        db.flush()
        row = db.execute(
            select(AIAuditLog).where(AIAuditLog.request_id == "store-on")
        ).scalar_one()
        assert row.prompt is not None
        assert "98450" not in row.prompt
        assert "priya@example.com" not in row.prompt
