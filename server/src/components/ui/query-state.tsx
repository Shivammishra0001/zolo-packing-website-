import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/misc'
import { cn } from '@/lib/utils'

/**
 * The two states every API-backed screen needs, in one place.
 *
 * Screens that already render their own bespoke skeleton keep doing so — this
 * is for the panels where a plain "loading" or "that failed" is enough.
 */

export function LoadingState({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-xl border border-border bg-card py-14 text-center shadow-card',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="mb-3 size-6 animate-spin text-muted-foreground" />
      <p className="text-[13px] text-muted-foreground">{label}…</p>
    </div>
  )
}

export function ErrorState({
  message,
  title = 'Could not load this',
  onRetry,
  className,
}: {
  message: string
  title?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-xl border border-border bg-card py-14 text-center shadow-card',
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="mb-3 size-8 text-destructive" />
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-sm px-6 text-[13px] text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** A grid of card-shaped placeholders, for list panels that are still loading. */
export function SkeletonCards({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-3 h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}
