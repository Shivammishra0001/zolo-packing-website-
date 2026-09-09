/**
 * Notifications and global search.
 *
 * A notification belongs to a user, and the API only ever returns the
 * authenticated caller's own — there is no parameter for whose to fetch, so
 * nothing here can ask for somebody else's.
 */

import type { Notification } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The API's alert row.
 *
 * The frontend's `Notification` carries a `role`, which the mock used to decide
 * who saw what. A real one is addressed to a user, so there is nothing to
 * filter by here and the field is absent.
 */
export type NotificationRecord = Omit<Notification, 'role'> & {
  createdAt: string
}

export interface NotificationPage {
  items: NotificationRecord[]
  /** Across the whole account, not this page — it is what the badge shows. */
  unread: number
  page: number
  limit: number
  total: number
  totalPages: number
}

interface ApiPage {
  items: NotificationRecord[]
  unread: number
  page: number
  limit: number
  total: number
  total_pages: number
}

export interface ReadResult {
  updated: number
  unread: number
}

export async function listNotifications(limit = 20): Promise<NotificationPage> {
  const page = await api.get<ApiPage>(`/api/notifications?limit=${limit}`)
  return {
    items: page.items,
    unread: page.unread,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export function unreadCount(): Promise<{ unread: number }> {
  return api.get<{ unread: number }>('/api/notifications/unread-count')
}

export function markNotificationRead(id: string): Promise<ReadResult> {
  return api.post<ReadResult>(`/api/notifications/${encodeURIComponent(id)}/read`)
}

export function markAllNotificationsRead(): Promise<ReadResult> {
  return api.post<ReadResult>('/api/notifications/read-all')
}

/* -------------------------------------------------------------------------- */
/* Global search                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One result: a name, a code and somewhere to go.
 *
 * Deliberately thin. The palette is reachable by every role, so a hit never
 * carries a diagnosis, a note or a balance.
 */
export interface SearchHit {
  type: string
  id: string
  title: string
  subtitle: string
  url: string
}

export interface SearchGroup {
  type: string
  label: string
  hits: SearchHit[]
}

export interface SearchResults {
  query: string
  groups: SearchGroup[]
  total: number
}

/** Categories the caller lacks permission for are absent, not empty. */
export function globalSearch(q: string, limit = 5): Promise<SearchResults> {
  const query = new URLSearchParams({ q, limit: String(limit) })
  return api.get<SearchResults>(`/api/search?${query.toString()}`)
}
