import * as React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AlertItem {
  id: string
  title: string
  detail?: string
  href?: string
  severity: 'info' | 'warning' | 'critical' | 'success'
  meta?: string
}

const SEVERITY: Record<
  AlertItem['severity'],
  { icon: React.ElementType; wrap: string; icon_: string }
> = {
  critical: { icon: AlertOctagon, wrap: 'border-destructive/25 bg-destructive/[0.06]', icon_: 'text-destructive' },
  warning: { icon: AlertTriangle, wrap: 'border-warning/30 bg-warning/[0.06]', icon_: 'text-warning' },
  info: { icon: Info, wrap: 'border-info/25 bg-info/[0.06]', icon_: 'text-info' },
  success: { icon: CheckCircle2, wrap: 'border-success/25 bg-success/[0.06]', icon_: 'text-success' },
}

export function AlertList({ items, className }: { items: AlertItem[]; className?: string }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-success/25 bg-success/[0.06] px-3.5 py-3">
        <CheckCircle2 className="size-4 shrink-0 text-success" />
        <p className="text-[13px] font-medium">Nothing needs your attention right now.</p>
      </div>
    )
  }

  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((item, i) => {
        const { icon: Icon, wrap, icon_ } = SEVERITY[item.severity]
        const body = (
          <div className={cn('flex items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors', wrap)}>
            <Icon className={cn('mt-0.5 size-[17px] shrink-0', icon_)} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-snug">{item.title}</p>
              {item.detail && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{item.detail}</p>}
            </div>
            {item.meta && <span className="num shrink-0 text-[12px] text-muted-foreground">{item.meta}</span>}
            {item.href && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          </div>
        )

        return (
          <motion.li
            key={item.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.28 }}
          >
            {item.href ? (
              <Link to={item.href} className="block rounded-lg transition-transform hover:translate-x-0.5">
                {body}
              </Link>
            ) : (
              body
            )}
          </motion.li>
        )
      })}
    </ul>
  )
}
