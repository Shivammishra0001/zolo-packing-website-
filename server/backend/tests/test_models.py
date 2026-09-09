"""Database integrity tests.

These run against a real PostgreSQL — the constraints being tested (partial
unique indexes, GiST exclusion constraints, native enums) do not exist in
SQLite, so faking the database would test nothing. They skip automatically when
no database is reachable; see backend/README.md for how to run them.

Every assertion here is about the *database* refusing bad data, not about
application code choosing not to write it.
"""

from __future__ import annotations

from datetime import date, time

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.enums import (
    ALL_DISPLAY_ENUMS,
    AdmissionStatus,
    AppointmentStatus,
    PatientStatus,
    PaymentMethod,
    UserRole,
)
from app.models import Base, MedicineBatch, PrescriptionItem, RolePermission
from tests import factories as f


class TestUniqueIdentifiers:
    def test_duplicate_patient_number(self, db: Session) -> None:
        f.make_patient(db, patient_number="PT-DUPLICATE")

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                f.make_patient(db, patient_number="PT-DUPLICATE")

        assert "patient_number" in str(exc.value).lower()

    def test_duplicate_user_email(self, db: Session) -> None:
        f.make_user(db, email="taken@rehab.test")

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                f.make_user(db, email="taken@rehab.test")

        assert "email" in str(exc.value).lower()

    def test_duplicate_invoice_number_rejected(self, db: Session) -> None:
        from app.core.enums import InvoiceDepartment
        from app.models import Invoice

        patient = f.make_patient(db)

        def build() -> Invoice:
            return Invoice(
                invoice_number="INV-2026-DUPE",
                patient_id=patient.id,
                department=InvoiceDepartment.OPD,
                issued_on=date(2026, 8, 24),
            )

        db.add(build())
        db.flush()

        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(build())
                db.flush()


class TestPharmacyStock:
    def test_negative_medicine_stock(self, db: Session) -> None:
        """A dispensing bug must not be able to drive stock below zero."""
        batch = f.make_batch(db, quantity=5)

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                batch.quantity = -1
                db.flush()

        assert "quantity_non_negative" in str(exc.value)

    def test_zero_stock_is_allowed(self, db: Session) -> None:
        batch = f.make_batch(db, quantity=1)
        batch.quantity = 0
        db.flush()
        assert batch.quantity == 0

    def test_duplicate_batch_number_for_same_medicine(self, db: Session) -> None:
        medicine = f.make_medicine(db)
        f.make_batch(db, medicine, batch_number="LOT-1")

        with pytest.raises(IntegrityError):
            with db.begin_nested():
                f.make_batch(db, medicine, batch_number="LOT-1")

    def test_same_batch_number_across_medicines_is_fine(self, db: Session) -> None:
        f.make_batch(db, f.make_medicine(db), batch_number="LOT-SHARED")
        f.make_batch(db, f.make_medicine(db), batch_number="LOT-SHARED")


class TestPrescriptionDispensing:
    def test_invalid_dispensed_quantity(self, db: Session) -> None:
        """Dispensed can never exceed prescribed."""
        prescription = f.make_prescription(db)
        item = f.make_prescription_item(db, prescription, quantity=10)

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                item.quantity_dispensed = 11
                db.flush()

        assert "dispensed_within_prescribed" in str(exc.value)

    def test_dispensing_exactly_the_prescribed_amount(self, db: Session) -> None:
        prescription = f.make_prescription(db)
        item = f.make_prescription_item(db, prescription, quantity=10)
        item.quantity_dispensed = 10
        db.flush()
        assert item.quantity_dispensed == 10

    def test_negative_dispensed_quantity(self, db: Session) -> None:
        prescription = f.make_prescription(db)
        item = f.make_prescription_item(db, prescription, quantity=10)

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                item.quantity_dispensed = -1
                db.flush()

        assert "dispensed_non_negative" in str(exc.value)


class TestRolePermissionMatrix:
    def test_duplicate_role_permission(self, db: Session) -> None:
        permission = f.make_permission(db)
        db.add(RolePermission(role=UserRole.DOCTOR, permission_id=permission.id))
        db.flush()

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                db.add(RolePermission(role=UserRole.DOCTOR, permission_id=permission.id))
                db.flush()

        assert "role_permissions" in str(exc.value).lower()

    def test_same_permission_for_different_roles_is_fine(self, db: Session) -> None:
        permission = f.make_permission(db)
        db.add(RolePermission(role=UserRole.DOCTOR, permission_id=permission.id))
        db.add(RolePermission(role=UserRole.THERAPIST, permission_id=permission.id))
        db.flush()

    def test_duplicate_permission_key(self, db: Session) -> None:
        f.make_permission(db, key="patient.view.test")

        with pytest.raises(IntegrityError):
            with db.begin_nested():
                f.make_permission(db, key="patient.view.test")


class TestBedOccupancy:
    def test_active_bed_admission_constraint(self, db: Session) -> None:
        """One bed cannot hold two active admissions."""
        bed = f.make_bed(db)
        f.make_admission(db, f.make_patient(db), bed)

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                f.make_admission(db, f.make_patient(db), bed)

        assert "uq_admissions_active_bed" in str(exc.value)

    def test_bed_can_be_reused_after_discharge(self, db: Session) -> None:
        """The partial index only covers ADMITTED, so a freed bed is reusable."""
        bed = f.make_bed(db)
        first = f.make_admission(db, f.make_patient(db), bed)

        first.status = AdmissionStatus.DISCHARGED
        first.discharge_date = date(2026, 8, 20)
        db.flush()

        second = f.make_admission(db, f.make_patient(db), bed)
        assert second.status is AdmissionStatus.ADMITTED

    def test_patient_cannot_occupy_two_beds(self, db: Session) -> None:
        patient = f.make_patient(db)
        ward = f.make_ward(db)
        f.make_admission(db, patient, f.make_bed(db, ward))

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                f.make_admission(db, patient, f.make_bed(db, ward))

        assert "uq_admissions_active_patient" in str(exc.value)


class TestAppointmentConflicts:
    def test_overlapping_appointments_for_same_doctor_rejected(self, db: Session) -> None:
        doctor = f.make_user(db, UserRole.DOCTOR)
        f.make_appointment(
            db, f.make_patient(db), doctor, on=date(2026, 9, 1), start=time(9, 0), end=time(9, 30)
        )

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                f.make_appointment(
                    db,
                    f.make_patient(db),
                    doctor,
                    on=date(2026, 9, 1),
                    start=time(9, 15),
                    end=time(9, 45),
                )

        assert "ex_appointments_doctor_no_overlap" in str(exc.value)

    def test_adjacent_appointments_are_allowed(self, db: Session) -> None:
        """09:00-09:30 then 09:30-10:00 do not overlap — tsrange is half-open."""
        doctor = f.make_user(db, UserRole.DOCTOR)
        f.make_appointment(
            db, f.make_patient(db), doctor, on=date(2026, 9, 2), start=time(9, 0), end=time(9, 30)
        )
        f.make_appointment(
            db, f.make_patient(db), doctor, on=date(2026, 9, 2), start=time(9, 30), end=time(10, 0)
        )

    def test_same_slot_different_doctors_allowed(self, db: Session) -> None:
        slot = dict(on=date(2026, 9, 3), start=time(11, 0), end=time(11, 30))
        f.make_appointment(db, f.make_patient(db), f.make_user(db, UserRole.DOCTOR), **slot)
        f.make_appointment(db, f.make_patient(db), f.make_user(db, UserRole.DOCTOR), **slot)

    def test_cancelled_appointment_frees_the_slot(self, db: Session) -> None:
        """The exclusion constraint ignores CANCELLED and NO_SHOW."""
        doctor = f.make_user(db, UserRole.DOCTOR)
        slot = dict(on=date(2026, 9, 4), start=time(14, 0), end=time(14, 30))

        first = f.make_appointment(db, f.make_patient(db), doctor, **slot)
        first.status = AppointmentStatus.CANCELLED
        db.flush()

        f.make_appointment(db, f.make_patient(db), doctor, **slot)

    def test_overlapping_appointments_for_same_therapist_rejected(self, db: Session) -> None:
        therapist = f.make_user(db, UserRole.THERAPIST)
        patient = f.make_patient(db)

        f.make_appointment(
            db,
            patient,
            f.make_user(db, UserRole.DOCTOR),
            on=date(2026, 9, 5),
            start=time(10, 0),
            end=time(10, 45),
            therapist_id=therapist.id,
        )

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                f.make_appointment(
                    db,
                    f.make_patient(db),
                    f.make_user(db, UserRole.DOCTOR),
                    on=date(2026, 9, 5),
                    start=time(10, 30),
                    end=time(11, 0),
                    therapist_id=therapist.id,
                )

        assert "ex_appointments_therapist_no_overlap" in str(exc.value)

    def test_appointment_requires_a_clinician(self, db: Session) -> None:
        from app.core.enums import AppointmentType
        from app.models import Appointment

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                db.add(
                    Appointment(
                        appointment_number="APT-NOCLIN",
                        patient_id=f.make_patient(db).id,
                        appointment_date=date(2026, 9, 6),
                        start_time=time(9, 0),
                        end_time=time(9, 30),
                        appointment_type=AppointmentType.FOLLOW_UP,
                    )
                )
                db.flush()

        assert "clinician_required" in str(exc.value)

    def test_end_time_must_follow_start_time(self, db: Session) -> None:
        doctor = f.make_user(db, UserRole.DOCTOR)

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                f.make_appointment(
                    db,
                    f.make_patient(db),
                    doctor,
                    on=date(2026, 9, 7),
                    start=time(10, 0),
                    end=time(9, 0),
                )

        assert "end_after_start" in str(exc.value)


class TestRehabIntegrity:
    def test_completed_sessions_cannot_exceed_total(self, db: Session) -> None:
        from app.models import RehabPlan

        plan = RehabPlan(
            patient_id=f.make_patient(db).id,
            name="ACL Rehabilitation",
            total_sessions=24,
            completed_sessions=18,
        )
        db.add(plan)
        db.flush()

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                plan.completed_sessions = 25
                db.flush()

        assert "completed_within_total" in str(exc.value)

    def test_progress_percentage_is_computed(self, db: Session) -> None:
        from app.models import RehabPlan

        plan = RehabPlan(
            patient_id=f.make_patient(db).id,
            name="ACL Rehabilitation",
            total_sessions=24,
            completed_sessions=18,
        )
        db.add(plan)
        db.flush()
        assert plan.progress_percentage == 75

    def test_pain_score_out_of_range_rejected(self, db: Session) -> None:
        from app.models import RehabPlan, RehabProgressPoint

        patient = f.make_patient(db)
        plan = RehabPlan(patient_id=patient.id, name="Plan", total_sessions=10)
        db.add(plan)
        db.flush()

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                db.add(
                    RehabProgressPoint(
                        patient_id=patient.id,
                        rehab_plan_id=plan.id,
                        week_start=date(2026, 8, 17),
                        pain=11,
                    )
                )
                db.flush()

        assert "pain_range" in str(exc.value)


class TestReferentialIntegrity:
    def test_patient_delete_is_blocked_by_clinical_history(self, db: Session) -> None:
        """Clinical history must not be silently erasable."""
        patient = f.make_patient(db)
        f.make_prescription(db, patient)

        with pytest.raises(IntegrityError) as exc:
            with db.begin_nested():
                db.delete(patient)
                db.flush()

        assert "violates foreign key constraint" in str(exc.value).lower()

    def test_owned_children_cascade(self, db: Session) -> None:
        """Prescription items belong to their prescription and go with it."""
        prescription = f.make_prescription(db)
        f.make_prescription_item(db, prescription, quantity=5)
        prescription_id = prescription.id

        db.delete(prescription)
        db.flush()

        remaining = (
            db.query(PrescriptionItem).filter(PrescriptionItem.prescription_id == prescription_id).count()
        )
        assert remaining == 0


class TestSchemaShape:
    def test_expected_tables_exist(self, db: Session) -> None:
        actual = set(inspect(db.get_bind()).get_table_names())
        expected = set(Base.metadata.tables)
        assert expected <= actual, f"missing tables: {sorted(expected - actual)}"

    def test_money_columns_are_numeric_not_float(self, db: Session) -> None:
        """Currency must never be stored as floating point."""
        rows = db.execute(
            text(
                """
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND column_name IN (
                      'amount','total','subtotal','discount','tax','rate','fee',
                      'daily_rate','purchase_price','selling_price','mrp','monthly_revenue'
                  )
                """
            )
        ).all()

        assert rows, "expected money columns to exist"
        offenders = [r for r in rows if r.data_type != "numeric"]
        assert not offenders, f"non-numeric money columns: {offenders}"

    def test_timestamps_are_timezone_aware(self, db: Session) -> None:
        rows = db.execute(
            text(
                """
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND column_name IN ('created_at','updated_at','recorded_at','paid_at','dispensed_at')
                """
            )
        ).all()

        offenders = [r for r in rows if r.data_type != "timestamp with time zone"]
        assert not offenders, f"naive timestamp columns: {offenders}"

    def test_exclusion_constraints_exist(self, db: Session) -> None:
        names = {
            row[0]
            for row in db.execute(text("SELECT conname FROM pg_constraint WHERE contype = 'x'")).all()
        }
        assert "ex_appointments_doctor_no_overlap" in names
        assert "ex_appointments_therapist_no_overlap" in names

    def test_partial_unique_indexes_exist(self, db: Session) -> None:
        names = {
            row[0]
            for row in db.execute(
                text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
            ).all()
        }
        assert "uq_admissions_active_bed" in names
        assert "uq_admissions_active_patient" in names

    def test_required_extensions_installed(self, db: Session) -> None:
        names = {row[0] for row in db.execute(text("SELECT extname FROM pg_extension")).all()}
        assert "btree_gist" in names, "btree_gist is required by the appointment guards"


class TestEnumContract:
    """The API maps stored values to the labels the existing frontend expects."""

    def test_roles_are_lowercase(self) -> None:
        assert [r.value for r in UserRole] == [
            "owner",
            "admin",
            "doctor",
            "therapist",
            "nurse",
            "pharmacist",
            "receptionist",
            "accountant",
        ]

    def test_frontend_display_labels_are_preserved(self) -> None:
        assert AppointmentStatus.CHECKED_IN.display == "Waiting"
        assert AppointmentStatus.IN_PROGRESS.display == "In Consultation"
        assert AppointmentStatus.NO_SHOW.display == "No Show"
        assert PatientStatus.ACTIVE_OPD.display == "Active - OPD"
        assert PatientStatus.ADMITTED_IPD.display == "Admitted - IPD"
        assert PatientStatus.FOLLOW_UP.display == "Follow-up"
        assert PaymentMethod.BANK_TRANSFER.display == "Bank Transfer"

    def test_display_round_trips(self) -> None:
        for enum_cls in ALL_DISPLAY_ENUMS:
            for member in enum_cls:
                assert enum_cls.from_display(member.display) is member

    def test_display_labels_are_unique_within_a_vocabulary(self) -> None:
        for enum_cls in ALL_DISPLAY_ENUMS:
            labels = [m.display for m in enum_cls]
            assert len(labels) == len(set(labels)), f"duplicate labels in {enum_cls.__name__}"
