"""Development rehabilitation seed: exercise library, plans, milestones,
weekly progress points and therapy sessions.

Everything comes from the frontend's original sample data, so the therapist
screens and the rehabilitation charts look exactly as they did against mocks.

    python seed_rehab.py            # create or update
    python seed_rehab.py --reset    # delete seeded rehab rows first

DEVELOPMENT / DEMO ONLY. Run ``seed.py`` and ``seed_patients.py`` first.

The weekly progress series is regenerated here with the *same* deterministic
curve the frontend used (`buildProgress` in `src/data/patients.ts`), seeded off
the patient number — so the charts are identical, not merely similar.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.enums import (
    AttendanceStatus,
    MilestoneStatus,
    RehabPlanStatus,
    RehabTrend,
    TherapySessionStatus,
    TherapyType,
)
from app.core.ids import THERAPY_SESSION
from app.core.logging_config import configure_logging
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
from app.services import rehab_service

configure_logging()
logger = logging.getLogger("seed-rehab")

DATA = Path(__file__).parent / "seed_data"

TREND = {
    "On Track": RehabTrend.ON_TRACK,
    "Ahead of Plan": RehabTrend.AHEAD_OF_PLAN,
    "Plateaued": RehabTrend.PLATEAUED,
    "At Risk": RehabTrend.AT_RISK,
    "Completed": RehabTrend.COMPLETED,
}
SESSION_STATUS = {
    "Scheduled": TherapySessionStatus.SCHEDULED,
    "In Progress": TherapySessionStatus.IN_PROGRESS,
    "Completed": TherapySessionStatus.COMPLETED,
    "Missed": TherapySessionStatus.MISSED,
}
THERAPY_TYPE = {member.display: member for member in TherapyType}

WEEK_LABELS = ["Wk 1", "Wk 2", "Wk 3", "Wk 4", "Wk 5", "Wk 6", "Wk 7", "Wk 8"]


def seeded_random(seed: int):
    """The frontend's `seeded()` PRNG, ported exactly.

    A mulberry32-style generator — same seed, same sequence, so the seeded
    curve matches the one the mock data drew.
    """
    state = seed

    def rand() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        t &= 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rand


def build_progress(seed: int, shape: dict) -> list[dict]:
    """The frontend's `buildProgress`, ported so the charts are identical."""
    rand = seeded_random(seed)
    n = shape["weeks"]
    plateau = shape.get("plateau", 0) or 0
    rows = []

    for i in range(n):
        raw = 1.0 if n == 1 else i / (n - 1)
        t = (raw**(1 + plateau) * (1 - plateau * 0.28) + raw * plateau * 0.28) if plateau else raw
        jitter = (rand() - 0.5) * 0.5
        rows.append(
            {
                "week": WEEK_LABELS[i] if i < len(WEEK_LABELS) else f"Wk {i + 1}",
                "pain": round(
                    max(
                        0.0,
                        shape["painFrom"] + (shape["painTo"] - shape["painFrom"]) * t + jitter * 0.6,
                    ),
                    1,
                ),
                "mobility": round(
                    shape["mobilityFrom"]
                    + (shape["mobilityTo"] - shape["mobilityFrom"]) * t
                    + jitter * 2
                ),
                "strength": round(
                    shape["strengthFrom"]
                    + (shape["strengthTo"] - shape["strengthFrom"]) * t
                    + jitter * 2
                ),
                "adherence": min(100, round(shape["adherence"] + jitter * 4)),
            }
        )
    return rows


def monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def digits(text: str) -> int:
    return int("".join(c for c in text if c.isdigit()) or 0)


# ---------------------------------------------------------------------------
# Exercise library
# ---------------------------------------------------------------------------


def seed_exercises(db: Session, library: dict[str, list[str]], sessions: list[dict]) -> int:
    """The exercise catalogue, from the frontend library plus its own sessions.

    The mock library and the mock session data disagreed: 17 exercises appear on
    sessions without being listed in their discipline's protocol. The catalogue
    has to cover everything the clinic actually delivers, or a therapist reopening
    one of those sessions cannot save it — so both sources are merged here.
    """
    merged: dict[str, list[str]] = {k: list(v) for k, v in library.items()}
    for session in sessions:
        known = {n.lower() for n in merged.get(session["type"], [])}
        for name in session.get("exercises", []):
            if name.lower() not in known:
                merged.setdefault(session["type"], []).append(name)
                known.add(name.lower())

    existing = {
        (row.category, row.name.lower()): row
        for row in db.execute(select(ExerciseLibrary)).scalars()
    }
    created = 0

    for category_label, names in merged.items():
        category = THERAPY_TYPE[category_label]
        for name in names:
            if (category, name.lower()) in existing:
                continue
            db.add(
                ExerciseLibrary(
                    name=name,
                    category=category,
                    # The frontend library is names only, so nothing else is
                    # invented here — a description nobody wrote is not data.
                    default_duration=None,
                    is_active=True,
                )
            )
            created += 1
    db.flush()
    return created


# ---------------------------------------------------------------------------
# Plans, milestones and progress
# ---------------------------------------------------------------------------


def seed_plans(db: Session, seeds: list[dict], patients: dict, staff: dict) -> tuple[int, int, int]:
    plans = created = milestones = points = 0

    for seed in seeds:
        plan_seed = seed.get("plan")
        if not plan_seed:
            continue
        patient = patients.get(seed["id"])
        therapist = staff.get(plan_seed["primaryTherapist"])
        if patient is None:
            logger.warning("Skipping plan for unknown patient %s", seed["id"])
            continue
        if therapist is None:
            logger.warning("Skipping plan for %s — unknown therapist %s", seed["id"], plan_seed["primaryTherapist"])
            continue

        plan = db.execute(
            select(RehabPlan).where(
                RehabPlan.patient_id == patient.id, RehabPlan.name == plan_seed["title"]
            )
        ).scalar_one_or_none()
        if plan is None:
            plan = RehabPlan(patient_id=patient.id, name=plan_seed["title"])
            db.add(plan)
            created += 1
        plans += 1

        trend = TREND[plan_seed["trend"]]
        plan.therapist_id = therapist.id
        plan.goals = plan_seed.get("goal")
        plan.start_date = date.fromisoformat(plan_seed["startDate"])
        plan.end_date = date.fromisoformat(plan_seed["targetEndDate"])
        plan.total_sessions = plan_seed["totalSessions"]
        plan.frequency_per_week = plan_seed.get("frequencyPerWeek")
        plan.modalities = list(plan_seed.get("modalities", []))
        plan.status = (
            RehabPlanStatus.COMPLETED if trend is RehabTrend.COMPLETED else RehabPlanStatus.ACTIVE
        )
        # Seeded to the mock's figures; from here on they are recalculated from
        # sessions, which is the only thing that may write them.
        plan.completed_sessions = plan_seed["completedSessions"]
        plan.attendance_rate = Decimal(str(plan_seed["attendanceRate"]))
        plan.adherence_rate = Decimal(str(plan_seed["adherenceRate"]))
        plan.trend = trend
        db.flush()

        # Milestones replaced wholesale, so re-running stays idempotent.
        db.execute(delete(RehabMilestone).where(RehabMilestone.rehab_plan_id == plan.id))
        for order, milestone in enumerate(plan_seed.get("milestones", [])):
            done = bool(milestone.get("done"))
            target = date.fromisoformat(milestone["date"])
            db.add(
                RehabMilestone(
                    rehab_plan_id=plan.id,
                    title=milestone["label"],
                    target_date=target,
                    status=MilestoneStatus.ACHIEVED if done else MilestoneStatus.PENDING,
                    completed_at=(
                        datetime.combine(target, time(12, 0), tzinfo=timezone.utc) if done else None
                    ),
                    sort_order=order,
                )
            )
            milestones += 1

        shape = seed.get("progress")
        if shape:
            db.execute(
                delete(RehabProgressPoint).where(RehabProgressPoint.rehab_plan_id == plan.id)
            )
            start = monday(plan.start_date)
            for index, row in enumerate(build_progress(digits(seed["id"]), shape)):
                db.add(
                    RehabProgressPoint(
                        patient_id=patient.id,
                        rehab_plan_id=plan.id,
                        week_start=start + timedelta(weeks=index),
                        week_label=row["week"],
                        pain=Decimal(str(row["pain"])),
                        mobility=row["mobility"],
                        strength=row["strength"],
                        adherence=row["adherence"],
                    )
                )
                points += 1
        db.flush()

    return plans, milestones, points


# ---------------------------------------------------------------------------
# Therapy sessions
# ---------------------------------------------------------------------------


def seed_sessions(db: Session, seeds: list[dict], patients: dict, staff_by_code: dict) -> int:
    exercises = {
        (row.category, row.name.lower()): row
        for row in db.execute(select(ExerciseLibrary)).scalars()
    }
    existing = {row.session_number: row for row in db.execute(select(TherapySession)).scalars()}
    # Next position per plan, so a re-run does not restart the numbering.
    sequences: dict = {}
    created = 0

    for seed in seeds:
        patient = patients.get(seed["patientId"])
        therapist = staff_by_code.get(seed["therapistId"])
        if patient is None or therapist is None:
            logger.warning(
                "Skipping %s — unknown patient %s or therapist %s",
                seed["id"],
                seed["patientId"],
                seed["therapistId"],
            )
            continue

        session_type = THERAPY_TYPE[seed["type"]]
        status = SESSION_STATUS[seed["status"]]

        # The session belongs to the patient's plan — that link is what makes
        # the plan's progress countable.
        plan = db.execute(
            select(RehabPlan)
            .where(RehabPlan.patient_id == patient.id)
            .order_by(RehabPlan.created_at)
        ).scalars().first()

        row = existing.get(seed["id"])
        if row is None:
            row = TherapySession(session_number=seed["id"])
            db.add(row)
            created += 1

        row.patient_id = patient.id
        row.therapist_id = therapist.id
        row.rehab_plan_id = plan.id if plan else None
        row.session_date = date.fromisoformat(seed["date"])
        hours, minutes = seed["time"].split(":")
        row.start_time = time(int(hours), int(minutes))
        row.duration = seed.get("durationMinutes")
        row.session_type = session_type
        row.room = seed.get("room")
        row.status = status
        row.attendance_status = (
            AttendanceStatus.ATTENDED
            if status is TherapySessionStatus.COMPLETED
            else AttendanceStatus.NO_SHOW
            if status is TherapySessionStatus.MISSED
            else None
        )
        row.pain_before = Decimal(str(seed["painBefore"])) if seed.get("painBefore") is not None else None
        row.pain_after = Decimal(str(seed["painAfter"])) if seed.get("painAfter") is not None else None
        row.mobility_score = seed.get("mobilityScore")
        row.strength_score = seed.get("strengthScore")
        row.therapist_notes = seed.get("notes")

        if plan is not None:
            key = plan.id
            if key not in sequences:
                highest = db.execute(
                    select(TherapySession.sequence_in_plan)
                    .where(TherapySession.rehab_plan_id == plan.id)
                    .order_by(TherapySession.sequence_in_plan.desc())
                    .limit(1)
                ).scalar_one_or_none()
                sequences[key] = highest or 0
            if row.sequence_in_plan is None:
                sequences[key] += 1
                row.sequence_in_plan = sequences[key]

        db.flush()

        db.execute(
            delete(TherapySessionExercise).where(
                TherapySessionExercise.therapy_session_id == row.id
            )
        )
        for name in seed.get("exercises", []):
            library = exercises.get((session_type, name.lower()))
            db.add(
                TherapySessionExercise(
                    therapy_session_id=row.id,
                    exercise_id=library.id if library else None,
                    exercise_name=name,
                )
            )
        db.flush()

    return created


def seed_history(db: Session, seeds: list[dict], patients: dict, staff: dict) -> tuple[int, int]:
    """Create the delivered sessions each plan's progress implies.

    The mock data asserted "18 of 24 sessions completed" with no sessions behind
    it. Since the plan's counters are derived from sessions — which is the whole
    point — that history has to actually exist, or every seeded plan reads as
    barely started.

    Sessions are laid down at the plan's own frequency from its start date, and
    enough are marked missed to reproduce the attendance rate the mock showed.
    """
    library = {}
    for row in db.execute(select(ExerciseLibrary)).scalars():
        library.setdefault(row.category, []).append(row)

    created = missed_total = 0
    next_code = _highest_session_code(db)

    for seed in seeds:
        plan_seed = seed.get("plan")
        patient = patients.get(seed["id"])
        therapist = staff.get(plan_seed["primaryTherapist"]) if plan_seed else None
        if not plan_seed or patient is None or therapist is None:
            continue

        plan = db.execute(
            select(RehabPlan).where(
                RehabPlan.patient_id == patient.id, RehabPlan.name == plan_seed["title"]
            )
        ).scalar_one_or_none()
        if plan is None:
            continue

        completed = plan_seed["completedSessions"]
        attendance = plan_seed.get("attendanceRate") or 100
        # completed / (completed + missed) = attendance  ->  solve for missed.
        missed = max(0, round(completed / (attendance / 100)) - completed) if attendance else 0

        already = db.execute(
            select(TherapySession).where(TherapySession.rehab_plan_id == plan.id)
        ).scalars().all()
        # The 14 explicit mock sessions are today's diary; anything already
        # recorded counts toward the target so re-running does not pile up.
        have_completed = sum(1 for s in already if s.status is TherapySessionStatus.COMPLETED)
        have_missed = sum(1 for s in already if s.status is TherapySessionStatus.MISSED)

        to_create = [TherapySessionStatus.COMPLETED] * max(0, completed - have_completed)
        to_create += [TherapySessionStatus.MISSED] * max(0, missed - have_missed)
        if not to_create:
            continue

        sequence = max((s.sequence_in_plan or 0) for s in already) if already else 0
        discipline = _plan_discipline(plan_seed, therapist)
        pool = library.get(discipline, [])
        rand = seeded_random(digits(seed["id"]) + 977)

        # Spread the history backwards from the day before the mock diary, at
        # the plan's own frequency, so the dates are plausible and ordered.
        per_week = plan_seed.get("frequencyPerWeek") or 3
        gap = max(1, round(7 / per_week))
        cursor = date.fromisoformat("2026-08-23")

        for offset, status in enumerate(reversed(to_create)):
            sequence += 1
            next_code += 1
            session_date = max(plan.start_date, cursor - timedelta(days=gap * offset))
            delivered = status is TherapySessionStatus.COMPLETED

            row = TherapySession(
                session_number=THERAPY_SESSION.format(next_code),
                sequence_in_plan=sequence,
                patient_id=patient.id,
                therapist_id=therapist.id,
                rehab_plan_id=plan.id,
                session_date=session_date,
                start_time=time(9 + (offset % 8), 0),
                duration=45,
                session_type=discipline,
                room=f"Gym {1 + (offset % 2)}",
                status=status,
                attendance_status=(
                    AttendanceStatus.ATTENDED if delivered else AttendanceStatus.NO_SHOW
                ),
                pain_before=Decimal(str(round(3 + rand() * 3, 1))) if delivered else None,
                pain_after=Decimal(str(round(2 + rand() * 2, 1))) if delivered else None,
                mobility_score=round(55 + rand() * 30) if delivered else None,
                strength_score=round(50 + rand() * 30) if delivered else None,
            )
            db.add(row)
            db.flush()

            if delivered and pool:
                for exercise in pool[: 2 + int(rand() * 2)]:
                    db.add(
                        TherapySessionExercise(
                            therapy_session_id=row.id,
                            exercise_id=exercise.id,
                            exercise_name=exercise.name,
                        )
                    )
            created += 1
            if not delivered:
                missed_total += 1
        db.flush()

    return created, missed_total


def _plan_discipline(plan_seed: dict, therapist) -> TherapyType:
    """The discipline a plan's history is delivered in."""
    if therapist.department is not None:
        for member in TherapyType:
            if member.display.lower() == therapist.department.name.lower():
                return member
    return TherapyType.PHYSIOTHERAPY


def _highest_session_code(db: Session) -> int:
    highest = 5500
    for row in db.execute(select(TherapySession.session_number)).scalars():
        if row.startswith("TS-"):
            highest = max(highest, digits(row))
    return highest


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed development rehabilitation data")
    parser.add_argument("--reset", action="store_true", help="delete seeded rehab rows first")
    args = parser.parse_args()

    files = {
        "patients": DATA / "patients.json",
        "sessions": DATA / "therapy_sessions.json",
        "library": DATA / "exercise_library.json",
    }
    missing = [str(p) for p in files.values() if not p.exists()]
    if missing:
        logger.error("Missing seed files: %s", ", ".join(missing))
        return 1

    data = {name: json.loads(path.read_text(encoding="utf-8")) for name, path in files.items()}

    with SessionLocal() as db:  # type: Session
        try:
            patients = {p.patient_number: p for p in db.execute(select(Patient)).scalars()}
            staff = {u.full_name: u for u in db.execute(select(User)).scalars()}
            staff_by_code = {u.user_number: u for u in db.execute(select(User)).scalars()}

            if not patients or not staff:
                logger.error(
                    "Run `python seed.py` and `python seed_patients.py` first — "
                    "patients and staff are missing"
                )
                return 1

            if args.reset:
                logger.warning("Deleting existing rehabilitation and therapy rows")
                db.execute(delete(TherapySessionExercise))
                db.execute(delete(TherapySession))
                db.execute(delete(RehabProgressPoint))
                db.execute(delete(RehabMilestone))
                db.execute(delete(RehabPlan))
                db.execute(delete(ExerciseLibrary))
                db.flush()

            exercises = seed_exercises(db, data["library"], data["sessions"])
            plans, milestones, points = seed_plans(db, data["patients"], patients, staff)
            sessions = seed_sessions(db, data["sessions"], patients, staff_by_code)
            history, missed = seed_history(db, data["patients"], patients, staff)

            # Now that sessions exist, let the service recompute every plan's
            # derived values — so the seeded figures agree with the sessions
            # behind them rather than merely being copied from the mock.
            for plan in db.execute(select(RehabPlan)).scalars():
                rehab_service.recalculate(db, plan)
                db.add(plan)

            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Rehabilitation seeding failed — no changes were committed")
            return 1

    logger.info(
        "Exercise library: %s created (%s in the frontend library, plus those its sessions use)",
        exercises,
        sum(len(v) for v in data["library"].values()),
    )
    logger.info("Rehab plans:      %s (%s new)", plans, plans and plans)
    logger.info("Milestones:       %s", milestones)
    logger.info("Progress points:  %s", points)
    logger.info("Therapy sessions: %s created (%s in file)", sessions, len(data["sessions"]))
    logger.info(
        "Session history:  %s created (%s marked missed, to reproduce attendance)",
        history,
        missed,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
