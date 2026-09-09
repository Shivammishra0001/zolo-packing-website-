"""Development patient seed.

Loads the 14 patients, their vitals and their medical history from
``seed_data/patients.json`` (extracted from the frontend's original mock data,
so the screens look the same once they are reading from PostgreSQL).

    python seed_patients.py            # create or update
    python seed_patients.py --reset    # delete seeded clinical rows first

DEVELOPMENT / DEMO ONLY. Run `seed.py` first — this needs the branches,
departments and staff accounts it creates.
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.enums import (
    DocumentType,
    Gender,
    MedicalHistoryType,
    PatientStatus,
    UserRole,
)
from app.core.logging_config import configure_logging
from app.models import (
    Branch,
    Department,
    MedicalHistoryEntry,
    Patient,
    PatientDocument,
    User,
    Vitals,
)
from app.repositories import patient_repository as repo

configure_logging()
logger = logging.getLogger("seed-patients")

DATA_FILE = Path(__file__).parent / "seed_data" / "patients.json"

GENDER = {"Male": Gender.MALE, "Female": Gender.FEMALE, "Other": Gender.OTHER}

STATUS = {
    "Active - OPD": PatientStatus.ACTIVE_OPD,
    "Admitted - IPD": PatientStatus.ADMITTED_IPD,
    "In Rehabilitation": PatientStatus.IN_REHABILITATION,
    "Discharge Pending": PatientStatus.DISCHARGE_PENDING,
    "Discharged": PatientStatus.DISCHARGED,
    "Follow-up": PatientStatus.FOLLOW_UP,
}

HISTORY_TYPE = {
    "Diagnosis": MedicalHistoryType.DIAGNOSIS,
    "Surgery": MedicalHistoryType.SURGERY,
    "Injury": MedicalHistoryType.INJURY,
    "Allergy": MedicalHistoryType.ALLERGY,
    "Chronic Condition": MedicalHistoryType.CHRONIC_CONDITION,
    "Lab Result": MedicalHistoryType.LAB_RESULT,
}

DOCUMENTS = (
    ("Initial Assessment Report.pdf", DocumentType.REPORT, 421_888),
    ("MRI Lumbar Spine.dcm", DocumentType.SCAN, 19_293_798),
    ("Therapy Consent Form.pdf", DocumentType.CONSENT, 98_304),
    ("Insurance Pre-Authorisation.pdf", DocumentType.INSURANCE, 249_856),
)


def split_name(full: str) -> tuple[str, str]:
    parts = full.split()
    return (" ".join(parts[:-1]), parts[-1]) if len(parts) > 1 else (parts[0], "")


def dob_from_age(age: int, registered: date) -> date:
    """Approximate a birth date, since the mock data only carries an age."""
    born = registered.year - age
    return date(born, ((age * 7) % 12) + 1, ((age * 13) % 27) + 1)


def build_vitals(seed: dict, patient: Patient, nurse: User | None) -> list[Vitals]:
    """Five observations at six-hour intervals, jittered around a baseline."""
    base = seed.get("vitals") or {}
    if not base:
        return []

    rng = random.Random(int("".join(c for c in seed["id"] if c.isdigit())))
    anchor = datetime.combine(date(2026, 8, 24), time(7, 30), tzinfo=timezone.utc)

    rows = []
    for offset in range(5):
        jitter = lambda spread: rng.uniform(-spread, spread)  # noqa: E731
        rows.append(
            Vitals(
                patient_id=patient.id,
                recorded_by=nurse.id if nurse else None,
                recorded_at=anchor - timedelta(hours=6 * offset),
                systolic=round(base["systolic"] + jitter(5)),
                diastolic=round(base["diastolic"] + jitter(4)),
                heart_rate=round(base["heartRate"] + jitter(5)),
                temperature=round(base["temperature"] + jitter(0.3), 1),
                spo2=min(100, round(base["spo2"] + jitter(1))),
                respiratory_rate=round(base["respiratoryRate"] + jitter(1.5)),
            )
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="delete seeded patients first")
    args = parser.parse_args()

    if not DATA_FILE.exists():
        logger.error("Missing %s", DATA_FILE)
        return 1

    seeds = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    with SessionLocal() as db:
        try:
            branches = {b.name: b for b in db.execute(select(Branch)).scalars()}
            departments = {d.name: d for d in db.execute(select(Department)).scalars()}
            staff = {u.full_name: u for u in db.execute(select(User)).scalars()}

            if not branches or not staff:
                logger.error("Run `python seed.py` first — branches and staff are missing")
                return 1

            if args.reset:
                logger.warning("Deleting existing patients and their clinical records")
                db.execute(delete(Vitals))
                db.execute(delete(MedicalHistoryEntry))
                db.execute(delete(PatientDocument))
                db.execute(delete(Patient))
                db.flush()

            nurse = next((u for u in staff.values() if u.role is UserRole.NURSE), None)
            main_branch = next(iter(branches.values()))
            existing = {p.patient_number: p for p in db.execute(select(Patient)).scalars()}

            created = updated = 0
            for seed in seeds:
                number = seed["id"]
                registered = date.fromisoformat(seed["registeredOn"])
                first, last = split_name(seed["name"])

                patient = existing.get(number)
                if patient is None:
                    patient = Patient(patient_number=number)
                    db.add(patient)
                    created += 1
                else:
                    updated += 1

                doctor = staff.get(seed.get("assignedDoctor", ""))
                therapist = staff.get(seed.get("assignedTherapist", ""))
                department = departments.get(seed.get("department", ""))

                patient.first_name = first
                patient.last_name = last
                patient.date_of_birth = dob_from_age(seed["age"], registered)
                patient.gender = GENDER[seed["gender"]]
                patient.phone = seed.get("phone")
                patient.email = seed.get("email")
                patient.address = seed.get("address")
                patient.blood_group = seed.get("bloodGroup")
                patient.status = STATUS[seed["status"]]
                patient.primary_condition = seed.get("primaryCondition")
                patient.registration_date = registered
                patient.last_visit_at = date.fromisoformat(seed["lastVisit"])
                patient.branch_id = (department.branch_id if department else None) or main_branch.id
                patient.department_id = department.id if department else None
                patient.assigned_doctor_id = doctor.id if doctor else None
                patient.assigned_therapist_id = therapist.id if therapist else None
                patient.allergies = seed.get("allergies", [])
                # DEMO DATA ONLY. Real consent is given by a patient, not by a
                # seed script; this exists so the reminder queue has something
                # to draft against. New patients registered through the app
                # default to no consent, which is the correct default.
                patient.contact_consent = True

                emergency = seed.get("emergency")
                patient.emergency_contact = (
                    {"name": emergency[0], "relation": emergency[1], "phone": emergency[2]}
                    if emergency
                    else None
                )
                insurance = seed.get("insurance")
                patient.insurance = (
                    {"provider": insurance[0], "policyNo": insurance[1], "validTill": insurance[2]}
                    if insurance
                    else None
                )
                db.flush()

                # Replace clinical children so re-running stays idempotent.
                db.execute(delete(Vitals).where(Vitals.patient_id == patient.id))
                db.execute(
                    delete(MedicalHistoryEntry).where(MedicalHistoryEntry.patient_id == patient.id)
                )
                db.execute(delete(PatientDocument).where(PatientDocument.patient_id == patient.id))

                for row in build_vitals(seed, patient, nurse):
                    db.add(row)

                for entry in seed.get("history", []):
                    db.add(
                        MedicalHistoryEntry(
                            patient_id=patient.id,
                            entry_date=date.fromisoformat(entry["date"]),
                            type=HISTORY_TYPE[entry["type"]],
                            title=entry["title"],
                            detail=entry.get("detail"),
                            clinician_id=staff[entry["clinician"]].id
                            if entry.get("clinician") in staff
                            else None,
                        )
                    )

                for name, doc_type, size in DOCUMENTS:
                    db.add(
                        PatientDocument(
                            patient_id=patient.id,
                            name=name,
                            type=doc_type,
                            size_bytes=size,
                            uploaded_on=registered + timedelta(days=4),
                            uploaded_by=doctor.id if doctor else None,
                        )
                    )

            # Keep the sequence ahead of the highest seeded number so the next
            # registration cannot collide with one of these.
            highest = max(int("".join(c for c in s["id"] if c.isdigit())) for s in seeds)
            db.execute(
                select(func.setval(repo.PATIENT_NUMBER_SEQUENCE, highest))
            )

            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Patient seeding failed — no changes were committed")
            return 1

    logger.info("Patients: %s created, %s updated", created, updated)
    logger.info("Vitals, medical history and documents attached")
    logger.info("Next patient number will be PT-%s", highest + 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
