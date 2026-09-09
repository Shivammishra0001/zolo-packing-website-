/** Patient endpoints. */

import type {
  Appointment,
  ProgressPoint,
  RehabPlan,
  DocumentRecord,
  Gender,
  MedicalHistoryEntry,
  Patient,
  PatientStatus,
  Vitals,
} from '@/types'
import { api } from '@/services/api'
import { toAppointment, type ApiAppointment } from '@/services/appointmentService'
import type { Consultation } from '@/services/consultationService'
import type { LabResult } from '@/services/labService'
import type { PrescriptionRecord } from '@/services/prescriptionService'
import type { Milestone, RehabPlanRecord } from '@/services/rehabService'
import type { TherapySessionRecord } from '@/services/therapyService'

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

/** The patient object as the API returns it. */
interface ApiPatient {
  id: string
  uuid: string
  name: string
  age: number | null
  gender: Gender
  phone: string | null
  email: string | null
  address: string | null
  bloodGroup: string | null
  avatarColor: string
  initials: string
  status: PatientStatus
  registeredOn: string
  primaryCondition: string | null
  assignedDoctor: string
  assignedTherapist: string
  department: string
  branch: string | null
  ward: string | null
  room: string | null
  bed: string | null
  admittedOn: string | null
  expectedDischarge: string | null
  emergencyContact: { name: string; relation: string; phone: string } | null
  insurance: { provider: string; policyNo: string; validTill: string | null } | null
  allergies: string[]
  lastVisit: string
  nextAppointment: string | null
  outstandingAmount: string
  createdAt: string | null
  updatedAt: string | null
}

export interface PatientPage {
  items: Patient[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PatientSearchResult {
  id: string
  uuid: string
  patientNumber: string
  name: string
  age: number | null
  gender: Gender
  phone: string | null
  status: PatientStatus
  department: string
  primaryCondition: string | null
  avatarColor: string
  initials: string
}

/** Patient 360, with the sections the caller may not see named explicitly. */
export interface Patient360 {
  patient: Patient
  vitals: Vitals[]
  medicalHistory: MedicalHistoryEntry[]
  documents: DocumentRecord[]
  /** Sections withheld because the signed-in user lacks `patient.clinical.view`. */
  restrictedSections: string[]
  /** Sections whose backend module is not built yet. */
  pendingModules: string[]

  // Real rows, from the modules built so far.
  appointments: Appointment[]
  consultations: Consultation[]
  prescriptions: PrescriptionRecord[]
  labs: LabResult[]

  // Rehabilitation. `rehabPlan` is the active plan the record shows;
  // `rehabPlans` is the full history behind it.
  rehabPlan: RehabPlanRecord | null
  rehabPlans: RehabPlanRecord[]
  therapySessions: TherapySessionRecord[]
  progress: ProgressPoint[]
  milestones: Milestone[]

  // Modules that land in later steps. The API returns these empty rather than
  // fabricating rows, so the UI shows an honest empty state.
  invoices: unknown[]
  admissions: unknown[]
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Map the API record onto the frontend's existing `Patient` type so every
 * screen keeps working untouched.
 *
 * Fields belonging to modules that are not built yet (rehab plan, progress,
 * appointments, billing) come back empty rather than invented — the UI already
 * has empty states for them.
 */
function toPatient(row: ApiPatient): Patient {
  return {
    id: row.id,
    name: row.name,
    age: row.age ?? 0,
    gender: row.gender,
    phone: row.phone ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    bloodGroup: row.bloodGroup ?? '',
    avatarColor: row.avatarColor,
    initials: row.initials,
    status: row.status,
    registeredOn: row.registeredOn,
    primaryCondition: row.primaryCondition ?? '',
    assignedDoctor: row.assignedDoctor,
    assignedTherapist: row.assignedTherapist,
    department: row.department,
    ward: row.ward ?? undefined,
    room: row.room ?? undefined,
    bed: row.bed ?? undefined,
    admittedOn: row.admittedOn ?? undefined,
    expectedDischarge: row.expectedDischarge ?? undefined,
    emergencyContact: row.emergencyContact ?? { name: '', relation: '', phone: '' },
    insurance: row.insurance
      ? {
          provider: row.insurance.provider,
          policyNo: row.insurance.policyNo,
          validTill: row.insurance.validTill ?? '',
        }
      : undefined,
    allergies: row.allergies ?? [],
    vitals: [],
    history: [],
    rehabPlan: undefined,
    progress: [],
    documents: [],
    lastVisit: row.lastVisit,
    nextAppointment: row.nextAppointment ?? undefined,
    outstandingAmount: Number(row.outstandingAmount ?? 0),
  }
}

/**
 * Map the API's plan onto the frontend's existing `RehabPlan` type, so the
 * Patient 360 rehab tab keeps working untouched.
 *
 * The API's nullable rates become `0` here only because the frontend type
 * declares them as numbers; the tab renders "—" for a plan with no sessions
 * behind it either way.
 */
function toRehabPlan(row: RehabPlanRecord): RehabPlan {
  return {
    id: row.id,
    title: row.title,
    goal: row.goal ?? '',
    startDate: row.startDate ?? '',
    targetEndDate: row.targetEndDate ?? '',
    totalSessions: row.totalSessions,
    completedSessions: row.completedSessions,
    frequencyPerWeek: row.frequencyPerWeek ?? 0,
    primaryTherapist: row.primaryTherapist,
    modalities: row.modalities,
    trend: row.trend,
    attendanceRate: row.attendanceRate ?? 0,
    adherenceRate: row.adherenceRate ?? 0,
    milestones: row.milestones.map((m) => ({
      label: m.label,
      done: m.done,
      date: m.date ?? '',
    })),
  }
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export interface ListParams {
  page?: number
  limit?: number
  search?: string
  status?: PatientStatus | 'All'
  scope?: 'all' | 'mine'
  sort?: 'name' | 'registered' | 'status' | 'recent'
}

export async function listPatients(params: ListParams = {}): Promise<PatientPage> {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 100))
  if (params.search?.trim()) query.set('search', params.search.trim())
  if (params.status && params.status !== 'All') query.set('status', params.status)
  if (params.scope && params.scope !== 'all') query.set('scope', params.scope)
  if (params.sort) query.set('sort', params.sort)

  const page = await api.get<{
    items: ApiPatient[]
    page: number
    limit: number
    total: number
    total_pages: number
  }>(`/api/patients?${query}`)

  return {
    items: page.items.map(toPatient),
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export function searchPatients(q: string, limit = 6): Promise<PatientSearchResult[]> {
  return api.get<PatientSearchResult[]>(
    `/api/patients/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  )
}

export async function getPatient(identifier: string): Promise<Patient> {
  return toPatient(await api.get<ApiPatient>(`/api/patients/${encodeURIComponent(identifier)}`))
}

export async function getPatient360(identifier: string): Promise<Patient360> {
  const payload = await api.get<{
    patient: ApiPatient
    vitals: Vitals[]
    medicalHistory: MedicalHistoryEntry[]
    documents: DocumentRecord[]
    restrictedSections: string[]
    pendingModules: string[]
    appointments: ApiAppointment[]
    consultations: Consultation[]
    prescriptions: PrescriptionRecord[]
    labs: LabResult[]
    rehabPlan: RehabPlanRecord | null
    rehabPlans: RehabPlanRecord[]
    therapySessions: TherapySessionRecord[]
    progress: ProgressPoint[]
    milestones: Milestone[]
    invoices: unknown[]
    admissions: unknown[]
  }>(`/api/patients/${encodeURIComponent(identifier)}/360`)

  const patient = toPatient(payload.patient)
  // Fold the clinical arrays back onto the patient object, which is the shape
  // the existing Patient 360 components already read from.
  patient.vitals = payload.vitals ?? []
  patient.history = payload.medicalHistory ?? []
  patient.documents = payload.documents ?? []
  patient.progress = payload.progress ?? []
  patient.rehabPlan = payload.rehabPlan ? toRehabPlan(payload.rehabPlan) : undefined

  return {
    patient,
    vitals: payload.vitals ?? [],
    medicalHistory: payload.medicalHistory ?? [],
    documents: payload.documents ?? [],
    restrictedSections: payload.restrictedSections ?? [],
    pendingModules: payload.pendingModules ?? [],
    appointments: (payload.appointments ?? []).map(toAppointment),
    consultations: payload.consultations ?? [],
    prescriptions: payload.prescriptions ?? [],
    labs: payload.labs ?? [],
    rehabPlan: payload.rehabPlan ?? null,
    rehabPlans: payload.rehabPlans ?? [],
    therapySessions: payload.therapySessions ?? [],
    progress: payload.progress ?? [],
    milestones: payload.milestones ?? [],
    invoices: payload.invoices ?? [],
    admissions: payload.admissions ?? [],
  }
}

export interface PatientPayload {
  name: string
  dateOfBirth: string
  gender: Gender
  phone: string
  email?: string | null
  address?: string | null
  bloodGroup?: string | null
  emergencyContact?: { name: string; relation: string; phone: string } | null
  insurance?: { provider: string; policyNo: string; validTill?: string | null } | null
  allergies?: string[]
  department?: string | null
  assignedDoctor?: string | null
  assignedTherapist?: string | null
  primaryCondition?: string | null
  status?: PatientStatus
}

export async function createPatient(payload: PatientPayload): Promise<Patient> {
  return toPatient(await api.post<ApiPatient>('/api/patients', payload))
}

export async function updatePatient(
  identifier: string,
  payload: Partial<PatientPayload>,
): Promise<Patient> {
  return toPatient(
    await api.put<ApiPatient>(`/api/patients/${encodeURIComponent(identifier)}`, payload),
  )
}
