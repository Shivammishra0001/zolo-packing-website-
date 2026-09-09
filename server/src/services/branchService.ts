/** Branches, and the staff and patients attached to them. */

import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface BranchRecord {
  id: string
  name: string
  city: string
  address: string
  phone: string
  email: string
  /** "07:00" — a bare time, as the branch form edits it. */
  opensAt: string | null
  closesAt: string | null
  beds: number
  configured: boolean
  services: string[]
  /** Counted live, so a branch cannot claim people it does not have. */
  staffCount: number
  patientCount: number
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export function listBranches(): Promise<BranchRecord[]> {
  return api.get<BranchRecord[]>('/api/branches')
}

export function getBranch(identifier: string): Promise<BranchRecord> {
  return api.get<BranchRecord>(`/api/branches/${encodeURIComponent(identifier)}`)
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface BranchPayload {
  name: string
  city?: string
  address?: string
  phone?: string
  email?: string
  opensAt?: string
  closesAt?: string
  beds?: number
  configured?: boolean
  services?: string[]
}

export function createBranch(payload: BranchPayload): Promise<BranchRecord> {
  return api.post<BranchRecord>('/api/branches', payload)
}

/**
 * Amend a branch.
 *
 * There is no delete. A branch owns patients, staff, wards and expenses, and
 * removing one would orphan history that has to stay intact.
 */
export function updateBranch(
  identifier: string,
  payload: Partial<BranchPayload>,
): Promise<BranchRecord> {
  return api.put<BranchRecord>(`/api/branches/${encodeURIComponent(identifier)}`, payload)
}
