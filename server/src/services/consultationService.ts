/** Consultation endpoints — the doctor's clinical encounter record. */

import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One recorded encounter.
 *
 * The field names are the consultation form's own — `complaint`,
 * `examination`, `diagnosis`, `carePlan`, `notes`, `followUpDate` — so the
 * screen needs no reshaping.
 */
export interface Consultation {
  id: string
  patientId: string
  patientUuid: string
  patientName: string
  doctor: string
  doctorId: string
  /** The appointment this was held under, when it started from one. */
  appointmentId: string | null
  appointmentUuid: string | null
  complaint: string | null
  examination: string | null
  diagnosis: string | null
  carePlan: string | null
  notes: string | null
  followUpDate: string | null
  /** Prescriptions written during this encounter, by `RX-####` code. */
  prescriptionIds: string[]
  date: string
  createdAt: string
  updatedAt: string | null
}

export interface ConsultationPage {
  items: Consultation[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ConsultationPayload {
  /** Patient UUID or `PT-#####` code. */
  patientId: string
  /** Appointment UUID or `APT-YYYY-#####` code. */
  appointmentId?: string | null
  complaint?: string
  examination?: string
  diagnosis: string
  carePlan?: string
  notes?: string
  followUpDate?: string | null
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export interface ListParams {
  page?: number
  limit?: number
  /**
   * A doctor always sees their own encounters. Reading a colleague's notes
   * happens through `listForPatient`, which is patient-scoped.
   */
  scope?: 'auto' | 'mine'
  patient?: string
  appointment?: string
  date?: string
  dateFrom?: string
  dateTo?: string
}

export async function listConsultations(params: ListParams = {}): Promise<ConsultationPage> {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 100))
  if (params.scope) query.set('scope', params.scope)
  if (params.patient) query.set('patient', params.patient)
  if (params.appointment) query.set('appointment', params.appointment)
  if (params.date) query.set('date', params.date)
  if (params.dateFrom) query.set('date_from', params.dateFrom)
  if (params.dateTo) query.set('date_to', params.dateTo)

  const page = await api.get<{
    items: Consultation[]
    page: number
    limit: number
    total: number
    total_pages: number
  }>(`/api/consultations?${query}`)

  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

/** Every encounter for one patient, including other clinicians'. */
export function listForPatient(patientId: string): Promise<Consultation[]> {
  return api.get<Consultation[]>(
    `/api/patients/${encodeURIComponent(patientId)}/consultations`,
  )
}

export function getConsultation(id: string): Promise<Consultation> {
  return api.get<Consultation>(`/api/consultations/${encodeURIComponent(id)}`)
}

/** The author is set from the signed-in user — no doctor id is sent. */
export function createConsultation(payload: ConsultationPayload): Promise<Consultation> {
  return api.post<Consultation>('/api/consultations', payload)
}

/** Only the doctor who recorded an encounter may amend it. */
export function updateConsultation(
  id: string,
  payload: Partial<Omit<ConsultationPayload, 'patientId' | 'appointmentId'>>,
): Promise<Consultation> {
  return api.put<Consultation>(`/api/consultations/${encodeURIComponent(id)}`, payload)
}

/** Consultations whose follow-up date has arrived — one per patient. */
export function listDueFollowUps(through?: string): Promise<Consultation[]> {
  const query = through ? `?through=${encodeURIComponent(through)}` : ''
  return api.get<Consultation[]>(`/api/consultations/follow-ups${query}`)
}
