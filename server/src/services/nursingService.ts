/** The ward round: the nurse dashboard, inpatients, tasks and vitals. */

import type { NursingTask } from '@/types'
import { api } from '@/services/api'
import type { AdmissionRecord } from '@/services/admissionService'
import type { VitalsPayload, VitalsRecord } from '@/services/vitalsService'
import type { BedSummary, WardRecord } from '@/services/wardService'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The API's task row: the frontend `NursingTask` shape plus who it belongs to
 * and whether it has run late.
 */
export interface NursingTaskRecord extends NursingTask {
  patientUuid: string
  assignedTo: string | null
  completedBy: string | null
  completedAt: string | null
  overdue: boolean
}

/** Every figure the nurse dashboard shows, counted in PostgreSQL. */
export interface NursingDashboard {
  admittedPatients: number
  dischargePending: number

  pendingTasks: number
  overdueTasks: number
  completedTasksToday: number
  vitalsPending: number
  medicationsDue: number

  vitalsRecordedToday: number

  beds: BedSummary
  wards: WardRecord[]
}

export function getDashboard(): Promise<NursingDashboard> {
  return api.get<NursingDashboard>('/api/nursing/dashboard')
}

/** Every open stay, ordered by ward and bed — the ward round's own list. */
export function ipdPatients(): Promise<AdmissionRecord[]> {
  return api.get<AdmissionRecord[]>('/api/nursing/ipd-patients')
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

export interface TaskListParams {
  /** Patient UUID or `PT-#####` code. */
  patient?: string
  /** Ward UUID. */
  ward?: string
  /** Bed UUID or bed number. */
  bed?: string
  done?: boolean
  priority?: NursingTask['priority']
  type?: NursingTask['type']
  /** Narrows to the caller's own work; unassigned tasks stay in the list. */
  mine?: boolean
}

export function listTasks(params: TaskListParams = {}): Promise<NursingTaskRecord[]> {
  const query = new URLSearchParams()
  if (params.patient) query.set('patient', params.patient)
  if (params.ward) query.set('ward', params.ward)
  if (params.bed) query.set('bed', params.bed)
  if (params.done !== undefined) query.set('done', String(params.done))
  if (params.priority) query.set('priority', params.priority)
  if (params.type) query.set('type', params.type)
  if (params.mine) query.set('mine', 'true')

  const suffix = query.toString()
  return api.get<NursingTaskRecord[]>(`/api/nursing/tasks${suffix ? `?${suffix}` : ''}`)
}

/** Who signed the work off is the signed-in user, not anything sent from here. */
export function completeTask(identifier: string): Promise<NursingTaskRecord> {
  return api.post<NursingTaskRecord>(
    `/api/nursing/tasks/${encodeURIComponent(identifier)}/complete`,
  )
}

/** Undoes a tick made by mistake, and clears who completed it. */
export function reopenTask(identifier: string): Promise<NursingTaskRecord> {
  return api.post<NursingTaskRecord>(`/api/nursing/tasks/${encodeURIComponent(identifier)}/reopen`)
}

export interface TaskPayload {
  label?: string
  priority?: NursingTask['priority']
  dueLabel?: string
  dueAt?: string
  /** Only useful for reopening; completing has its own endpoint. */
  done?: boolean
}

export function updateTask(
  identifier: string,
  payload: TaskPayload,
): Promise<NursingTaskRecord> {
  return api.patch<NursingTaskRecord>(`/api/nursing/tasks/${encodeURIComponent(identifier)}`, payload)
}

/* -------------------------------------------------------------------------- */
/* Vitals                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Record an observation on the ward round.
 *
 * Posted against the **admission** rather than a bare patient id: the stay has
 * to exist and still be open, so the ward round cannot write vitals for a
 * patient who is not in a bed. The reading lands in the one vitals table, which
 * is why the history comes back from `listVitals` unchanged.
 */
export function recordAdmissionVitals(
  admissionId: string,
  payload: VitalsPayload,
): Promise<VitalsRecord> {
  return api.post<VitalsRecord>(
    `/api/nursing/admissions/${encodeURIComponent(admissionId)}/vitals`,
    payload,
  )
}
