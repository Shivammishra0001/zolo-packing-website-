/** Authentication endpoints. */

import type { Permission, User } from '@/types'
import { api, tokenStore } from '@/services/api'

/** The user object exactly as the backend returns it. */
interface ApiUser {
  id: string
  uuid: string
  name: string
  email: string
  role: User['role']
  designation: string | null
  department: string | null
  avatarColor: string | null
  initials: string | null
  branch: string | null
  phone: string | null
  status: User['status']
  lastLogin: string | null
}

interface SessionPayload {
  user: ApiUser
  permissions: string[]
}

interface LoginPayload extends SessionPayload {
  access_token: string
  token_type: string
  expires_at: string
  expires_in: number
}

export interface Session {
  user: User
  permissions: Permission[]
}

/** Format an ISO timestamp the way the existing UI shows `lastLogin`. */
function formatLastLogin(iso: string | null): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Never'

  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  if (sameDay) return `Today, ${time}`

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`

  return `${date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, ${time}`
}

/** Map the API user onto the frontend's existing `User` type. */
function toUser(payload: ApiUser): User {
  return {
    id: payload.id,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    designation: payload.designation ?? '',
    department: payload.department ?? '',
    avatarColor: payload.avatarColor ?? 'bg-muted text-muted-foreground',
    initials: payload.initials ?? payload.name.slice(0, 2).toUpperCase(),
    branch: payload.branch ?? 'All Branches',
    phone: payload.phone ?? '',
    lastLogin: formatLastLogin(payload.lastLogin),
    status: payload.status,
  }
}

function toSession(payload: SessionPayload): Session {
  return {
    user: toUser(payload.user),
    // The backend owns the permission vocabulary; these keys are the same
    // strings the frontend's `can()` already checks against.
    permissions: payload.permissions as Permission[],
  }
}

export async function login(email: string, password: string, remember: boolean): Promise<Session> {
  const payload = await api.post<LoginPayload>(
    '/api/auth/login',
    { email, password, remember },
    { anonymous: true },
  )
  tokenStore.set(payload.access_token, remember)
  return toSession(payload)
}

/** Validate the stored token and return the current session, or null. */
export async function fetchSession(): Promise<Session | null> {
  if (!tokenStore.get()) return null
  try {
    // suppressAuthRedirect: on boot an expired token should just mean "signed
    // out", not a redirect loop.
    const payload = await api.get<SessionPayload>('/api/auth/me', { suppressAuthRedirect: true })
    return toSession(payload)
  } catch {
    tokenStore.clear()
    return null
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/api/auth/logout', undefined, { suppressAuthRedirect: true })
  } catch {
    // Signing out must always succeed locally, even if the server is down.
  } finally {
    tokenStore.clear()
  }
}
