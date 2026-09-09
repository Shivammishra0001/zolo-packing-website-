import * as React from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, Clock, LogIn, Stethoscope } from 'lucide-react'
import type { Appointment } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InitialsAvatar } from '@/components/ui/misc'
import { StatusBadge } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import {
  appointmentKey,
  checkIn,
  completeAppointment,
  listAppointments,
  minutesSince,
  startAppointment,
  todayIso,
} from '@/services/appointmentService'
import { cn, timeToMinutes, to12Hour } from '@/lib/utils'

/**
 * The board re-reads the clock every half minute so waiting times tick up on
 * their own. The elapsed wait is always derived here from the server's
 * `checkedInAt` — it is never a stored string.
 */
function useClock(intervalMs = 30_000) {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export default function ReceptionQueue() {
  const toast = useToast()
  const now = useClock()
  const today = React.useMemo(() => todayIso(), [])
  const [busy, setBusy] = React.useState<string | null>(null)

  const { data, loading, error, refetch } = useQuery(
    () => listAppointments({ date: today, scope: 'branch', limit: 200 }),
    [today],
  )

  const appointments = data?.items ?? []

  const waiting = appointments
    .filter((a) => a.status === 'Waiting')
    .sort((a, b) => timeToMinutes(a.checkedInAt ?? a.time) - timeToMinutes(b.checkedInAt ?? b.time))
  const upcoming = appointments.filter((a) => a.status === 'Scheduled').sort((a, b) => a.time.localeCompare(b.time))
  const inConsultation = appointments.filter((a) => a.status === 'In Consultation')
  const seen = appointments.filter((a) => a.status === 'Completed')

  const longestWait = waiting.reduce((max, a) => Math.max(max, minutesSince(a.checkedInAt, now) ?? 0), 0)

  /** Run a workflow call, then refresh from the server rather than guessing. */
  async function run(
    appointment: Appointment,
    call: (id: string) => Promise<Appointment>,
    onDone: () => void,
  ) {
    const key = appointmentKey(appointment)
    setBusy(key)
    try {
      await call(key)
      onDone()
      refetch()
    } catch (err) {
      toast.error(
        'Could not update the queue',
        err instanceof Error ? err.message : 'Please try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  function QueueCard({ appointment, index }: { appointment: Appointment; index: number }) {
    const waitMinutes = minutesSince(appointment.checkedInAt, now)
    const pending = busy === appointmentKey(appointment)

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.24, delay: Math.min(index * 0.04, 0.2) }}
        className={cn(
          'flex h-full flex-col rounded-xl border bg-card p-4 shadow-card',
          waitMinutes !== null && waitMinutes > 20 ? 'border-warning/40' : 'border-border',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="num flex size-9 items-center justify-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground">
            {String(appointment.tokenNumber).padStart(2, '0')}
          </span>
          <StatusBadge status={appointment.status} />
        </div>

        <div className="mt-3 flex items-center gap-2.5">
          {appointment.patientInitials && (
            <InitialsAvatar
              initials={appointment.patientInitials}
              color={appointment.patientAvatarColor ?? ''}
              className="size-10"
            />
          )}
          <div className="min-w-0">
            <Link
              to={`/patients/${appointment.patientId}`}
              className="block truncate text-[14px] font-semibold hover:text-accent"
            >
              {appointment.patientName}
            </Link>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {appointment.patientAge} yrs · {appointment.type}
            </p>
          </div>
        </div>

        <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-[12px]">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Slot</dt>
            <dd className="num font-medium">{to12Hour(appointment.time)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Doctor</dt>
            <dd className="truncate font-medium">{appointment.doctor}</dd>
          </div>
          {waitMinutes !== null && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Waiting</dt>
              <dd className={cn('num font-medium', waitMinutes > 20 && 'text-warning')}>{waitMinutes} min</dd>
            </div>
          )}
        </dl>

        <div className="mt-3 flex gap-2">
          {appointment.status === 'Scheduled' && (
            <Button
              size="sm"
              className="flex-1"
              disabled={pending}
              onClick={() =>
                run(appointment, checkIn, () =>
                  toast.success('Checked in', `${appointment.patientName} joined ${appointment.doctor}'s queue.`),
                )
              }
            >
              <LogIn />
              Check In
            </Button>
          )}
          {appointment.status === 'Waiting' && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={pending}
              onClick={() =>
                run(appointment, startAppointment, () =>
                  toast.info('Sent to consultation', `${appointment.doctor} has been notified.`),
                )
              }
            >
              <Stethoscope />
              Send in
            </Button>
          )}
          {appointment.status === 'In Consultation' && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={pending}
              onClick={() =>
                run(appointment, completeAppointment, () =>
                  toast.success('Visit completed', `${appointment.patientName} can be billed at the desk.`),
                )
              }
            >
              <CheckCircle2 />
              Mark done
            </Button>
          )}
        </div>
      </motion.div>
    )
  }

  return (
    <>
      <PageHeader
        title="Check-in queue"
        description="Who is waiting, for how long, and who is with a clinician right now."
        crumbs={[{ label: 'Reception', to: '/reception/dashboard' }, { label: 'Check-in Queue' }]}
      />

      {loading && <LoadingState label="Loading today's queue" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Waiting" value={waiting.length} tone="warning" />
            <StatTile label="In consultation" value={inConsultation.length} tone="info" />
            <StatTile label="Yet to arrive" value={upcoming.length} />
            <StatTile
              label="Longest wait"
              value={`${longestWait} min`}
              tone={longestWait > 20 ? 'danger' : 'success'}
              hint={<span className="inline-flex items-center gap-1"><Clock className="size-3" /> Target under 20 min</span>}
            />
          </div>

          <SectionCard title="Waiting" description="Ordered by check-in time — longest wait first." className="mb-5">
            {waiting.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <CheckCircle2 className="mb-2 size-8 text-success" />
                <p className="text-sm font-semibold">Nobody is waiting</p>
                <p className="mt-1 text-[13px] text-muted-foreground">Every checked-in patient has been sent through.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                <AnimatePresence>
                  {waiting.map((appointment, i) => (
                    <QueueCard key={appointment.id} appointment={appointment} index={i} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </SectionCard>

          {inConsultation.length > 0 && (
            <SectionCard title="With a clinician" description="Currently in consultation." className="mb-5" delay={0.05}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {inConsultation.map((appointment, i) => (
                  <QueueCard key={appointment.id} appointment={appointment} index={i} />
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard title="Yet to arrive" description="Booked for later today." delay={0.1}>
            {upcoming.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">Everyone booked for today has arrived.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {upcoming.map((appointment, i) => (
                  <QueueCard key={appointment.id} appointment={appointment} index={i} />
                ))}
              </div>
            )}
          </SectionCard>

          {seen.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-[12.5px] text-muted-foreground">
              <CheckCircle2 className="size-4 shrink-0 text-success" />
              {seen.length} patient{seen.length > 1 ? 's' : ''} completed today:
              {seen.map((a) => (
                <Badge key={a.id} variant="outline">
                  {a.patientName}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
