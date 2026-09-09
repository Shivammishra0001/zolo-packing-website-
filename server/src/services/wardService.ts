/** Wards, the bed board and its occupancy summary. */

import type { Bed } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One ward, with its bed counts.
 *
 * Every count is derived server-side from the ward's beds, so nothing here is
 * recomputed in React.
 */
export interface WardRecord {
  id: string
  name: string
  branch: string
  branchId: string | null
  totalBeds: number
  occupied: number
  available: number
  reserved: number
  cleaning: number
  occupancyRate: number
}

/**
 * The API's bed row: the frontend `Bed` shape plus the ids the board needs to
 * address a ward, a patient record and the stay behind an occupied bed.
 */
export interface BedRecord extends Bed {
  wardId: string
  patientUuid?: string
  admissionId?: string
}

/** Occupancy across every bed the caller can see. */
export interface BedSummary {
  total: number
  occupied: number
  available: number
  reserved: number
  cleaning: number
  occupancyRate: number
}

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

interface ApiBed {
  id: string
  ward: string
  wardId: string
  room: string
  bed: string
  type: Bed['type']
  status: Bed['status']
  patientId: string | null
  patientUuid: string | null
  patientName: string | null
  since: string | null
  /** A money column, so it crosses the wire as a string. */
  dailyRate: string
  admissionId: string | null
}

/**
 * Map the API row onto the frontend's existing `Bed` type so the bed board and
 * the occupancy screens keep working untouched.
 */
function toBed(row: ApiBed): BedRecord {
  return {
    id: row.id,
    ward: row.ward,
    wardId: row.wardId,
    room: row.room,
    bed: row.bed,
    type: row.type,
    status: row.status,
    patientId: row.patientId ?? undefined,
    patientUuid: row.patientUuid ?? undefined,
    patientName: row.patientName ?? undefined,
    since: row.since ?? undefined,
    dailyRate: Number(row.dailyRate ?? 0),
    admissionId: row.admissionId ?? undefined,
  }
}

/* -------------------------------------------------------------------------- */
/* Wards                                                                      */
/* -------------------------------------------------------------------------- */

export function listWards(): Promise<WardRecord[]> {
  return api.get<WardRecord[]>('/api/wards')
}

export interface WardPayload {
  name: string
  /** Defaults to the caller's own branch on the server. */
  branchId?: string
}

export function createWard(payload: WardPayload): Promise<WardRecord> {
  return api.post<WardRecord>('/api/wards', payload)
}

export function renameWard(identifier: string, name: string): Promise<WardRecord> {
  return api.patch<WardRecord>(`/api/wards/${encodeURIComponent(identifier)}`, { name })
}

/* -------------------------------------------------------------------------- */
/* Beds                                                                       */
/* -------------------------------------------------------------------------- */

export interface BedListParams {
  /** Ward UUID. */
  ward?: string
  status?: Bed['status']
  type?: Bed['type']
}

export async function listBeds(params: BedListParams = {}): Promise<BedRecord[]> {
  const query = new URLSearchParams()
  if (params.ward) query.set('ward', params.ward)
  if (params.status) query.set('status', params.status)
  if (params.type) query.set('type', params.type)

  const suffix = query.toString()
  const rows = await api.get<ApiBed[]>(`/api/beds${suffix ? `?${suffix}` : ''}`)
  return rows.map(toBed)
}

export function bedSummary(): Promise<BedSummary> {
  return api.get<BedSummary>('/api/beds/summary')
}

export interface BedPayload {
  wardId: string
  bedNumber: string
  room?: string
  type: Bed['type']
  dailyRate: number
}

/** A new bed is Available — occupancy only ever follows an admission. */
export async function createBed(payload: BedPayload): Promise<BedRecord> {
  return toBed(await api.post<ApiBed>('/api/beds', payload))
}

export async function updateBed(
  identifier: string,
  payload: Partial<Omit<BedPayload, 'wardId'>>,
): Promise<BedRecord> {
  return toBed(await api.patch<ApiBed>(`/api/beds/${encodeURIComponent(identifier)}`, payload))
}

/**
 * Move a bed through housekeeping.
 *
 * Occupied is refused by the API: a bed is occupied because somebody was
 * admitted to it, so writing that state directly would let the board disagree
 * with the admissions behind it.
 */
export async function setBedStatus(
  identifier: string,
  status: Exclude<Bed['status'], 'Occupied'>,
  reservedFor?: string,
): Promise<BedRecord> {
  return toBed(
    await api.patch<ApiBed>(`/api/beds/${encodeURIComponent(identifier)}/status`, {
      status,
      reservedFor,
    }),
  )
}
