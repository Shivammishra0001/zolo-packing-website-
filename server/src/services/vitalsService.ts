/** Vitals and medical history — the patient's clinical record. */

import type { MedicalHistoryEntry, Vitals } from '@/types'
import { api } from '@/services/api'

/** The API's vitals row: the frontend `Vitals` shape plus an addressable id. */
export interface VitalsRecord extends Vitals {
  id: string
}

export interface VitalsPayload {
  systolic?: number
  diastolic?: number
  heartRate?: number
  temperature?: number
  spo2?: number
  respiratoryRate?: number
  /** Defaults to now on the server. */
  recordedAt?: string
}

export interface HistoryPayload {
  /** Defaults to today on the server. */
  date?: string
  type: MedicalHistoryEntry['type']
  title: string
  detail?: string
}

const base = (patientId: string) => `/api/patients/${encodeURIComponent(patientId)}`

/* -------------------------------------------------------------------------- */
/* Vitals                                                                     */
/* -------------------------------------------------------------------------- */

/** Observation history, newest first. */
export function listVitals(patientId: string, limit = 50): Promise<VitalsRecord[]> {
  return api.get<VitalsRecord[]>(`${base(patientId)}/vitals?limit=${limit}`)
}

/**
 * The most recent observation, or `null` when nothing has been recorded.
 *
 * Used where a screen needs only the latest reading — the consultation sidebar
 * and the Patient 360 header — so it does not pull a full history to read one
 * row.
 */
export function latestVitals(patientId: string): Promise<VitalsRecord | null> {
  return api.get<VitalsRecord | null>(`${base(patientId)}/vitals/latest`)
}

/** The recorder is set from the signed-in user. At least one reading required. */
export function recordVitals(patientId: string, payload: VitalsPayload): Promise<VitalsRecord> {
  return api.post<VitalsRecord>(`${base(patientId)}/vitals`, payload)
}

/* -------------------------------------------------------------------------- */
/* Medical history                                                            */
/* -------------------------------------------------------------------------- */

export function listMedicalHistory(patientId: string): Promise<MedicalHistoryEntry[]> {
  return api.get<MedicalHistoryEntry[]>(`${base(patientId)}/medical-history`)
}

/** The clinician is set from the signed-in user. */
export function addHistoryEntry(
  patientId: string,
  payload: HistoryPayload,
): Promise<MedicalHistoryEntry> {
  return api.post<MedicalHistoryEntry>(`${base(patientId)}/medical-history`, payload)
}
