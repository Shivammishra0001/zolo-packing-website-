import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { cn } from "@/utils/cn";
import type { MockQuery } from "../hooks";

// ---------- Card / panel wrapper with built-in loading, error, empty states ----------

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("erp-card card-shadow", className)}>
      {title != null && (
        <header className="flex items-center justify-between gap-3 border-b erp-border-soft px-4 py-3 sm:px-5">
          <h2 className="text-sm font-bold erp-text">{title}</h2>
          {action}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("erp-skeleton rounded-md", className)} aria-hidden />
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center" role="alert">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10">
        <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden />
      </div>
      <p className="max-w-xs text-sm erp-text-muted">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border erp-border px-4 py-2 text-sm font-semibold erp-text hover:erp-surface-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  icon: Icon = Inbox,
  action,
}: {
  title?: string;
  message: string;
  icon?: typeof Inbox;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full erp-surface-2">
        <Icon className="h-5 w-5 erp-text-faint" aria-hidden />
      </div>
      {title && <p className="text-sm font-bold erp-text">{title}</p>}
      <p className="max-w-xs text-sm erp-text-muted">{message}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Renders a mock query's loading / error states, or the content when ready */
export function QueryState<T>({
  query,
  skeleton,
  empty,
  isEmpty,
  children,
}: {
  query: MockQuery<T>;
  skeleton?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.loading) return <>{skeleton ?? <ListSkeleton />}</>;
  if (query.error) return <ErrorState message={query.error} onRetry={query.retry} />;
  if (query.data == null) return null;
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
