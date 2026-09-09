import * as React from 'react'
import { useAuth } from '@/context/AuthContext'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRecord,
} from '@/services/notificationService'

/**
 * The bell's data.
 *
 * Everything comes from the API, which only ever returns the signed-in user's
 * own alerts — the frontend has no say in whose it sees. Marking one read is
 * applied optimistically so the badge responds immediately, then reconciled
 * with the count the server returns; if the call fails the change is rolled
 * back rather than left showing a lie.
 */
interface NotificationContextValue {
  items: NotificationRecord[]
  unread: number
  loading: boolean
  error: string | null
  markRead: (id: string) => void
  markAllRead: () => void
  refresh: () => void
}

const NotificationContext = React.createContext<NotificationContextValue | null>(null)

/**
 * How often the bell re-checks while a tab is open.
 *
 * Notifications are raised by other people's actions — a colleague checking a
 * patient in, a payment landing — so nothing in this tab would otherwise tell
 * it to look. Sixty seconds is frequent enough to feel live and slow enough
 * that a day at the desk costs a few hundred cheap indexed counts.
 */
const POLL_MS = 60_000

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [items, setItems] = React.useState<NotificationRecord[]>([])
  const [unread, setUnread] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!user) {
      setItems([])
      setUnread(0)
      return
    }
    setLoading(true)
    try {
      const page = await listNotifications(20)
      setItems(page.items)
      setUnread(page.unread)
      setError(null)
    } catch (err) {
      // The bell failing must never take a screen down with it.
      setError(err instanceof Error ? err.message : 'Could not load notifications.')
    } finally {
      setLoading(false)
    }
  }, [user])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (!user) return
    const timer = window.setInterval(() => {
      // Skip the poll while the tab is hidden — nobody is looking at the badge.
      if (!document.hidden) void load()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [user, load])

  const markRead = React.useCallback(
    async (id: string) => {
      const target = items.find((n) => n.id === id)
      if (!target || target.read) return

      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
      setUnread((prev) => Math.max(0, prev - 1))
      try {
        const result = await markNotificationRead(id)
        setUnread(result.unread)
      } catch {
        // Put it back rather than show a badge that does not match the server.
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)))
        setUnread((prev) => prev + 1)
      }
    },
    [items],
  )

  const markAllRead = React.useCallback(async () => {
    const snapshot = items
    const previousUnread = unread

    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnread(0)
    try {
      const result = await markAllNotificationsRead()
      setUnread(result.unread)
    } catch {
      setItems(snapshot)
      setUnread(previousUnread)
    }
  }, [items, unread])

  const value = React.useMemo<NotificationContextValue>(
    () => ({ items, unread, loading, error, markRead, markAllRead, refresh: load }),
    [items, unread, loading, error, markRead, markAllRead, load],
  )

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications() {
  const ctx = React.useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>')
  return ctx
}
