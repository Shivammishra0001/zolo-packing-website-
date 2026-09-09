import * as React from 'react'
import type { Permission, Role, User } from '@/types'
import { can } from '@/lib/permissions'
import { ApiError, setUnauthorizedHandler, tokenStore } from '@/services/api'
import { fetchSession, login as loginRequest, logout as logoutRequest } from '@/services/auth'
import { DEMO_PASSWORD, DEMO_USERS } from '@/data/users'

const USER_KEY = 'arogya.session'
const PERMISSIONS_KEY = 'arogya.permissions'

/**
 * Demo-only affordance. Set `VITE_DEMO_MODE=true` to expose the avatar-menu
 * role switcher. It performs a *real* sign-in with the seeded demo credentials
 * — it never fabricates a session, and the backend never trusts a role sent by
 * the client.
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

interface AuthContextValue {
  user: User | null
  permissions: Permission[]
  ready: boolean
  signIn: (email: string, password: string, remember: boolean) => Promise<User>
  signOut: () => Promise<void>
  /** Available only in demo mode; a no-op otherwise. */
  switchRole: (role: Role) => Promise<void>
  demoMode: boolean
  has: (required?: Permission | Permission[]) => boolean
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

/* -------------------------------------------------------------------------- */
/* Cached session                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The user and permissions are cached so a reload paints the shell immediately
 * instead of flashing a skeleton. The cache is never authoritative — it is
 * revalidated against `/api/auth/me` on every boot, and the token is the only
 * real credential.
 */
function readCache(): { user: User; permissions: Permission[] } | null {
  try {
    const rawUser =
      window.sessionStorage.getItem(USER_KEY) ?? window.localStorage.getItem(USER_KEY)
    const rawPermissions =
      window.sessionStorage.getItem(PERMISSIONS_KEY) ??
      window.localStorage.getItem(PERMISSIONS_KEY)
    if (!rawUser || !tokenStore.get()) return null
    return {
      user: JSON.parse(rawUser) as User,
      permissions: rawPermissions ? (JSON.parse(rawPermissions) as Permission[]) : [],
    }
  } catch {
    return null
  }
}

function writeCache(user: User, permissions: Permission[], remember: boolean) {
  try {
    const store = remember ? window.localStorage : window.sessionStorage
    const other = remember ? window.sessionStorage : window.localStorage
    store.setItem(USER_KEY, JSON.stringify(user))
    store.setItem(PERMISSIONS_KEY, JSON.stringify(permissions))
    other.removeItem(USER_KEY)
    other.removeItem(PERMISSIONS_KEY)
  } catch {
    /* storage unavailable — session stays in memory */
  }
}

function clearCache() {
  try {
    for (const key of [USER_KEY, PERMISSIONS_KEY]) {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const cached = React.useMemo(readCache, [])
  const [user, setUser] = React.useState<User | null>(cached?.user ?? null)
  const [permissions, setPermissions] = React.useState<Permission[]>(cached?.permissions ?? [])
  const [ready, setReady] = React.useState(false)

  const clearSession = React.useCallback(() => {
    tokenStore.clear()
    clearCache()
    setUser(null)
    setPermissions([])
  }, [])

  // Any 401 from anywhere in the app ends the session, so an expired token is
  // never silently reused. RequireAuth then redirects to /login.
  React.useEffect(() => {
    setUnauthorizedHandler(clearSession)
    return () => setUnauthorizedHandler(null)
  }, [clearSession])

  // Revalidate the stored token against the server on boot.
  React.useEffect(() => {
    let cancelled = false

    fetchSession()
      .then((session) => {
        if (cancelled) return
        if (session) {
          setUser(session.user)
          setPermissions(session.permissions)
          // Refresh the cache in whichever store already holds the token.
          writeCache(
            session.user,
            session.permissions,
            window.localStorage.getItem('arogya.token') !== null,
          )
        } else {
          clearSession()
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [clearSession])

  const signIn = React.useCallback(async (email: string, password: string, remember: boolean) => {
    try {
      const session = await loginRequest(email, password, remember)
      setUser(session.user)
      setPermissions(session.permissions)
      writeCache(session.user, session.permissions, remember)
      return session.user
    } catch (error) {
      // Surface the backend's message (invalid credentials / suspended /
      // awaiting approval) so the login form keeps its distinct error states.
      if (error instanceof ApiError) throw new Error(error.message)
      throw error
    }
  }, [])

  const signOut = React.useCallback(async () => {
    await logoutRequest()
    clearCache()
    setUser(null)
    setPermissions([])
  }, [])

  /** Demo only: sign in as another seeded role through the real login flow. */
  const switchRole = React.useCallback(
    async (role: Role) => {
      if (!DEMO_MODE) return
      const demo = DEMO_USERS[role]
      if (!demo) return
      await signIn(demo.email, DEMO_PASSWORD, false)
    },
    [signIn],
  )

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      ready,
      signIn,
      signOut,
      switchRole,
      demoMode: DEMO_MODE,
      has: (required) => can(permissions, required),
    }),
    [user, permissions, ready, signIn, signOut, switchRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
