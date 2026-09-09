/**
 * Prescription endpoints — writing and reading.
 *
 * Dispensing belongs to the pharmacy module; nothing here touches stock.
 */

import type { Prescription, PrescriptionItem } from '@/types'
import { api } from '@/services/api'

/** One prescribed line as the API returns it, with what remains to dispense. */
export interface PrescriptionItemRecord extends PrescriptionItem {
  id: string
  quantityDispensed: number
}

/** The API row: the frontend `Prescription` shape plus the database id. */
export interface PrescriptionRecord extends Prescription {
  uuid: string
  items: PrescriptionItemRecord[]
  patientUuid: string
  doctorId: string
  /** The encounter it was written during, when there was one. */
  consultationId: string | null
  createdAt: string | null
}

export interface PrescriptionPage {
  items: PrescriptionRecord[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PrescriptionPayload {
  /** Patient UUID or `PT-#####` code. */
  patientId: string
  consultationId?: string | null
  priority?: Prescription['priority']
  items: PrescriptionItem[]
}

export interface ListParams {
  page?: number
  limit?: number
  /** A doctor sees what they prescribed; `all` is the branch-wide queue. */
  scope?: 'auto' | 'mine' | 'all'
  patient?: string
  status?: Prescription['status']
}

export async function listPrescriptions(params: ListParams = {}): Promise<PrescriptionPage> {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 100))
  if (params.scope) query.set('scope', params.scope)
  if (params.patient) query.set('patient', params.patient)
  if (params.status) query.set('status', params.status)

  const page = await api.get<{
    items: PrescriptionRecord[]
    page: number
    limit: number
    total: number
    total_pages: number
  }>(`/api/prescriptions?${query}`)

  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export function getPrescription(identifier: string): Promise<PrescriptionRecord> {
  return api.get<PrescriptionRecord>(`/api/prescriptions/${encodeURIComponent(identifier)}`)
}

/**
 * Write a prescription.
 *
 * The prescriber is the signed-in user and the status is always `Pending` —
 * neither is sent from here. Every medicine is checked against the catalogue
 * server-side, and the prescription plus its items land in one transaction.
 */
export function createPrescription(payload: PrescriptionPayload): Promise<PrescriptionRecord> {
  return api.post<PrescriptionRecord>('/api/prescriptions', payload)
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

/** What the consultation form's medicine dropdown needs. */
export interface MedicineOption {
  id: string
  name: string
  genericName: string | null
  category: string | null
  strength: string | null
  status: 'In Stock' | 'Low Stock' | 'Near Expiry' | 'Out of Stock'
}

/**
 * The prescribable catalogue.
 *
 * `status` is derived server-side from batches and is read-only — inventory
 * itself belongs to the pharmacy module.
 */
export function listMedicines(): Promise<MedicineOption[]> {
  return api.get<MedicineOption[]>('/api/prescriptions/medicines')
}
