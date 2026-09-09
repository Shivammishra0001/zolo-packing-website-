import { cn } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-chart-2 text-white shadow-xs',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.2}>
        <path d="M3 12.5h3.2l1.6-4 2.8 7.2 2-4.6 1.2 1.4H21" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export function Logo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-bold leading-tight tracking-tight">Arogya Rehab</span>
          <span className="block truncate text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Rehabilitation HMS
          </span>
        </span>
      )}
    </span>
  )
}
