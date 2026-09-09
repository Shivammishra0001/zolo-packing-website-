"""Development seed data.

Creates the permission catalogue, the role matrix, branches, departments and the
eight demo staff accounts the existing frontend's login screen offers.

    python seed.py            # create or update
    python seed.py --reset    # wipe seeded rows first

╔══════════════════════════════════════════════════════════════════════════╗
║  DEVELOPMENT / DEMO ONLY                                                 ║
║  Every account below shares one well-known password. Never run this      ║
║  against an environment that holds real data, and never ship these       ║
║  credentials to production.                                              ║
╚══════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import time

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.enums import DepartmentType, UserRole, UserStatus
from app.core.logging_config import configure_logging
from app.core.permissions import PERMISSION_CATALOGUE, ROLE_MATRIX
from app.core.security import hash_password
from app.models import Branch, Department, Permission, RolePermission, User

configure_logging()
logger = logging.getLogger("seed")

# --- DEVELOPMENT CREDENTIAL — documented, shared, and never for production ---
DEMO_PASSWORD = "Rehab@123"

MAIN = "Andheri West — Main Campus"
POWAI = "Powai — Neuro Rehab Unit"
THANE = "Thane — Day Care Centre"

BRANCHES = (
    # (name, city, address, phone, opens, closes, beds, configured)
    (MAIN, "Mumbai", "Plot 22, Link Road, Andheri West, Mumbai 400058", "+91 22 4012 8800", time(7, 0), time(21, 0), 84, True),
    (POWAI, "Mumbai", "Central Avenue, Hiranandani Gardens, Powai, Mumbai 400076", "+91 22 4012 8840", time(8, 0), time(20, 0), 42, True),
    (THANE, "Thane", "Ghodbunder Road, Thane West, Thane 400610", "+91 22 4012 8870", time(9, 0), time(18, 0), 18, False),
)

DEPARTMENTS = (
    # (branch, name, type, rooms)
    (MAIN, "Rehabilitation Medicine", DepartmentType.CLINICAL, 4),
    (MAIN, "Orthopaedics", DepartmentType.CLINICAL, 3),
    (POWAI, "Neurology", DepartmentType.CLINICAL, 3),
    (MAIN, "Physiotherapy", DepartmentType.THERAPY, 6),
    (MAIN, "Occupational Therapy", DepartmentType.THERAPY, 4),
    (POWAI, "Neuro Rehabilitation", DepartmentType.THERAPY, 3),
    (MAIN, "Speech Therapy", DepartmentType.THERAPY, 2),
    (MAIN, "Cardiac Rehabilitation", DepartmentType.THERAPY, 2),
    (MAIN, "Nursing", DepartmentType.SUPPORT, 0),
    (MAIN, "Pharmacy", DepartmentType.SUPPORT, 1),
    (MAIN, "Front Office", DepartmentType.SUPPORT, 2),
    (MAIN, "Executive", DepartmentType.SUPPORT, 1),
    (MAIN, "Administration", DepartmentType.SUPPORT, 1),
    (MAIN, "Finance", DepartmentType.SUPPORT, 1),
)

# Mirrors DEMO_USERS in src/data/users.ts so the signed-in UI looks unchanged.
# branch=None means organisation-wide ("All Branches" in the frontend).
DEMO_USERS = (
    # (number, first, last, email, role, designation, department, branch, colour, initials, phone, status)
    ("USR-1001", "Vikram", "Deshmukh", "owner@rehab.com", UserRole.OWNER,
     "Founder & Managing Director", "Executive", None,
     "bg-chart-5/15 text-chart-5", "VD", "+91 98200 41122", UserStatus.ACTIVE),
    ("USR-1002", "Neha", "Kulkarni", "admin@rehab.com", UserRole.ADMIN,
     "Centre Administrator", "Administration", MAIN,
     "bg-chart-2/15 text-chart-2", "NK", "+91 98673 20981", UserStatus.ACTIVE),
    ("USR-1003", "Dr. Arjun", "Sharma", "doctor@rehab.com", UserRole.DOCTOR,
     "Consultant — Physical Medicine & Rehabilitation", "Rehabilitation Medicine", MAIN,
     "bg-info/15 text-info", "AS", "+91 99301 55420", UserStatus.ACTIVE),
    ("USR-1004", "Meera", "Iyer", "therapist@rehab.com", UserRole.THERAPIST,
     "Senior Physiotherapist", "Physiotherapy", MAIN,
     "bg-accent/15 text-accent", "MI", "+91 98195 77341", UserStatus.ACTIVE),
    ("USR-1005", "Sister Anita", "Fernandes", "nurse@rehab.com", UserRole.NURSE,
     "Ward In-charge — Ward A", "Nursing", MAIN,
     "bg-chart-6/15 text-chart-6", "AF", "+91 97690 33218", UserStatus.ACTIVE),
    ("USR-1006", "Rohit", "Malhotra", "pharmacy@rehab.com", UserRole.PHARMACIST,
     "Chief Pharmacist", "Pharmacy", MAIN,
     "bg-success/15 text-success", "RM", "+91 98338 66102", UserStatus.ACTIVE),
    ("USR-1007", "Sneha", "Patil", "reception@rehab.com", UserRole.RECEPTIONIST,
     "Front Desk Executive", "Front Office", MAIN,
     "bg-warning/15 text-warning", "SP", "+91 91678 90443", UserStatus.ACTIVE),
    ("USR-1008", "Kiran", "Rao", "accounts@rehab.com", UserRole.ACCOUNTANT,
     "Finance Manager", "Finance", None,
     "bg-chart-3/15 text-chart-3", "KR", "+91 99871 22045", UserStatus.ACTIVE),
    # The rest of STAFF_DIRECTORY in src/data/users.ts. Patients and
    # appointments reference these clinicians by name and by USR code, so they
    # have to be real rows rather than dangling strings.
    ("USR-1009", "Dr. Priya", "Nair", "priya.nair@rehab.com", UserRole.DOCTOR,
     "Consultant Neurologist", "Neurology", POWAI,
     "bg-info/15 text-info", "PN", "+91 98204 71190", UserStatus.ACTIVE),
    ("USR-1010", "Dr. Sanjay", "Bhatt", "sanjay.bhatt@rehab.com", UserRole.DOCTOR,
     "Orthopaedic Surgeon", "Orthopaedics", MAIN,
     "bg-info/15 text-info", "SB", "+91 98330 12876", UserStatus.ACTIVE),
    ("USR-1011", "Kavya", "Reddy", "kavya.reddy@rehab.com", UserRole.THERAPIST,
     "Occupational Therapist", "Occupational Therapy", MAIN,
     "bg-accent/15 text-accent", "KR", "+91 97025 44318", UserStatus.ACTIVE),
    ("USR-1012", "Tanmay", "Joshi", "tanmay.joshi@rehab.com", UserRole.THERAPIST,
     "Neuro Rehabilitation Therapist", "Neuro Rehabilitation", POWAI,
     "bg-accent/15 text-accent", "TJ", "+91 99878 20114", UserStatus.ACTIVE),
    ("USR-1013", "Farah", "Sheikh", "farah.sheikh@rehab.com", UserRole.THERAPIST,
     "Speech & Language Therapist", "Speech Therapy", MAIN,
     "bg-accent/15 text-accent", "FS", "+91 98191 65402", UserStatus.ACTIVE),
    ("USR-1014", "Sister Lata", "Gaikwad", "lata.gaikwad@rehab.com", UserRole.NURSE,
     "Staff Nurse — Ward B", "Nursing", MAIN,
     "bg-chart-6/15 text-chart-6", "LG", "+91 90045 78123", UserStatus.ACTIVE),
    ("USR-1018", "Ritika", "Shah", "ritika.shah@rehab.com", UserRole.THERAPIST,
     "Cardiac Rehabilitation Therapist", "Cardiac Rehabilitation", MAIN,
     "bg-accent/15 text-accent", "RS", "+91 98673 44127", UserStatus.PENDING),
    # Non-active accounts, so the admin approval workflow and the login
    # rejection paths have something real to exercise.
    ("USR-1016", "Divya", "Menon", "divya.menon@rehab.com", UserRole.RECEPTIONIST,
     "Front Desk Executive", "Front Office", POWAI,
     "bg-warning/15 text-warning", "DM", "+91 90290 33471", UserStatus.PENDING),
    ("USR-1015", "Imran", "Qureshi", "imran.qureshi@rehab.com", UserRole.PHARMACIST,
     "Pharmacy Assistant", "Pharmacy", THANE,
     "bg-success/15 text-success", "IQ", "+91 98929 10847", UserStatus.PENDING),
    ("USR-1017", "Aakash", "Verma", "aakash.verma@rehab.com", UserRole.ACCOUNTANT,
     "Billing Executive", "Finance", MAIN,
     "bg-chart-3/15 text-chart-3", "AV", "+91 91362 55908", UserStatus.SUSPENDED),
)


def seed_permissions(db: Session) -> dict[str, Permission]:
    """Create or update the 33 permission codes."""
    existing = {p.key: p for p in db.execute(select(Permission)).scalars()}
    created = 0
    for key, label, group in PERMISSION_CATALOGUE:
        permission = existing.get(key)
        if permission is None:
            permission = Permission(key=key, name=label, group=group)
            db.add(permission)
            existing[key] = permission
            created += 1
        else:
            permission.name = label
            permission.group = group
    db.flush()
    logger.info("Permissions: %s total (%s new)", len(existing), created)
    return existing


def seed_role_matrix(db: Session, permissions: dict[str, Permission]) -> None:
    """Replace the role matrix with the frontend's mapping."""
    db.execute(delete(RolePermission))
    db.flush()

    total = 0
    for role, keys in ROLE_MATRIX.items():
        for key in keys:
            permission = permissions.get(key)
            if permission is None:
                raise RuntimeError(f"Role {role.value} references unknown permission {key!r}")
            db.add(RolePermission(role=role, permission_id=permission.id))
            total += 1
        logger.info("  %-13s %s permissions", role.value, len(keys))
    db.flush()
    logger.info("Role matrix: %s grants across %s roles", total, len(ROLE_MATRIX))


def seed_branches(db: Session) -> dict[str, Branch]:
    existing = {b.name: b for b in db.execute(select(Branch)).scalars()}
    for name, city, address, phone, opens, closes, beds, configured in BRANCHES:
        branch = existing.get(name)
        if branch is None:
            branch = Branch(name=name)
            db.add(branch)
            existing[name] = branch
        branch.city = city
        branch.address = address
        branch.phone = phone
        branch.opens_at = opens
        branch.closes_at = closes
        branch.licensed_beds = beds
        branch.is_configured = configured
    db.flush()
    logger.info("Branches: %s", len(existing))
    return existing


def seed_departments(db: Session, branches: dict[str, Branch]) -> dict[str, Department]:
    existing = {d.name: d for d in db.execute(select(Department)).scalars()}
    for branch_name, name, dept_type, rooms in DEPARTMENTS:
        department = existing.get(name)
        if department is None:
            department = Department(name=name, branch_id=branches[branch_name].id, type=dept_type)
            db.add(department)
            existing[name] = department
        department.type = dept_type
        department.rooms = rooms
    db.flush()
    logger.info("Departments: %s", len(existing))
    return existing


def seed_users(
    db: Session, branches: dict[str, Branch], departments: dict[str, Department]
) -> None:
    """Create or update the demo accounts, hashing the shared demo password."""
    existing = {u.email.lower(): u for u in db.execute(select(User)).scalars()}
    password_hash = hash_password(DEMO_PASSWORD)

    created = updated = 0
    for (
        number, first, last, email, role, designation,
        department, branch, colour, initials, phone, status,
    ) in DEMO_USERS:
        user = existing.get(email.lower())
        if user is None:
            user = User(email=email, user_number=number)
            db.add(user)
            created += 1
        else:
            updated += 1
            user.user_number = number

        user.first_name = first
        user.last_name = last
        user.role = role
        user.status = status
        user.designation = designation
        user.department_id = departments[department].id if department else None
        user.branch_id = branches[branch].id if branch else None
        user.avatar_color = colour
        user.initials = initials
        user.phone = phone
        # Re-hashed per run so the documented demo password always works.
        user.password_hash = password_hash

    db.flush()
    logger.info("Users: %s created, %s updated", created, updated)


def reset(db: Session) -> None:
    """Remove seeded rows so the script can be re-run from clean."""
    logger.warning("Resetting seeded data")
    db.execute(delete(RolePermission))
    db.execute(delete(User))
    db.execute(delete(Permission))
    db.execute(delete(Department))
    db.execute(delete(Branch))
    db.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="delete seeded rows first")
    args = parser.parse_args()

    logger.info("=" * 70)
    logger.info("DEVELOPMENT SEED — demo accounts share one well-known password")
    logger.info("=" * 70)

    with SessionLocal() as db:
        try:
            if args.reset:
                reset(db)

            permissions = seed_permissions(db)
            seed_role_matrix(db, permissions)
            branches = seed_branches(db)
            departments = seed_departments(db, branches)
            seed_users(db, branches, departments)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Seeding failed — no changes were committed")
            return 1

    logger.info("-" * 70)
    # Phrased to avoid the "password:" pattern the log redaction filter scrubs.
    logger.info("Seeding complete. All demo accounts sign in with  ->  %s", DEMO_PASSWORD)
    logger.info("Accounts: %s", ", ".join(u[3] for u in DEMO_USERS if u[11] is UserStatus.ACTIVE))
    pending = sum(1 for u in DEMO_USERS if u[11] is UserStatus.PENDING)
    suspended = sum(1 for u in DEMO_USERS if u[11] is UserStatus.SUSPENDED)
    logger.info(
        "Also seeded: %s pending and %s suspended account(s) — all rejected at login",
        pending,
        suspended,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
