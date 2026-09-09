"""Minimal object builders for constraint tests.

Each helper creates the smallest valid row, so a test only has to state the
thing it actually cares about.
"""

from __future__ import annotations

import uuid
from datetime import date, time
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.enums import (
    AdmissionStatus,
    AppointmentType,
    BedType,
    DepartmentType,
    Gender,
    PatientStatus,
    PermissionGroup,
    TherapyType,
    UserRole,
    UserStatus,
)
from app.models import (
    Admission,
    Appointment,
    Bed,
    Branch,
    Department,
    Medicine,
    MedicineBatch,
    Patient,
    Permission,
    Prescription,
    PrescriptionItem,
    User,
    Ward,
)


def _suffix() -> str:
    """Short unique token so repeated calls never collide on unique columns."""
    return uuid.uuid4().hex[:10]


def make_branch(db: Session, **kw) -> Branch:
    branch = Branch(name=kw.pop("name", f"Branch {_suffix()}"), city="Mumbai", **kw)
    db.add(branch)
    db.flush()
    return branch


def make_department(db: Session, branch: Branch | None = None, **kw) -> Department:
    branch = branch or make_branch(db)
    dept = Department(
        branch_id=branch.id,
        name=kw.pop("name", f"Dept {_suffix()}"),
        type=kw.pop("type", DepartmentType.CLINICAL),
        **kw,
    )
    db.add(dept)
    db.flush()
    return dept


def make_user(db: Session, role: UserRole = UserRole.DOCTOR, **kw) -> User:
    token = _suffix()
    user = User(
        user_number=kw.pop("user_number", f"USR-{token[:6]}"),
        first_name=kw.pop("first_name", "Test"),
        last_name=kw.pop("last_name", "User"),
        email=kw.pop("email", f"user-{token}@rehab.test"),
        password_hash=kw.pop("password_hash", "not-a-real-hash"),
        role=role,
        status=kw.pop("status", UserStatus.ACTIVE),
        **kw,
    )
    db.add(user)
    db.flush()
    return user


def make_patient(db: Session, **kw) -> Patient:
    token = _suffix()
    patient = Patient(
        patient_number=kw.pop("patient_number", f"PT-{token[:8]}"),
        first_name=kw.pop("first_name", "Test"),
        last_name=kw.pop("last_name", "Patient"),
        gender=kw.pop("gender", Gender.MALE),
        status=kw.pop("status", PatientStatus.ACTIVE_OPD),
        registration_date=kw.pop("registration_date", date(2026, 1, 1)),
        **kw,
    )
    db.add(patient)
    db.flush()
    return patient


def make_ward(db: Session, branch: Branch | None = None, **kw) -> Ward:
    branch = branch or make_branch(db)
    ward = Ward(branch_id=branch.id, name=kw.pop("name", f"Ward {_suffix()}"), **kw)
    db.add(ward)
    db.flush()
    return ward


def make_bed(db: Session, ward: Ward | None = None, **kw) -> Bed:
    ward = ward or make_ward(db)
    bed = Bed(
        ward_id=ward.id,
        bed_number=kw.pop("bed_number", f"B-{_suffix()[:6]}"),
        type=kw.pop("type", BedType.GENERAL),
        daily_rate=kw.pop("daily_rate", Decimal("1400.00")),
        **kw,
    )
    db.add(bed)
    db.flush()
    return bed


def make_admission(db: Session, patient: Patient, bed: Bed, **kw) -> Admission:
    admission = Admission(
        patient_id=patient.id,
        bed_id=bed.id,
        admission_date=kw.pop("admission_date", date(2026, 8, 1)),
        status=kw.pop("status", AdmissionStatus.ADMITTED),
        **kw,
    )
    db.add(admission)
    db.flush()
    return admission


def make_medicine(db: Session, **kw) -> Medicine:
    token = _suffix()
    medicine = Medicine(
        medicine_number=kw.pop("medicine_number", f"MED-{token[:6]}"),
        name=kw.pop("name", f"Medicine {token}"),
        reorder_level=kw.pop("reorder_level", 10),
        **kw,
    )
    db.add(medicine)
    db.flush()
    return medicine


def make_batch(db: Session, medicine: Medicine | None = None, **kw) -> MedicineBatch:
    medicine = medicine or make_medicine(db)
    batch = MedicineBatch(
        medicine_id=medicine.id,
        batch_number=kw.pop("batch_number", f"B{_suffix()[:8]}"),
        quantity=kw.pop("quantity", 100),
        expiry_date=kw.pop("expiry_date", date(2027, 12, 31)),
        **kw,
    )
    db.add(batch)
    db.flush()
    return batch


def make_prescription(db: Session, patient: Patient | None = None, **kw) -> Prescription:
    patient = patient or make_patient(db)
    prescription = Prescription(
        prescription_number=kw.pop("prescription_number", f"RX-{_suffix()[:6]}"),
        patient_id=patient.id,
        **kw,
    )
    db.add(prescription)
    db.flush()
    return prescription


def make_prescription_item(
    db: Session, prescription: Prescription, quantity: int = 10, **kw
) -> PrescriptionItem:
    item = PrescriptionItem(prescription_id=prescription.id, quantity=quantity, **kw)
    db.add(item)
    db.flush()
    return item


def make_permission(db: Session, **kw) -> Permission:
    token = _suffix()
    permission = Permission(
        key=kw.pop("key", f"test.permission.{token}"),
        name=kw.pop("name", "Test permission"),
        group=kw.pop("group", PermissionGroup.SYSTEM),
        **kw,
    )
    db.add(permission)
    db.flush()
    return permission


def make_appointment(
    db: Session,
    patient: Patient,
    doctor: User,
    *,
    on: date = date(2026, 8, 24),
    start: time = time(9, 0),
    end: time = time(9, 30),
    **kw,
) -> Appointment:
    appointment = Appointment(
        appointment_number=kw.pop("appointment_number", f"APT-{_suffix()[:6]}"),
        patient_id=patient.id,
        doctor_id=doctor.id,
        appointment_date=on,
        start_time=start,
        end_time=end,
        appointment_type=kw.pop("appointment_type", AppointmentType.FOLLOW_UP),
        **kw,
    )
    db.add(appointment)
    db.flush()
    return appointment


__all__ = [name for name in dir() if name.startswith("make_")]
