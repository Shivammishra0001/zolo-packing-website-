import { motion } from 'framer-motion'
import { Boxes, KeyRound, Receipt, Server, UserCog, UserRound } from 'lucide-react'
import type { ActivityEvent } from '@/types'
import { cn } from '@/lib/utils'

const CATEGORY = {
  auth: { icon: KeyRound, tone: 'bg-info/12 text-info' },
  staff: { icon: UserCog, tone: 'bg-chart-5/12 text-chart-5' },
  patient: { icon: UserRound, tone: 'bg-accent/12 text-accent' },
  pharmacy: { icon: Boxes, tone: 'bg-success/12 text-success' },
  billing: { icon: Receipt, tone: 'bg-chart-3/12 text-chart-3' },
  system: { icon: Server, tone: 'bg-muted text-muted-foreground' },
} as const

export function ActivityTimeline({ events, className }: { events: ActivityEvent[]; className?: string }) {
  return (
    <ol className={cn('relative space-y-0.5', className)}>
      {events.map((event, i) => {
        const { icon: Icon, tone } = CATEGORY[event.category]
        const isLast = i === events.length - 1
        return (
          <motion.li
            key={event.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.055, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex gap-3.5 pb-4 last:pb-0"
          >
            {!isLast && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-border" aria-hidden />}
            <span className={cn('relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full', tone)}>
              <Icon className="size-[15px]" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[13px] leading-snug">
                <span className="font-semibold">{event.actor}</span>{' '}
                <span className="text-muted-foreground">{event.action}</span>{' '}
                <span className="font-medium">{event.target}</span>
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">{event.time}</p>
            </div>
          </motion.li>
        )
      })}
    </ol>
  )
}
