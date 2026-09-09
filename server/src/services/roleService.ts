/**
 * Roles and the permission matrix.
 *
 * The matrix in `src/lib/permissions.ts` is a static fallback for a signed-out
 * shell; this module is the live one. When an administrator saves the Roles
 * screen the database changes, and every holder of that role is affected on
 * their next request — there is no cache to clear and no restart.
 */

import type { Permission, Role } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface RoleRecord {
  /** The role's own lowercase value — there is no separate roles table. */
  id: Role
  label: string
  permissions: Permission[]
  /** How many accounts currently hold it. */
  headcount: number
}

export interface PermissionRecord {
  key: Permission
  name: string
  group: string
  description: string | null
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export function listRoles(): Promise<RoleRecord[]> {
  return api.get<RoleRecord[]>('/api/roles')
}

export function getRole(role: Role): Promise<RoleRecord> {
  return api.get<RoleRecord>(`/api/roles/${encodeURIComponent(role)}`)
}

/** The catalogue the matrix is drawn from, grouped as the Roles screen groups it. */
export function listPermissions(): Promise<PermissionRecord[]> {
  return api.get<PermissionRecord[]>('/api/roles/permissions')
}

/** Every role's permissions, keyed by role — the shape the matrix renders. */
export async function loadMatrix(): Promise<Record<Role, Permission[]>> {
  const roles = await listRoles()
  return Object.fromEntries(roles.map((r) => [r.id, r.permissions])) as Record<Role, Permission[]>
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Replace a role's permissions outright.
 *
 * The whole set, not a diff: the server swaps it in one transaction, so the
 * role is never left half-updated. Editing the owner role requires being one.
 */
export function setRolePermissions(role: Role, permissions: Permission[]): Promise<RoleRecord> {
  return api.put<RoleRecord>(`/api/roles/${encodeURIComponent(role)}/permissions`, { permissions })
}
