/**
 * Staff accounts.
 *
 * Nothing here is authoritative. A role, a status and a branch assignment are
 * whatever PostgreSQL says they are — this module reads them for display and
 * posts changes back, and the backend decides whether each one is allowed.
 */

import type { Role, User } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The API's staff row: the frontend `User` shape plus the ids the admin forms
 * post back. No password, hash or token — the response has no field for one.
 */
export interface StaffRecord extends User {
  uuid: string
  branchId: string | null
  departmentId: string | null
}

/** A newly invited account, and the one-time password that stands in for an email. */
export interface StaffInvitation {
  user: StaffRecord
  temporaryPassword: string
  /** Always true — this flow exists because the build has no mail server. */
  developmentOnly: boolean
}

export interface StaffPage {
  items: StaffRecord[]
  page: number
  limit: number
  total: number
  totalPages: number
}

interface ApiPage {
  items: StaffRecord[]
  page: number
  limit: number
  total: number
  total_pages: number
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface StaffListParams {
  page?: number
  limit?: number
  search?: string
  role?: Role
  status?: User['status']
  /** Branch UUID. */
  branch?: string
}

export async function listUsers(params: StaffListParams = {}): Promise<StaffPage> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.search) query.set('search', params.search)
  if (params.role) query.set('role', params.role)
  if (params.status) query.set('status', params.status)
  if (params.branch) query.set('branch', params.branch)

  const suffix = query.toString()
  const page = await api.get<ApiPage>(`/api/users${suffix ? `?${suffix}` : ''}`)
  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export function getUser(identifier: string): Promise<StaffRecord> {
  return api.get<StaffRecord>(`/api/users/${encodeURIComponent(identifier)}`)
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface StaffPayload {
  name: string
  email: string
  role: Role
  designation?: string
  department?: string
  phone?: string
  /** Branch UUID. Defaults to the caller's own branch on the server. */
  branchId?: string
}

/**
 * Invite a staff member.
 *
 * The account is created `pending` and cannot sign in until an administrator
 * approves it. The temporary password comes back once and is never retrievable
 * again.
 */
export function createUser(payload: StaffPayload): Promise<StaffInvitation> {
  return api.post<StaffInvitation>('/api/users', payload)
}

/**
 * Amend a staff member.
 *
 * Status is deliberately absent: it moves through approve, suspend and
 * activate, where the transition rules live.
 */
export function updateUser(
  identifier: string,
  payload: Partial<StaffPayload>,
): Promise<StaffRecord> {
  return api.put<StaffRecord>(`/api/users/${encodeURIComponent(identifier)}`, payload)
}

/** Approve a pending account. */
export function approveUser(identifier: string): Promise<StaffRecord> {
  return api.post<StaffRecord>(`/api/users/${encodeURIComponent(identifier)}/approve`)
}

/** Reinstate a suspended account. */
export function activateUser(identifier: string): Promise<StaffRecord> {
  return api.post<StaffRecord>(`/api/users/${encodeURIComponent(identifier)}/activate`)
}

/**
 * Suspend an account.
 *
 * Takes effect on that user's very next request — their token stays valid, but
 * the account behind it no longer is.
 */
export function suspendUser(identifier: string): Promise<StaffRecord> {
  return api.post<StaffRecord>(`/api/users/${encodeURIComponent(identifier)}/suspend`)
}

/* -------------------------------------------------------------------------- */
/* Clinician picker                                                           */
/* -------------------------------------------------------------------------- */

/** Just enough to draw a doctor or therapist picker. */
export interface ClinicianOption {
  id: string
  uuid: string
  name: string
  role: Role
  designation: string
  department: string
  branch: string
}

/**
 * Active clinicians a booking can be assigned to.
 *
 * Gated on `appointment.view` rather than `staff.manage`: reception has to
 * choose a doctor to book one, and that is not a reason to hand them the whole
 * staff directory.
 */
export function listClinicians(role?: Extract<Role, 'doctor' | 'therapist'>): Promise<ClinicianOption[]> {
  const suffix = role ? `?role=${encodeURIComponent(role)}` : ''
  return api.get<ClinicianOption[]>(`/api/users/clinicians${suffix}`)
}
