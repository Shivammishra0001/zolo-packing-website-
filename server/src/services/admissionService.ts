/** Admissions, the discharge checklist and discharge itself. */

import type { Bed } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type AdmissionStatus = 'Admitted' | 'Discharge Pending' | 'Discharged'

/** One line of the discharge checklist. `done` is the frontend's own name. */
export interface ChecklistItem {
  id: string
  label: string
  detail: string | null
  done: boolean
  completedBy: string | null
  completedAt: string | null
  sortOrder: number
}

/**
 * One stay.
 *
 * `checklistProgress` and `checklistComplete` are derived server-side from the
 * checklist rows, so the progress bar and the discharge button read the same
 * figures the discharge endpoint enforces.
 */
export interface AdmissionRecord {
  id: string
  patientId: string
  patientUuid: string
  patientName: string
  patientInitials: string
  patientAvatarColor: string
  age: number | null
  primaryCondition: string | null

  ward: string
  wardId: string | null
  room: string
  bed: string
  bedId: string
  bedType: Bed['type'] | null
  /** A money column, so it crosses the wire as a string. */
  dailyRate: string | null

  admissionDate: string
  expectedDischarge: string | null
  dischargeDate: string | null
  status: AdmissionStatus

  attendingDoctor: string
  admittedBy: string

  checklist: ChecklistItem[]
  checklistComplete: boolean
  checklistProgress: number

  createdAt: string | null
  updatedAt: string | null
}

export interface AdmissionPage {
  items: AdmissionRecord[]
  page: number
  limit: number
  total: number
  totalPages: number
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export interface ListParams {
  page?: number
  limit?: number
  /** Patient UUID or `PT-#####` code. */
  patient?: string
  /** Ward UUID. */
  ward?: string
  status?: AdmissionStatus
  /** Stays that still hold a bed, whatever their status. */
  active?: boolean
}

export async function listAdmissions(params: ListParams = {}): Promise<AdmissionPage> {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 50))
  if (params.patient) query.set('patient', params.patient)
  if (params.ward) query.set('ward', params.ward)
  if (params.status) query.set('status', params.status)
  if (params.active) query.set('active', 'true')

  const page = await api.get<{
    items: AdmissionRecord[]
    page: number
    limit: number
    total: number
    total_pages: number
  }>(`/api/admissions?${query}`)

  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export function getAdmission(identifier: string): Promise<AdmissionRecord> {
  return api.get<AdmissionRecord>(`/api/admissions/${encodeURIComponent(identifier)}`)
}

/* -------------------------------------------------------------------------- */
/* Admitting and amending                                                     */
/* -------------------------------------------------------------------------- */

export interface AdmissionPayload {
  /** Patient UUID or `PT-#####` code. */
  patientId: string
  /** Bed UUID, or a bed number such as `A-101`. */
  bedId: string
  /** Defaults to today on the server. */
  admissionDate?: string
  expectedDischarge?: string
  attendingDoctorId?: string
}

/** `admittedBy` is the signed-in user — the request cannot say otherwise. */
export function admit(payload: AdmissionPayload): Promise<AdmissionRecord> {
  return api.post<AdmissionRecord>('/api/admissions', payload)
}

/** Patient and bed are fixed at admission, so neither is amendable here. */
export function updateAdmission(
  identifier: string,
  payload: { expectedDischarge?: string; attendingDoctorId?: string },
): Promise<AdmissionRecord> {
  return api.patch<AdmissionRecord>(`/api/admissions/${encodeURIComponent(identifier)}`, payload)
}

/* -------------------------------------------------------------------------- */
/* Discharge                                                                  */
/* -------------------------------------------------------------------------- */

/** Moves the stay to Discharge Pending. The bed stays occupied until they go. */
export function startDischarge(identifier: string): Promise<AdmissionRecord> {
  return api.post<AdmissionRecord>(
    `/api/admissions/${encodeURIComponent(identifier)}/discharge-pending`,
  )
}

/**
 * Tick or untick one checklist line.
 *
 * The whole admission comes back, which is why the screen's progress never has
 * to be recounted locally.
 */
export function setChecklistItem(itemId: string, done: boolean): Promise<AdmissionRecord> {
  return api.patch<AdmissionRecord>(`/api/admissions/checklist/${encodeURIComponent(itemId)}`, {
    done,
  })
}

/**
 * Complete a stay and release the bed.
 *
 * The API refuses this while any checklist item is outstanding, which is the
 * same rule the screen's disabled discharge button expresses.
 */
export function discharge(
  identifier: string,
  payload: { dischargeDate?: string; bedStatus?: Exclude<Bed['status'], 'Occupied'> } = {},
): Promise<AdmissionRecord> {
  return api.post<AdmissionRecord>(
    `/api/admissions/${encodeURIComponent(identifier)}/discharge`,
    payload,
  )
}
