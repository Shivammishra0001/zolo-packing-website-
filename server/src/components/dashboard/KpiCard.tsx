import * as React from 'react'
import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { useCountUp } from '@/hooks/useCountUp'
import { cn } from '@/lib/utils'

export interface KpiCardProps {
  label: string
  value: number
  /** Wraps the animated number, e.g. `(n) => inr(n)` */
  format?: (value: number) => string
  suffix?: string
  prefix?: string
  decimals?: number
  change?: number
  changeLabel?: string
  /** Lower is better — flips the colour of the delta chip (e.g. expenses). */
  invertChange?: boolean
  icon?: React.ReactNode
  tone?: 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral'
  footer?: React.ReactNode
  className?: string
}

const TONE_RING: Record<NonNullable<KpiCardProps['tone']>, string> = {
  accent: 'bg-accent/10 text-accent',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
}

export function KpiCard({
  label,
  value,
  format,
  suffix,
  prefix,
  decimals = 0,
  change,
  changeLabel = 'vs last month',
  invertChange = false,
  icon,
  tone = 'accent',
  footer,
  className,
}: KpiCardProps) {
  const { ref, display } = useCountUp(value, { decimals })
  const positive = change !== undefined && change > 0
  const negative = change !== undefined && change < 0
  const good = invertChange ? negative : positive

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-elevated',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] font-medium leading-tight text-muted-foreground">{label}</p>
        {icon && (
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', TONE_RING[tone])}>
            {icon}
          </span>
        )}
      </div>

      <p
        ref={ref as React.RefObject<HTMLParagraphElement>}
        className="num mt-3 text-2xl font-bold tracking-tight lg:text-[26px]"
      >
        {prefix}
        {format ? format(display) : display.toLocaleString('en-IN')}
        {suffix}
      </p>

      {change !== undefined && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.25 }}
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold',
              change === 0
                ? 'bg-muted text-muted-foreground'
                : good
                  ? 'bg-success/10 text-success'
                  : 'bg-destructive/10 text-destructive',
            )}
          >
            {change === 0 ? (
              <Minus className="size-3" />
            ) : positive ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {Math.abs(change).toFixed(1)}%
          </motion.span>
          <span className="text-[11.5px] text-muted-foreground">{changeLabel}</span>
        </div>
      )}

      {footer && <div className="mt-3 border-t border-border pt-3 text-[12px] text-muted-foreground">{footer}</div>}
    </div>
  )
}

/** Staggered entrance wrapper for a row of KPI cards. */
export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', className)}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.06 } },
      }}
    >
      {React.Children.map(children, (child, i) => (
        <motion.div
          key={i}
          variants={{
            hidden: { opacity: 0, y: 12 },
            show: { opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
          }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  )
}
