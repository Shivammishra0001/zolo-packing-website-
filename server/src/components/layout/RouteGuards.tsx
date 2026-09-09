import { Navigate, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Permission } from '@/types'
import { ROLE_HOME } from '@/lib/permissions'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/misc'

export function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  )
}

/** Requires a signed-in user; optionally requires specific permissions. */
export function RequireAuth({
  permission,
  children,
}: {
  permission?: Permission | Permission[]
  children: React.ReactNode
}) {
  const { user, ready, has } = useAuth()
  const location = useLocation()

  if (!ready) return <AuthLoading />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (permission && !has(permission)) return <Forbidden />

  return <>{children}</>
}

/** Sends an already-signed-in user to their own dashboard. */
export function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth()
  if (!ready) return <AuthLoading />
  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />
  return <>{children}</>
}

export function Forbidden() {
  const { user } = useAuth()

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldAlert className="size-6" />
      </div>
      <h1 className="text-xl font-bold tracking-tight">You do not have access to this screen</h1>
      <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
        Your role does not include the permission required for this page. If you believe this is a mistake, ask your
        administrator to review your role assignment.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to={user ? ROLE_HOME[user.role] : '/login'}>Back to my dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
