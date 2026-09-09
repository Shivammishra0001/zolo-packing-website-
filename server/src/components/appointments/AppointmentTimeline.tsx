import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import type { Appointment } from '@/types'
import { StatusBadge } from '@/components/ui/status'
import { InitialsAvatar } from '@/components/ui/misc'
import { cn, to12Hour } from '@/lib/utils'

const ACCENT: Record<Appointment['status'], string> = {
  Scheduled: 'bg-muted-foreground/35',
  Waiting: 'bg-warning',
  'In Consultation': 'bg-info',
  Completed: 'bg-success',
  'Follow-up': 'bg-accent',
  Cancelled: 'bg-destructive/60',
  'No Show': 'bg-destructive/60',
}

export function AppointmentTimeline({
  appointments,
  linkTo = (a) => `/patients/${a.patientId}`,
  showDoctor = false,
  className,
}: {
  appointments: Appointment[]
  linkTo?: (appointment: Appointment) => string
  showDoctor?: boolean
  className?: string
}) {
  if (appointments.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
        No appointments scheduled.
      </p>
    )
  }

  return (
    <ol className={cn('relative', className)}>
      {appointments.map((appointment, i) => {
        const isLast = i === appointments.length - 1
        return (
          <motion.li
            key={appointment.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.28 }}
            className="relative flex gap-4 pb-3 last:pb-0"
          >
            <div className="flex w-14 shrink-0 flex-col items-end pt-2.5">
              <span className="num text-[12.5px] font-semibold">{to12Hour(appointment.time).slice(0, 5)}</span>
              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                {to12Hour(appointment.time).slice(-2)}
              </span>
            </div>

            <div className="relative flex shrink-0 flex-col items-center">
              <span className={cn('mt-3.5 size-2.5 rounded-full ring-4 ring-card', ACCENT[appointment.status])} />
              {!isLast && <span className="w-px flex-1 bg-border" />}
            </div>

            <Link
              to={linkTo(appointment)}
              className={cn(
                'group mb-1 flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border px-3.5 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated',
                appointment.status === 'Cancelled' && 'opacity-60',
              )}
            >
              {appointment.patientInitials && (
                <InitialsAvatar
                  initials={appointment.patientInitials}
                  color={appointment.patientAvatarColor ?? ''}
                  className="size-9"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-[13.5px] font-semibold">
                  {appointment.patientName}
                  <span className="text-[11.5px] font-normal text-muted-foreground">
                    {appointment.patientAge} yrs · {appointment.patientGender}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {appointment.type}
                  {showDoctor && ` · ${appointment.doctor}`}
                  {appointment.checkedInAt && ` · Checked in ${to12Hour(appointment.checkedInAt)}`}
                </p>
              </div>
              <StatusBadge status={appointment.status} className="hidden sm:inline-flex" />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </motion.li>
        )
      })}
    </ol>
  )
}
