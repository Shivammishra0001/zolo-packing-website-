"""Development clinical seed: medicines, lab results and prescriptions.

All three come from the frontend's original sample data, so the Labs screen,
the doctor's Prescriptions screen and the consultation form's medicine dropdown
look exactly as they did against mocks.

    python seed_clinical.py            # create or update
    python seed_clinical.py --reset    # delete seeded clinical rows first

DEVELOPMENT / DEMO ONLY. Run ``seed.py`` and ``seed_patients.py`` first.

Consultations are deliberately not seeded: the frontend never had any mock
encounters, and inventing clinical notes would be fabricating a medical record.
They appear as doctors record them.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import date, datetime, time, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.enums import LabFlag, PrescriptionPriority, PrescriptionStatus
from app.core.logging_config import configure_logging
from app.models import (
    LabResult,
    LabResultValue,
    Medicine,
    MedicineBatch,
    Patient,
    Prescription,
    PrescriptionItem,
    User,
)

configure_logging()
logger = logging.getLogger("seed-clinical")

DATA = Path(__file__).parent / "seed_data"

FLAG = {"Normal": LabFlag.NORMAL, "Abnormal": LabFlag.ABNORMAL, "Critical": LabFlag.CRITICAL}
STATUS = {
    "Pending": PrescriptionStatus.PENDING,
    "Partially Dispensed": PrescriptionStatus.PARTIALLY_DISPENSED,
    "Dispensed": PrescriptionStatus.DISPENSED,
    "Cancelled": PrescriptionStatus.CANCELLED,
}
PRIORITY = {"Routine": PrescriptionPriority.ROUTINE, "Urgent": PrescriptionPriority.URGENT}

#: "12 mg", "1.16% w/w" — the trailing dose in a catalogue name.
_STRENGTH = re.compile(r"([\d.]+\s*(?:mg|g|mcg|ml|IU|%)\b.*)$", re.IGNORECASE)


def strength_of(name: str) -> str | None:
    """The strength embedded in a medicine name, e.g. "Paracetamol 650 mg"."""
    match = _STRENGTH.search(name)
    return match.group(1).strip() if match else None


def split_value(text: str) -> tuple[str, str | None]:
    """Split "14.1 g/dL" into its reading and its unit.

    A reading without a unit ("-2.9", "Negative") keeps the whole string.
    """
    parts = text.strip().split(" ", 1)
    if len(parts) == 2 and any(c.isdigit() for c in parts[0]):
        return parts[0], parts[1]
    return text.strip(), None


def at_noon(on: date) -> datetime:
    """A clinic-local midday timestamp, stored in UTC.

    The mock data carries dates only; midday keeps a row on the intended day in
    both the clinic's zone and UTC.
    """
    return datetime.combine(on, time(12, 0), tzinfo=settings.clinic_tz).astimezone(timezone.utc)


def seed_medicines(db: Session, seeds: list[dict]) -> int:
    """Catalogue plus one batch each — stock lives on batches, not medicines."""
    existing = {m.name: m for m in db.execute(select(Medicine)).scalars()}
    created = 0

    for seed in seeds:
        medicine = existing.get(seed["name"])
        if medicine is None:
            medicine = Medicine(medicine_number=seed["id"], name=seed["name"])
            db.add(medicine)
            created += 1

        medicine.generic_name = seed.get("genericName")
        medicine.category = seed.get("category")
        medicine.manufacturer = seed.get("manufacturer")
        medicine.rack_location = seed.get("rackLocation")
        medicine.reorder_level = seed.get("threshold", 0)
        medicine.is_active = True
        db.flush()

        batch = next(
            (b for b in medicine.batches if b.batch_number == seed["batch"]),
            None,
        )
        if batch is None:
            batch = MedicineBatch(medicine_id=medicine.id, batch_number=seed["batch"])
            db.add(batch)
        batch.quantity = seed["quantity"]
        batch.purchase_price = seed["unitPrice"]
        batch.selling_price = seed["unitPrice"]
        batch.mrp = seed["mrp"]
        batch.expiry_date = date.fromisoformat(seed["expiry"])
        db.flush()

    return created


def seed_labs(db: Session, seeds: list[dict], patients: dict[str, Patient], staff: dict[str, User]) -> int:
    existing = {row.lab_number: row for row in db.execute(select(LabResult)).scalars()}
    created = 0

    for seed in seeds:
        patient = patients.get(seed["patientId"])
        if patient is None:
            logger.warning("Skipping %s — unknown patient %s", seed["id"], seed["patientId"])
            continue

        row = existing.get(seed["id"])
        if row is None:
            row = LabResult(lab_number=seed["id"])
            db.add(row)
            created += 1

        row.patient_id = patient.id
        row.doctor_id = patient.assigned_doctor_id
        row.test = seed["test"]
        row.reported_on = date.fromisoformat(seed["reportedOn"])
        row.flag = FLAG[seed["flag"]]
        row.summary = seed.get("summary")
        row.reviewed = bool(seed.get("reviewed"))
        # A seeded report marked reviewed needs a reviewer, or the sign-off is
        # unattributable. The patient's own doctor is the honest choice.
        row.reviewed_by = patient.assigned_doctor_id if row.reviewed else None
        row.reviewed_at = at_noon(row.reported_on) if row.reviewed else None
        row.created_at = at_noon(row.reported_on)
        db.flush()

        # Values are replaced wholesale — a report is reissued, not patched.
        db.execute(delete(LabResultValue).where(LabResultValue.lab_result_id == row.id))
        for value in seed["values"]:
            reading, unit = split_value(value["value"])
            db.add(
                LabResultValue(
                    lab_result_id=row.id,
                    analyte=value["analyte"],
                    value=reading,
                    unit=unit,
                    reference_range=value.get("reference"),
                    is_abnormal=bool(value.get("abnormal")),
                )
            )
        db.flush()

    return created


def seed_prescriptions(
    db: Session, seeds: list[dict], patients: dict[str, Patient], staff: dict[str, User]
) -> int:
    medicines = {m.name: m for m in db.execute(select(Medicine)).scalars()}
    existing = {p.prescription_number: p for p in db.execute(select(Prescription)).scalars()}
    created = 0

    for seed in seeds:
        patient = patients.get(seed["patientId"])
        doctor = staff.get(seed["doctor"])
        if patient is None or doctor is None:
            logger.warning(
                "Skipping %s — unknown patient %s or doctor %s",
                seed["id"],
                seed["patientId"],
                seed["doctor"],
            )
            continue

        row = existing.get(seed["id"])
        if row is None:
            row = Prescription(prescription_number=seed["id"])
            db.add(row)
            created += 1

        row.patient_id = patient.id
        row.doctor_id = doctor.id
        row.status = STATUS[seed["status"]]
        row.priority = PRIORITY[seed["priority"]]
        row.created_at = at_noon(date.fromisoformat(seed["date"]))
        db.flush()

        db.execute(delete(PrescriptionItem).where(PrescriptionItem.prescription_id == row.id))
        for line in seed["items"]:
            medicine = medicines.get(line["medicine"])
            if medicine is None:
                logger.warning("  %s: %r is not in the catalogue", seed["id"], line["medicine"])
                continue
            # Keep dispensed quantities consistent with the status, so the
            # pharmacy module inherits coherent data rather than a contradiction.
            quantity = line["quantity"]
            if row.status is PrescriptionStatus.DISPENSED:
                dispensed = quantity
            elif row.status is PrescriptionStatus.PARTIALLY_DISPENSED:
                dispensed = quantity // 2
            else:
                dispensed = 0

            db.add(
                PrescriptionItem(
                    prescription_id=row.id,
                    medicine_id=medicine.id,
                    strength=line.get("strength") or strength_of(line["medicine"]),
                    dosage=line.get("dosage"),
                    frequency=line.get("frequency"),
                    duration=line.get("duration"),
                    quantity=quantity,
                    quantity_dispensed=dispensed,
                    instructions=line.get("instructions"),
                )
            )
        db.flush()

    return created


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed development clinical data")
    parser.add_argument("--reset", action="store_true", help="delete seeded rows first")
    args = parser.parse_args()

    files = {name: DATA / f"{name}.json" for name in ("medicines", "labs", "prescriptions")}
    missing = [str(p) for p in files.values() if not p.exists()]
    if missing:
        logger.error("Missing seed files: %s", ", ".join(missing))
        return 1

    data = {name: json.loads(path.read_text(encoding="utf-8")) for name, path in files.items()}

    with SessionLocal() as db:  # type: Session
        try:
            patients = {p.patient_number: p for p in db.execute(select(Patient)).scalars()}
            staff = {u.full_name: u for u in db.execute(select(User)).scalars()}

            if not patients or not staff:
                logger.error(
                    "Run `python seed.py` and `python seed_patients.py` first — "
                    "patients and staff are missing"
                )
                return 1

            if args.reset:
                logger.warning("Deleting existing prescriptions, lab results and medicines")
                db.execute(delete(PrescriptionItem))
                db.execute(delete(Prescription))
                db.execute(delete(LabResultValue))
                db.execute(delete(LabResult))
                db.execute(delete(MedicineBatch))
                db.execute(delete(Medicine))
                db.flush()

            medicines = seed_medicines(db, data["medicines"])
            labs = seed_labs(db, data["labs"], patients, staff)
            prescriptions = seed_prescriptions(db, data["prescriptions"], patients, staff)

            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Clinical seeding failed — no changes were committed")
            return 1

    logger.info("Medicines:     %s created (%s in file)", medicines, len(data["medicines"]))
    logger.info("Lab results:   %s created (%s in file)", labs, len(data["labs"]))
    logger.info("Prescriptions: %s created (%s in file)", prescriptions, len(data["prescriptions"]))
    logger.info("Consultations are not seeded — they are recorded by doctors in the app")
    return 0


if __name__ == "__main__":
    sys.exit(main())
