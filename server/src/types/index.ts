/* ------------------------------------------------------------------ *
 * Domain types — Arogya Rehabilitation Centre HMS
 * ------------------------------------------------------------------ */

export type Role =
  | 'owner'
  | 'admin'
  | 'doctor'
  | 'therapist'
  | 'nurse'
  | 'pharmacist'
  | 'receptionist'
  | 'accountant'

export type Permission =
  // patients
  | 'patient.view'
  | 'patient.create'
  | 'patient.edit'
  | 'patient.clinical.view'
  | 'patient.clinical.edit'
  // scheduling
  | 'appointment.view'
  | 'appointment.create'
  | 'appointment.checkin'
  // clinical
  | 'consultation.manage'
  | 'prescription.create'
  | 'prescription.dispense'
  | 'vitals.record'
  | 'nursing.tasks'
  // rehab
  | 'rehab.plan.view'
  | 'rehab.plan.manage'
  | 'therapy.session.manage'
  | 'therapy.progress.view'
  // pharmacy
  | 'pharmacy.inventory'
  | 'pharmacy.pos'
  // finance
  | 'billing.view'
  | 'billing.manage'
  | 'payments.manage'
  | 'expenses.manage'
  | 'finance.reports'
  // operations
  | 'beds.view'
  | 'beds.manage'
  | 'analytics.business'
  | 'analytics.operational'
  // system
  | 'staff.manage'
  | 'roles.manage'
  | 'branches.manage'
  | 'audit.view'
  | 'settings.manage'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  designation: string
  department: string
  avatarColor: string
  initials: string
  branch: string
  phone: string
  lastLogin: string
  status: 'active' | 'suspended' | 'pending'
}

/* --------------------------------- Patients -------------------------------- */

export type Gender = 'Male' | 'Female' | 'Other'

export type PatientStatus =
  | 'Active - OPD'
  | 'Admitted - IPD'
  | 'In Rehabilitation'
  | 'Discharge Pending'
  | 'Discharged'
  | 'Follow-up'

export type RehabTrend = 'On Track' | 'Ahead of Plan' | 'Plateaued' | 'At Risk' | 'Completed'

export interface Vitals {
  recordedAt: string
  recordedBy: string
  /**
   * Every reading is optional. The API requires only that ONE of them be
   * present on a recorded observation, and the consultation screen has no
   * respiratory-rate input at all — so a row written by a doctor always has at
   * least one null. Anything rendering these has to handle it.
   */
  systolic: number | null
  diastolic: number | null
  heartRate: number | null
  temperature: number | null
  spo2: number | null
  respiratoryRate: number | null
}

export interface MedicalHistoryEntry {
  id: string
  date: string
  type: 'Diagnosis' | 'Surgery' | 'Injury' | 'Allergy' | 'Chronic Condition' | 'Lab Result'
  title: string
  detail: string
  clinician: string
}

export interface ProgressPoint {
  week: string
  pain: number
  mobility: number
  strength: number
  adherence: number
}

export interface RehabPlan {
  id: string
  title: string
  goal: string
  startDate: string
  targetEndDate: string
  totalSessions: number
  completedSessions: number
  frequencyPerWeek: number
  primaryTherapist: string
  modalities: string[]
  trend: RehabTrend
  attendanceRate: number
  adherenceRate: number
  milestones: { label: string; done: boolean; date: string }[]
}

export type TherapyType =
  | 'Physiotherapy'
  | 'Occupational Therapy'
  | 'Speech Therapy'
  | 'Neuro Rehabilitation'
  | 'Physical Rehabilitation'
  | 'Hydrotherapy'
  | 'Cardiac Rehabilitation'

export interface TherapySession {
  id: string
  patientId: string
  patientName: string
  date: string
  time: string
  durationMinutes: number
  type: TherapyType
  therapist: string
  therapistId: string
  status: 'Scheduled' | 'In Progress' | 'Completed' | 'Missed'
  exercises: string[]
  painBefore?: number
  painAfter?: number
  mobilityScore?: number
  strengthScore?: number
  notes?: string
  room: string
}

export interface PrescriptionItem {
  /** Database id — what the pharmacy dispenses against. */
  id?: string
  medicine: string
  strength: string
  dosage: string
  frequency: string
  duration: string
  quantity: number
  /** Issued so far; `quantity - quantityDispensed` is what remains. */
  quantityDispensed?: number
  instructions: string
}

export interface Prescription {
  id: string
  patientId: string
  patientName: string
  doctor: string
  date: string
  items: PrescriptionItem[]
  status: 'Pending' | 'Partially Dispensed' | 'Dispensed' | 'Cancelled'
  priority: 'Routine' | 'Urgent'
}

export type PaymentMethod = 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Insurance'

export interface Invoice {
  id: string
  patientId: string
  patientName: string
  date: string
  dueDate: string
  amount: number
  paid: number
  status: 'Paid' | 'Partially Paid' | 'Unpaid' | 'Overdue'
  department: 'OPD' | 'IPD' | 'Pharmacy' | 'Therapy' | 'Diagnostics'
  items: { label: string; qty: number; rate: number }[]
  method?: PaymentMethod
}

export interface DocumentRecord {
  id: string
  name: string
  type: 'Report' | 'Scan' | 'Consent' | 'Insurance' | 'Discharge Summary'
  size: string
  uploadedOn: string
  uploadedBy: string
}

export interface Patient {
  id: string
  name: string
  age: number
  gender: 'Male' | 'Female' | 'Other'
  phone: string
  email: string
  address: string
  bloodGroup: string
  avatarColor: string
  initials: string
  status: PatientStatus
  registeredOn: string
  primaryCondition: string
  assignedDoctor: string
  assignedTherapist: string
  department: string
  ward?: string
  room?: string
  bed?: string
  admittedOn?: string
  expectedDischarge?: string
  emergencyContact: { name: string; relation: string; phone: string }
  insurance?: { provider: string; policyNo: string; validTill: string }
  allergies: string[]
  vitals: Vitals[]
  history: MedicalHistoryEntry[]
  rehabPlan?: RehabPlan
  progress: ProgressPoint[]
  documents: DocumentRecord[]
  lastVisit: string
  nextAppointment?: string
  outstandingAmount: number
}

/* ------------------------------- Appointments ------------------------------ */

export type AppointmentStatus =
  | 'Scheduled'
  | 'Waiting'
  | 'In Consultation'
  | 'Completed'
  | 'Follow-up'
  | 'Cancelled'
  | 'No Show'

export type AppointmentType =
  | 'New Consultation'
  | 'Follow-up'
  | 'Therapy Review'
  | 'Post-op Review'
  | 'Assessment'
  | 'Walk-in'

export interface Appointment {
  /** Human-readable code, e.g. `APT-2026-00152`. Used as a list key, not shown. */
  id: string
  /** Database id — what the API's action endpoints take. */
  uuid?: string
  patientId: string
  patientUuid?: string
  patientName: string
  patientAge: number
  patientGender: Gender
  /** Avatar details, so a row can render without a second patient lookup. */
  patientInitials?: string
  patientAvatarColor?: string
  time: string
  /** Slot end, `HH:MM`. */
  endTime?: string
  date: string
  doctor: string
  doctorId: string
  therapist?: string
  therapistId?: string
  type: AppointmentType
  department: string
  status: AppointmentStatus
  /** `HH:MM` the patient arrived. Waiting time is derived from this, never stored. */
  checkedInAt?: string
  tokenNumber: number
  notes?: string
  room?: string
}

/* --------------------------------- Pharmacy -------------------------------- */

export type StockStatus = 'In Stock' | 'Low Stock' | 'Near Expiry' | 'Out of Stock'

export interface Medicine {
  id: string
  name: string
  genericName: string
  category: string
  batch: string
  quantity: number
  threshold: number
  unitPrice: number
  mrp: number
  expiry: string
  manufacturer: string
  rackLocation: string
  status: StockStatus
}

/* --------------------------------- Finance --------------------------------- */

export interface Expense {
  id: string
  date: string
  vendor: string
  category:
    | 'Salaries'
    | 'Pharmacy Purchase'
    | 'Equipment'
    | 'Utilities'
    | 'Maintenance'
    | 'Marketing'
    | 'Uncategorised'
  amount: number
  method: PaymentMethod
  status: 'Recorded' | 'Pending Categorisation' | 'Approved'
  reference: string
}

export interface PaymentRecord {
  id: string
  invoiceId: string
  patientName: string
  amount: number
  method: PaymentMethod
  date: string
  collectedBy: string
  status: 'Settled' | 'Processing' | 'Failed'
}

/* -------------------------------- Operations ------------------------------- */

export interface Bed {
  id: string
  ward: string
  room: string
  bed: string
  type: 'General' | 'Semi-Private' | 'Private' | 'ICU' | 'Rehab Suite'
  status: 'Available' | 'Occupied' | 'Reserved' | 'Cleaning'
  patientId?: string
  patientName?: string
  since?: string
  dailyRate: number
}

export interface NursingTask {
  id: string
  patientId: string
  patientName: string
  ward: string
  bed: string
  type: 'Vitals' | 'Medication' | 'Doctor Instruction' | 'Care Task' | 'Therapy Prep'
  label: string
  due: string
  priority: 'Routine' | 'High' | 'Critical'
  done: boolean
}

/* ------------------------------ Notifications ------------------------------ */

export interface Notification {
  id: string
  role: Role | 'all'
  title: string
  body: string
  time: string
  icon: 'clinical' | 'stock' | 'finance' | 'therapy' | 'system' | 'patient'
  severity: 'info' | 'warning' | 'critical' | 'success'
  read: boolean
  href: string
}

/* --------------------------------- Activity -------------------------------- */

export interface ActivityEvent {
  id: string
  actor: string
  action: string
  target: string
  time: string
  category: 'auth' | 'staff' | 'patient' | 'pharmacy' | 'billing' | 'system'
}

export interface NavItem {
  label: string
  to: string
  icon: string
  badge?: number | string
  permission?: Permission
}

export interface NavSection {
  title?: string
  items: NavItem[]
}
