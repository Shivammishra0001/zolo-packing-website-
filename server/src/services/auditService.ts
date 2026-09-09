/**
 * The audit trail.
 *
 * Read-only, by construction rather than by permission: the API has no update
 * or delete handler for an entry, so history cannot be quietly rewritten.
 */

import type { Role } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type AuditCategory = 'auth' | 'staff' | 'patient' | 'pharmacy' | 'billing' | 'system'

export interface AuditRecord {
  id: string
  /** The person who did it, or "System" for anything the platform did itself. */
  actor: string
  actorRole: Role | null
  /** A verb constant, e.g. USER_SUSPENDED. */
  action: string
  category: AuditCategory
  /** The one-line description the timeline shows. */
  summary: string
  targetType: string | null
  targetId: string | null
  ipAddress: string | null
  at: string
}

export interface AuditPage {
  items: AuditRecord[]
  page: number
  limit: number
  total: number
  totalPages: number
}

interface ApiPage {
  items: AuditRecord[]
  page: number
  limit: number
  total: number
  total_pages: number
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface AuditListParams {
  page?: number
  limit?: number
  /** User UUID or `USR-####` code. */
  actor?: string
  action?: string
  category?: AuditCategory
  targetType?: string
  search?: string
  dateFrom?: string
  dateTo?: string
}

export async function listAudit(params: AuditListParams = {}): Promise<AuditPage> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.actor) query.set('actor', params.actor)
  if (params.action) query.set('action', params.action)
  if (params.category) query.set('category', params.category)
  if (params.targetType) query.set('target_type', params.targetType)
  if (params.search) query.set('search', params.search)
  if (params.dateFrom) query.set('date_from', params.dateFrom)
  if (params.dateTo) query.set('date_to', params.dateTo)

  const suffix = query.toString()
  const page = await api.get<ApiPage>(`/api/audit-logs${suffix ? `?${suffix}` : ''}`)
  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}
