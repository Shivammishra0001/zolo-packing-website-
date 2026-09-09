"""Development ward seed: wards, beds, admissions, nursing tasks and the
discharge checklist.

Everything comes from the frontend's original sample data — ``BEDS``,
``NURSING_TASKS`` and ``DISCHARGE_PENDING`` in ``src/data/operations.ts`` — so
the bed board, the nurse's task list and the Discharges screen look exactly as
they did against mocks.

    python seed_nursing.py            # create or update
    python seed_nursing.py --reset    # delete seeded ward rows first

DEVELOPMENT / DEMO ONLY. Run ``seed.py`` and ``seed_patients.py`` first.

Two things shape this script. The first is that occupancy is a *consequence* of
an admission, exactly as ``nursing_service`` insists: every bed the mock calls
Occupied is given a real patient and a real stay, never a status on its own. The
second is that the mock contradicts itself in three places, and each
contradiction is resolved out loud — the run prints what it reconciled and why,
because silently inventing the difference away is how seed data stops being
trustworthy.

The five tables below (wards, beds, admissions, nursing tasks, discharge
checklist items) belong to this seed alone, which is what makes ``--reset`` safe
to write as a blanket delete.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from collections import Counter
from datetime import date, datetime, time, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.enums import (
    AdmissionStatus,
    BedStatus,
    BedType,
    Gender,
    NursingTaskType,
    PatientStatus,
    TaskPriority,
    UserRole,
)
from app.core.logging_config import configure_logging
from app.models import (
    Admission,
    Bed,
    Branch,
    Department,
    DischargeChecklistItem,
    NursingTask,
    Patient,
    User,
    Ward,
)
from app.repositories import patient_repository as patient_repo
from app.services.nursing_service import DEFAULT_CHECKLIST

# The birth-date rule lives in the patient seed; importing it keeps one
# definition rather than a second copy that can drift.
from seed_patients import dob_from_age

configure_logging()
logger = logging.getLogger("seed-nursing")

DATA_FILE = Path(__file__).parent / "seed_data" / "patients.json"

BED_TYPE = {member.display: member for member in BedType}
BED_STATE = {member.display: member for member in BedStatus}
TASK_TYPE = {member.display: member for member in NursingTaskType}
PRIORITY = {member.display: member for member in TaskPriority}
GENDER = {member.display: member for member in Gender}

#: "10:00" is a due time; "Hourly" and "As needed" are recurring phrases.
_CLOCK = re.compile(r"^\d{1,2}:\d{2}$")

WARD_A = "Ward A"
WARD_B = "Ward B"
REHAB_SUITES = "Rehab Suites"
ICU = "ICU"
WARDS = (WARD_A, WARD_B, REHAB_SUITES, ICU)


# ---------------------------------------------------------------------------
# The bed board
# ---------------------------------------------------------------------------

#: ``holder`` names the occupant when a bed is Occupied and carries the
#: reservation text when it is Reserved. The mock overloads one field for both,
#: and so does the model — see ``Bed.reserved_for``.
BED_BOARD = (
    # (ward, room, bed, type, status, holder, since, daily rate)
    (WARD_A, "A-1", "A-101", "Semi-Private", "Available", None, None, 1_800),
    (WARD_A, "A-1", "A-102", "Semi-Private", "Occupied", "Raj Kumar", "2026-08-18", 1_800),
    (WARD_A, "A-1", "A-103", "Semi-Private", "Reserved", "Nikhil Bharadwaj (admission 25 Aug)", None, 1_800),
    (WARD_A, "A-2", "A-104", "General", "Available", None, None, 1_400),
    (WARD_A, "A-2", "A-105", "General", "Occupied", "Amit Singh", "2026-08-02", 1_400),
    (WARD_A, "A-2", "A-106", "General", "Cleaning", None, None, 1_400),
    (WARD_A, "A-3", "A-107", "Private", "Available", None, None, 2_400),
    (WARD_A, "A-3", "A-108", "Private", "Occupied", "Gurpreet Sethi", "2026-08-18", 2_400),
    (WARD_B, "B-1", "B-201", "Private", "Occupied", "Mohammed Farhan", "2026-08-12", 2_400),
    (WARD_B, "B-1", "B-202", "Private", "Available", None, None, 2_400),
    (WARD_B, "B-2", "B-203", "Semi-Private", "Reserved", "Sunita Rathore (admission 26 Aug)", None, 1_800),
    (WARD_B, "B-2", "B-204", "Semi-Private", "Occupied", "Suresh Pillai", "2026-08-14", 1_800),
    (WARD_B, "B-3", "B-205", "General", "Available", None, None, 1_400),
    (WARD_B, "B-3", "B-206", "General", "Available", None, None, 1_400),
    (REHAB_SUITES, "R-1", "R-301", "Rehab Suite", "Occupied", "Ravi Sathe", "2026-08-16", 3_200),
    (REHAB_SUITES, "R-1", "R-302", "Rehab Suite", "Available", None, None, 3_200),
    (REHAB_SUITES, "R-2", "R-303", "Rehab Suite", "Occupied", "Meenal Kapoor", "2026-08-09", 3_200),
    (REHAB_SUITES, "R-2", "R-304", "Rehab Suite", "Cleaning", None, None, 3_200),
    (ICU, "I-1", "ICU-401", "ICU", "Occupied", "Balwant Rai", "2026-08-21", 8_500),
    (ICU, "I-1", "ICU-402", "ICU", "Available", None, None, 8_500),
)

#: The occupants the mock also registers as patients.
REGISTERED_OCCUPANTS = {
    "Raj Kumar": "PT-10248",
    "Amit Singh": "PT-10263",
    "Gurpreet Sethi": "PT-10302",
    "Mohammed Farhan": "PT-10284",
    "Suresh Pillai": "PT-10356",
}

#: The three the mock beds without registering anywhere. A bed cannot be
#: Occupied by nobody — the board would report an occupancy the admissions
#: table cannot account for — so the seed registers them as the rehabilitation
#: and critical-care inpatients their beds imply.
UNREGISTERED_OCCUPANTS = (
    # (name, gender, age, primary condition)
    ("Ravi Sathe", "Male", 58, "Incomplete spinal cord injury — inpatient neuro-rehabilitation"),
    ("Meenal Kapoor", "Female", 46, "Post-operative rehabilitation — bilateral knee arthroplasty"),
    ("Balwant Rai", "Male", 71, "Critical care — post-operative cardiac monitoring"),
)

#: A stay needs a named attending clinician or the ward round and the Discharges
#: card have nobody to show. The rehabilitation consultant at the ward block's
#: own branch is the honest choice for occupants the mock left unassigned.
OCCUPANT_DOCTOR = "Dr. Arjun Sharma"


# ---------------------------------------------------------------------------
# Nursing tasks and the discharge checklist
# ---------------------------------------------------------------------------

NURSING_TASKS = (
    # (patient, ward, bed, type, label, due, priority, done)
    ("PT-10248", WARD_A, "A-102", "Vitals", "10:00 vitals round", "10:00", "Routine", False),
    ("PT-10248", WARD_A, "A-102", "Medication", "Etoricoxib 90 mg — post breakfast", "09:30", "High", True),
    ("PT-10263", WARD_A, "A-105", "Medication", "Metformin 1000 mg with lunch", "13:00", "High", False),
    ("PT-10263", WARD_A, "A-105", "Vitals", "Blood pressure recheck — was 142/88", "11:00", "High", False),
    ("PT-10302", WARD_A, "A-108", "Doctor Instruction", "Surgical wound review with Dr. Bhatt", "14:00", "Critical", False),
    ("PT-10302", WARD_A, "A-108", "Care Task", "Ice therapy — 20 minutes post session", "11:45", "Routine", False),
    ("PT-10284", WARD_B, "B-201", "Care Task", "Discharge summary preparation", "15:00", "High", False),
    ("PT-10284", WARD_B, "B-201", "Vitals", "Pre-discharge vitals", "12:00", "Routine", False),
    ("PT-10356", WARD_B, "B-204", "Therapy Prep", "Prepare for 13:00 walker session", "12:45", "Routine", False),
    ("PT-10356", WARD_B, "B-204", "Medication", "Tramadol 50 mg if pain above 5/10", "As needed", "Routine", False),
    ("PT-10356", WARD_B, "B-204", "Vitals", "08:00 vitals round", "08:00", "Routine", True),
    ("PT-10263", WARD_A, "A-105", "Care Task", "Two-hourly position change", "Hourly", "High", True),
)

#: How many checklist lines the Discharges screen shows already ticked. The
#: frontend derives these positionally from ``DISCHARGE_PENDING`` (``i < 4`` for
#: the first entry, ``i < 2`` for the second), so the order here is the mock's.
DISCHARGE_TICKS = {
    "PT-10284": 4,
    "PT-10356": 2,
}

#: The ward nurses named in ``seed.py``. A ticked checklist line or a completed
#: task with no one against it is an unattributable sign-off.
WARD_NURSES = {
    WARD_A: "Sister Anita Fernandes",
    WARD_B: "Sister Lata Gaikwad",
}

#: Work the mock shows done but gives no clock time to. The dashboard counts
#: completions inside the clinic's day, so such a task still needs a stamp that
#: falls within it.
EARLY_ROUND = "07:00"


# ---------------------------------------------------------------------------
# Time
# ---------------------------------------------------------------------------


def today() -> date:
    """The clinic's date, not the server's."""
    return datetime.now(settings.clinic_tz).date()


def at_local(day: date, hhmm: str) -> datetime:
    """A clinic-local wall clock time, stored in UTC.

    The mock's tasks are due at "10:00" on the ward wall clock. Anchoring them
    to the clinic's zone before converting is what keeps them due at 10:00 no
    matter where the server or the database session happens to be.
    """
    hours, minutes = hhmm.split(":")
    return datetime.combine(
        day, time(int(hours), int(minutes)), tzinfo=settings.clinic_tz
    ).astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# Branch reconciliation
# ---------------------------------------------------------------------------


def ward_branch(db: Session, occupants: list[Patient]) -> Branch | None:
    """The branch the ward block belongs to, counted from its own inpatients.

    Looked up rather than named, so the block follows the data instead of an
    assumption about which campus holds Ward A.
    """
    counts = Counter(patient.branch_id for patient in occupants if patient.branch_id)
    if not counts:
        return None
    branch_id, _ = counts.most_common(1)[0]
    return db.get(Branch, branch_id)


# The bed follows the patient, never the other way round. Branch scoping reads a
# bed through its ward and a stay through its patient, so the two must agree —
# but a patient's branch is set by their therapy department, and their doctor,
# therapist and rehabilitation plan all sit at that campus. Moving the patient
# to tidy the board would take them off their own clinicians' lists, which is a
# far worse lie than one ward name appearing at two sites. Ward names repeat
# across campuses anyway; `uq_wards_branch_name` scopes uniqueness to the branch
# for exactly that reason.


# ---------------------------------------------------------------------------
# Wards, occupants and beds
# ---------------------------------------------------------------------------


class Wards:
    """Get-or-create a ward, keyed by branch and name.

    A ward block is seeded for the campus that holds it, and again for any
    campus whose own inpatient the board seats inside it — see the note above
    :data:`REGISTERED_OCCUPANTS`.
    """

    def __init__(self, db: Session) -> None:
        self._db = db
        self._cache: dict[tuple, Ward] = {}
        self.created = 0

    def get(self, branch: Branch, name: str) -> Ward:
        key = (branch.id, name)
        if key not in self._cache:
            ward = self._db.execute(
                select(Ward).where(Ward.branch_id == branch.id, Ward.name == name)
            ).scalar_one_or_none()
            if ward is None:
                ward = Ward(branch_id=branch.id, name=name)
                self._db.add(ward)
                self._db.flush()
                self.created += 1
            self._cache[key] = ward
        return self._cache[key]


def seed_wards(db: Session, branch: Branch) -> tuple[Wards, int]:
    """Create the board's four wards for the campus that holds them."""
    wards = Wards(db)
    for name in WARDS:
        wards.get(branch, name)
    db.flush()
    return wards, wards.created


def seed_occupant_patients(
    db: Session, branch: Branch, doctor: User | None
) -> tuple[dict[str, Patient], list[str]]:
    """Register the occupants the mock beds but never lists as patients.

    Only what the bed board actually asserts is recorded — a name, a bed and a
    ward. No contact details, insurance or allergies are invented, because a
    patient record nobody wrote is not data.
    """
    since = {
        holder: occupied_since
        for *_head, holder, occupied_since, _rate in BED_BOARD
        if occupied_since
    }
    registered: dict[str, Patient] = {}
    announced: list[str] = []

    for name, gender, age, condition in UNREGISTERED_OCCUPANTS:
        first, last = name.split(" ", 1)
        patient = db.execute(
            select(Patient).where(Patient.first_name == first, Patient.last_name == last)
        ).scalar_one_or_none()

        admitted_on = date.fromisoformat(since[name])
        if patient is None:
            patient = Patient(
                patient_number=patient_repo.next_patient_number(db),
                first_name=first,
                last_name=last,
                allergies=[],
            )
            db.add(patient)
            announced.append(f"{name} ({patient.patient_number})")

        patient.date_of_birth = dob_from_age(age, admitted_on)
        patient.gender = GENDER[gender]
        patient.status = PatientStatus.ADMITTED_IPD
        patient.primary_condition = condition
        patient.registration_date = admitted_on
        patient.last_visit_at = admitted_on
        patient.branch_id = branch.id
        patient.assigned_doctor_id = doctor.id if doctor else None
        registered[name] = patient

    db.flush()
    return registered, announced


def remove_occupant_patients(db: Session) -> int:
    """Delete only the patients this seed registered."""
    removed = 0
    for name, _gender, _age, _condition in UNREGISTERED_OCCUPANTS:
        first, last = name.split(" ", 1)
        patient = db.execute(
            select(Patient).where(Patient.first_name == first, Patient.last_name == last)
        ).scalar_one_or_none()
        if patient is not None:
            db.delete(patient)
            removed += 1
    return removed


def _upsert_bed(
    db: Session,
    ward: Ward,
    number: str,
    room: str,
    bed_type: str,
    status: BedStatus,
    occupant: Patient | None,
    reserved_for: str | None,
    rate: int,
) -> tuple[Bed, bool]:
    bed = db.execute(
        select(Bed).where(Bed.ward_id == ward.id, Bed.bed_number == number)
    ).scalar_one_or_none()
    fresh = bed is None
    if bed is None:
        bed = Bed(ward_id=ward.id, bed_number=number)
        db.add(bed)

    bed.room = room
    bed.type = BED_TYPE[bed_type]
    bed.status = status
    bed.daily_rate = Decimal(rate)
    # The occupant is denormalised onto the bed for the board; the admission
    # created later is what makes it true.
    bed.patient_id = occupant.id if occupant else None
    bed.reserved_for = reserved_for
    return bed, fresh


def seed_beds(
    db: Session, wards: Wards, branch: Branch, occupants: dict[str, Patient]
) -> tuple[dict[str, Bed], int, list[str]]:
    """Seed the board, seating each inpatient in a ward of their own campus."""
    beds: dict[str, Bed] = {}
    created = 0
    displaced: list[str] = []

    for ward_name, room, number, bed_type, state, holder, _since, rate in BED_BOARD:
        status = BED_STATE[state]
        occupant = occupants.get(holder or "") if status is BedStatus.OCCUPIED else None
        elsewhere = occupant is not None and occupant.branch_id != branch.id

        bed, fresh = _upsert_bed(
            db,
            wards.get(branch, ward_name),
            number,
            room,
            bed_type,
            # The bed still exists on this campus; it is simply free here,
            # because the patient the board seats in it is nursed elsewhere.
            BedStatus.AVAILABLE if elsewhere else status,
            None if elsewhere else occupant,
            holder if status is BedStatus.RESERVED else None,
            rate,
        )
        created += fresh
        beds[number] = bed

        if elsewhere:
            home = occupant.branch
            mirror, mirror_fresh = _upsert_bed(
                db,
                wards.get(home, ward_name),
                number,
                room,
                bed_type,
                BedStatus.OCCUPIED,
                occupant,
                None,
                rate,
            )
            created += mirror_fresh
            # The stay attaches to the bed on the patient's own campus, so the
            # ward nursing them can see it.
            beds[number] = mirror
            displaced.append(f"{occupant.full_name} ({ward_name} {number} at {home.name})")

    db.flush()
    return beds, created, displaced


# ---------------------------------------------------------------------------
# Admissions and checklists
# ---------------------------------------------------------------------------


def seed_admissions(
    db: Session,
    beds: dict[str, Bed],
    occupants: dict[str, Patient],
    expected: dict[str, date],
) -> tuple[list[tuple[str, Patient, Admission]], int]:
    """One open stay behind every Occupied bed."""
    stays: list[tuple[str, Patient, Admission]] = []
    created = 0

    for ward_name, _room, number, _type, state, holder, since, _rate in BED_BOARD:
        if BED_STATE[state] is not BedStatus.OCCUPIED:
            continue

        patient = occupants[holder or ""]
        bed = beds[number]
        admission = db.execute(
            select(Admission).where(
                Admission.patient_id == patient.id, Admission.bed_id == bed.id
            )
        ).scalars().first()
        if admission is None:
            admission = Admission(patient_id=patient.id, bed_id=bed.id)
            db.add(admission)
            created += 1

        admission.admission_date = date.fromisoformat(since)
        admission.expected_discharge = expected.get(patient.patient_number)
        admission.discharge_date = None
        admission.status = (
            AdmissionStatus.DISCHARGE_PENDING
            if patient.patient_number in DISCHARGE_TICKS
            else AdmissionStatus.ADMITTED
        )
        admission.attending_doctor_id = patient.assigned_doctor_id
        stays.append((ward_name, patient, admission))

    db.flush()
    return stays, created


def seed_checklists(
    db: Session,
    stays: list[tuple[str, Patient, Admission]],
    nurses: dict[str, User],
    stamp: datetime,
) -> int:
    """Give every open stay the full checklist, pre-ticked where the mock is.

    Replaced wholesale on each run, so re-seeding restores the state the
    Discharges screen expects rather than accumulating lines.
    """
    total = 0

    for ward_name, patient, admission in stays:
        db.execute(
            delete(DischargeChecklistItem).where(
                DischargeChecklistItem.admission_id == admission.id
            )
        )
        ticked = DISCHARGE_TICKS.get(patient.patient_number, 0)
        nurse = nurses.get(ward_name)

        for order, label in enumerate(DEFAULT_CHECKLIST):
            done = order < ticked
            db.add(
                DischargeChecklistItem(
                    admission_id=admission.id,
                    label=label,
                    completed=done,
                    completed_by=nurse.id if done and nurse else None,
                    completed_at=stamp if done else None,
                    sort_order=order,
                )
            )
            total += 1

    db.flush()
    return total


# ---------------------------------------------------------------------------
# Nursing tasks
# ---------------------------------------------------------------------------


def seed_tasks(
    db: Session,
    wards: Wards,
    branch: Branch,
    beds: dict[str, Bed],
    patients: dict[str, Patient],
    admissions: dict[str, Admission],
    nurses: dict[str, User],
    day: date,
) -> int:
    """The ward's work list.

    Keyed on patient and label, because a nursing task carries no business code
    of its own — so a second run updates the twelve rows rather than doubling
    them.
    """
    created = 0

    for number, ward_name, bed_number, task_type, label, due, priority, done in NURSING_TASKS:
        patient = patients.get(number)
        if patient is None:
            logger.warning("Skipping task for unknown patient %s", number)
            continue

        row = db.execute(
            select(NursingTask).where(
                NursingTask.patient_id == patient.id, NursingTask.label == label
            )
        ).scalars().first()
        if row is None:
            row = NursingTask(patient_id=patient.id, label=label)
            db.add(row)
            created += 1

        timed = bool(_CLOCK.match(due))
        # A task belongs to the ward the patient is actually in, which for an
        # inpatient nursed at another campus is that campus's ward of the same
        # name — not the one the board draws them in.
        bed = beds[bed_number]
        row.ward_id = bed.ward_id if bed.ward_id else wards.get(branch, ward_name).id
        row.bed_id = bed.id
        row.admission_id = admissions[number].id if number in admissions else None
        row.type = TASK_TYPE[task_type]
        row.priority = PRIORITY[priority]
        row.due_at = at_local(day, due) if timed else None
        row.due_label = None if timed else due
        row.done = done

        nurse = nurses.get(ward_name)
        row.completed_by = nurse.id if done and nurse else None
        row.completed_at = (row.due_at or at_local(day, EARLY_ROUND)) if done else None

    db.flush()
    return created


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed development ward and nursing data")
    parser.add_argument("--reset", action="store_true", help="delete seeded ward rows first")
    args = parser.parse_args()

    if not DATA_FILE.exists():
        logger.error("Missing %s", DATA_FILE)
        return 1

    # Read only for the expected discharge dates: they belong to the patient
    # file, and restating them here would be a second copy to keep in step.
    seeds = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    expected = {
        seed["id"]: date.fromisoformat(seed["expectedDischarge"])
        for seed in seeds
        if seed.get("expectedDischarge")
    }

    day = today()

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
                logger.warning(
                    "Deleting existing checklists, nursing tasks, admissions, beds and wards"
                )
                db.execute(delete(DischargeChecklistItem))
                db.execute(delete(NursingTask))
                db.execute(delete(Admission))
                db.execute(delete(Bed))
                db.execute(delete(Ward))
                db.flush()
                removed = remove_occupant_patients(db)
                db.flush()
                logger.warning(
                    "Also removed %s patient(s) this seed had registered", removed
                )
                patients = {p.patient_number: p for p in db.execute(select(Patient)).scalars()}

            missing = [n for n in REGISTERED_OCCUPANTS.values() if n not in patients]
            if missing:
                logger.error(
                    "Run `python seed_patients.py` first — the bed board names %s",
                    ", ".join(missing),
                )
                return 1

            known = {name: patients[number] for name, number in REGISTERED_OCCUPANTS.items()}
            branch = ward_branch(db, list(known.values()))
            if branch is None:
                logger.error("None of the mock's inpatients is assigned to a branch")
                return 1

            branch_name = branch.name
            doctor = staff.get(OCCUPANT_DOCTOR)
            if doctor is None or doctor.role is not UserRole.DOCTOR:
                logger.warning(
                    "%s is not on staff — seeded occupants will have no attending doctor",
                    OCCUPANT_DOCTOR,
                )
                doctor = None

            nurses = {
                ward: staff[name]
                for ward, name in WARD_NURSES.items()
                if name in staff and staff[name].role is UserRole.NURSE
            }

            wards, new_wards = seed_wards(db, branch)
            new_patients, announced = seed_occupant_patients(db, branch, doctor)
            occupants = {**known, **new_patients}
            by_number = {patient.patient_number: patient for patient in occupants.values()}

            beds, new_beds, displaced = seed_beds(db, wards, branch, occupants)
            stays, new_admissions = seed_admissions(db, beds, occupants, expected)
            checklist = seed_checklists(db, stays, nurses, at_local(day, "09:00"))
            admissions = {patient.patient_number: row for _ward, patient, row in stays}
            new_tasks = seed_tasks(db, wards, branch, beds, by_number, admissions, nurses, day)
            open_stays = len(stays)
            total_wards = db.execute(select(func.count(Ward.id))).scalar_one()
            total_beds = db.execute(select(func.count(Bed.id))).scalar_one()

            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Ward seeding failed — no changes were committed")
            return 1

    states = Counter(state for *_head, state, _holder, _since, _rate in BED_BOARD)

    logger.info("Branch:      %s", branch_name)
    logger.info("Wards:       %s (%s new)", total_wards, new_wards)
    logger.info(
        "Beds:        %s (%s new) — %s occupied, %s reserved",
        total_beds,
        new_beds,
        states["Occupied"],
        states["Reserved"],
    )
    logger.info(
        "Admissions:  %s open (%s new), %s discharge pending",
        open_stays,
        new_admissions,
        len(DISCHARGE_TICKS),
    )
    logger.info("Checklists:  %s items across %s stays", checklist, open_stays)
    logger.info("Tasks:       %s (%s new)", len(NURSING_TASKS), new_tasks)

    logger.info("-" * 70)
    logger.info("Reconciled, because the frontend's sample data disagreed with itself:")
    if announced:
        logger.info(
            "  Registered %s. The bed board put them in beds without a patient "
            "record anywhere, and a bed cannot be occupied by nobody.",
            "; ".join(announced),
        )
    else:
        logger.info(
            "  %s were already registered by an earlier run of this seed.",
            "; ".join(name for name, *_ in UNREGISTERED_OCCUPANTS),
        )
    if displaced:
        logger.info(
            "  Seated %s. The board draws them in %s, but their department, "
            "doctor and therapist all sit at their own campus, so the bed was "
            "made there rather than moving the patient — which would have taken "
            "them off their own clinicians' lists. The %s copy of that bed is "
            "left free.",
            "; ".join(displaced),
            branch_name,
            branch_name,
        )
    logger.info(
        "  Patient statuses were left alone: the patient file and the bed board "
        "disagree over two of them, and the Patients screen is the file's to own."
    )
    logger.info(
        "The board carries %s beds, not the 21 sometimes quoted — Ward A has 8, "
        "Ward B 6, Rehab Suites 4 and ICU 2.",
        len(BED_BOARD),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
