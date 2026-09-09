"""Development appointment seed.

Loads the clinic diary from ``seed_data/appointments.json``, extracted from the
frontend's original ``src/data/appointments.ts`` so the doctor list, the
reception queue and the Patient 360 timeline look exactly as they did against
mock data — only now the rows come from PostgreSQL.

    python seed_appointments.py            # create or update
    python seed_appointments.py --reset    # delete seeded appointments first

DEVELOPMENT / DEMO ONLY. Run ``seed.py`` and ``seed_patients.py`` first — this
needs the staff accounts and patients they create.

Two deliberate differences from the mock data:

* Appointment numbers are regenerated in the backend's canonical
  ``APT-YYYY-#####`` format. The UI never renders them; it uses them only as a
  React key, so nothing on screen changes.
* Mock rows carry no end time. Each is given the standard slot length, which
  keeps every seeded row clear of the database's overlap constraints.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.enums import AppointmentStatus, AppointmentType
from app.core.ids import APPOINTMENT
from app.core.logging_config import configure_logging
from app.models import Appointment, Patient, User
from app.services.appointment_service import DEFAULT_SLOT_MINUTES

configure_logging()
logger = logging.getLogger("seed-appointments")

DATA_FILE = Path(__file__).parent / "seed_data" / "appointments.json"


def parse_time(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def slot_end(start: time) -> time:
    return (datetime.combine(date.min, start) + timedelta(minutes=DEFAULT_SLOT_MINUTES)).time()


def checked_in_at(on_date: date, hhmm: str | None) -> datetime | None:
    """Mock data records a clinic wall-clock time; the column stores UTC."""
    if not hhmm:
        return None
    local = datetime.combine(on_date, parse_time(hhmm), tzinfo=settings.clinic_tz)
    return local.astimezone(timezone.utc)


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed development appointments")
    parser.add_argument(
        "--reset", action="store_true", help="delete existing appointments first"
    )
    args = parser.parse_args()

    if not DATA_FILE.exists():
        logger.error("Missing %s", DATA_FILE)
        return 1

    seeds = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    with SessionLocal() as db:  # type: Session
        try:
            patients = {p.patient_number: p for p in db.execute(select(Patient)).scalars()}
            staff = {u.user_number: u for u in db.execute(select(User)).scalars()}

            if not patients or not staff:
                logger.error(
                    "Run `python seed.py` and `python seed_patients.py` first — "
                    "patients and staff are missing"
                )
                return 1

            if args.reset:
                logger.warning("Deleting existing appointments")
                db.execute(delete(Appointment))
                db.flush()

            existing = {
                a.appointment_number: a for a in db.execute(select(Appointment)).scalars()
            }
            # Seeded rows are matched on (patient, date, start) rather than the
            # mock code, so re-running does not duplicate the diary.
            by_slot = {
                (a.patient_id, a.appointment_date, a.start_time): a for a in existing.values()
            }

            created = updated = skipped = 0
            # Continue each year's numbering from whatever is already stored,
            # so re-seeding on top of live bookings cannot reuse a code.
            counters: dict[int, int] = {}
            for number in existing:
                prefix, year, body = number.split("-")
                if prefix == "APT":
                    counters[int(year)] = max(counters.get(int(year), 0), int(body))

            for row in seeds:
                patient = patients.get(row["patientId"])
                clinician = staff.get(row["doctorId"])
                if patient is None or clinician is None:
                    logger.warning(
                        "Skipping %s — unknown patient %s or clinician %s",
                        row["id"],
                        row["patientId"],
                        row["doctorId"],
                    )
                    skipped += 1
                    continue

                on_date = date.fromisoformat(row["date"])
                start = parse_time(row["time"])

                appointment = by_slot.get((patient.id, on_date, start))
                if appointment is None:
                    year = on_date.year
                    counters[year] = counters.get(year, 0) + 1
                    appointment = Appointment(
                        appointment_number=APPOINTMENT.format(counters[year], year=year)
                    )
                    db.add(appointment)
                    created += 1
                else:
                    updated += 1

                appointment.patient_id = patient.id
                appointment.doctor_id = clinician.id
                appointment.department_id = clinician.department_id
                appointment.appointment_date = on_date
                appointment.start_time = start
                appointment.end_time = slot_end(start)
                appointment.appointment_type = AppointmentType.from_display(row["type"])
                appointment.status = AppointmentStatus.from_display(row["status"])
                appointment.token_number = row.get("tokenNumber")
                appointment.checked_in_at = checked_in_at(on_date, row.get("checkedInAt"))
                appointment.notes = row.get("notes")
                appointment.room = row.get("room")
                db.flush()

            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Appointment seeding failed — no changes were committed")
            return 1

    logger.info(
        "Appointments: %s created, %s updated, %s skipped", created, updated, skipped
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
