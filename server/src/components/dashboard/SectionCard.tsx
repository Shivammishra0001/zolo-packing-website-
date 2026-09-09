import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SectionCard({
  title,
  description,
  action,
  viewAllHref,
  viewAllLabel = 'View all',
  children,
  className,
  bodyClassName,
  delay = 0,
  icon,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  viewAllHref?: string
  viewAllLabel?: string
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  delay?: number
  icon?: React.ReactNode
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex flex-col rounded-xl border border-border bg-card shadow-card', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
            {title}
          </h2>
          {description && <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {viewAllHref && (
            <Link
              to={viewAllHref}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent/10"
            >
              {viewAllLabel}
              <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      </header>
      <div className={cn('flex-1 p-5', bodyClassName)}>{children}</div>
    </motion.section>
  )
}

/** Small labelled statistic used inside section cards. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-muted/35 px-3.5 py-3 transition-colors',
        tone === 'accent' && 'border-accent/25 bg-accent/[0.07]',
        tone === 'success' && 'border-success/25 bg-success/[0.07]',
        tone === 'warning' && 'border-warning/30 bg-warning/[0.07]',
        tone === 'danger' && 'border-destructive/25 bg-destructive/[0.07]',
        tone === 'info' && 'border-info/25 bg-info/[0.07]',
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="num mt-1 text-lg font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
