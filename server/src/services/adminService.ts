/** The administrator's own dashboard figures, counted in PostgreSQL. */

import type { Role } from '@/types'
import { api } from '@/services/api'

export interface StaffCounts {
  total: number
  active: number
  pending: number
  suspended: number
}

export interface AdminDashboard {
  staff: StaffCounts
  branches: number
  /** Branches still missing their configuration — the screen flags these. */
  unconfiguredBranches: number
  departments: number
  totalPatients: number
  /** Roles that currently grant nothing at all, which is a misconfiguration. */
  rolesWithoutPermissions: Role[]
}

export function getDashboard(): Promise<AdminDashboard> {
  return api.get<AdminDashboard>('/api/admin/dashboard')
}
