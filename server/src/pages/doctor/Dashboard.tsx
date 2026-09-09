import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Stethoscope, Timer } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { AlertList } from '@/components/dashboard/AlertList'
import { AppointmentTimeline } from '@/components/appointments/AppointmentTimeline'
import { GlobalSearch } from '@/components/layout/GlobalSearch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InitialsAvatar, Progress } from '@/components/ui/misc'
import { StatusBadge } from '@/components/ui/status'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listAppointments, todayIso } from '@/services/appointmentService'
import { getPatient } from '@/services/patientService'
import { listDueFollowUps } from '@/services/consultationService'
import { listLabs } from '@/services/labService'
import { listPrescriptions } from '@/services/prescriptionService'
// Rehabilitation plans are still mock-backed — that module lands in a later step.
import { PATIENTS, rehabCompletion } from '@/data/patients'
import { useAuth } from '@/context/AuthContext'
import { to12Hour } from '@/lib/utils'

export default function DoctorDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const doctorName = user?.name ?? 'Dr. Arjun Sharma'

  const today = React.useMemo(() => todayIso(), [])

  // The doctor's own list for today. The backend derives "own" from the signed-in
  // user, so the browser cannot ask for somebody else's diary.
  const { data, loading, error, refetch } = useQuery(
    () => listAppointments({ date: today, limit: 200 }),
    [today],
  )
  const appointments = React.useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => a.time.localeCompare(b.time)),
    [data],
  )

  const completed = appointments.filter((a) => a.status === 'Completed').length
  const inConsultation = appointments.find((a) => a.status === 'In Consultation')
  const next = appointments.find((a) => a.status === 'Waiting') ?? appointments.find((a) => a.status === 'Scheduled')

  // The full record for the banner — the appointment row carries the avatar and
  // name, but not the presenting condition.
  const { data: nextPatient } = useQuery(() => getPatient(next!.patientId), [next?.patientId], {
    enabled: Boolean(next),
  })

  /* ------------------------------ Pending items ------------------------------ */
  // Every count below is derived from a real query. Modules that do not exist
  // yet contribute nothing rather than a placeholder — the rehabilitation entry
  // that used to sit here returns when that module lands.
  const { data: labPage } = useQuery(() => listLabs({ reviewed: false, limit: 200 }), [])
  const { data: followUps } = useQuery(() => listDueFollowUps(), [])
  const { data: rxPage } = useQuery(() => listPrescriptions({ status: 'Pending', limit: 200 }), [])

  const pending = React.useMemo(() => {
    const items: {
      id: string
      title: string
      detail: string
      href: string
      severity: 'critical' | 'warning' | 'info'
    }[] = []

    const labs = labPage?.items ?? []
    if (labs.length) {
      const critical = labs.filter((l) => l.flag === 'Critical').length
      items.push({
        id: 'labs',
        title: `${labs.length} lab result${labs.length > 1 ? 's' : ''} awaiting review`,
        detail: critical
          ? `${critical} flagged critical · ${labs.slice(0, 3).map((l) => l.patientName).join(', ')}`
          : labs.slice(0, 4).map((l) => l.patientName).join(', '),
        href: '/doctor/labs',
        severity: critical ? 'critical' : 'info',
      })
    }

    const due = followUps ?? []
    if (due.length) {
      const overdue = due.filter((f) => f.followUpDate && f.followUpDate < today)
      items.push({
        id: 'follow-ups',
        title: `${due.length} patient${due.length > 1 ? 's' : ''} due for follow-up`,
        detail: overdue.length
          ? `${overdue[0].patientName} is overdue since ${overdue[0].followUpDate}`
          : due.slice(0, 3).map((f) => f.patientName).join(', '),
        href: '/doctor/appointments',
        severity: overdue.length ? 'warning' : 'info',
      })
    }

    const rx = rxPage?.items ?? []
    if (rx.length) {
      items.push({
        id: 'prescriptions',
        title: `${rx.length} prescription${rx.length > 1 ? 's' : ''} awaiting dispensing`,
        detail: rx.slice(0, 3).map((p) => p.patientName).join(', '),
        href: '/doctor/prescriptions',
        severity: 'info',
      })
    }

    return items
  }, [labPage, followUps, rxPage, today])

  const myPlans = PATIENTS.filter((p) => p.assignedDoctor === doctorName && p.rehabPlan).slice(0, 4)

  return (
    <>
      <PageHeader
        title={`Good morning, ${doctorName.replace('Dr. ', '').split(' ')[0]}`}
        description={
          loading
            ? 'Loading your clinic list…'
            : `You have ${appointments.length} appointments today — ${completed} completed, ${
                appointments.length - completed
              } remaining.`
        }
        crumbs={[{ label: 'Doctor', to: '/doctor/dashboard' }, { label: 'Dashboard' }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/doctor/appointments">
                <CalendarClock />
                Full schedule
              </Link>
            </Button>
            <Button asChild>
              <Link to="/doctor/consultations">
                <Stethoscope />
                Consultations
              </Link>
            </Button>
          </>
        }
      />

      {/* ------------------------------ Next patient ----------------------------- */}
      {next && nextPatient && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="mb-6 overflow-hidden rounded-xl border border-accent/25 bg-gradient-to-br from-accent/[0.09] via-card to-card shadow-card"
        >
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex min-w-0 items-center gap-4">
              <InitialsAvatar
                initials={nextPatient.initials}
                color={nextPatient.avatarColor}
                className="size-14 text-base"
              />
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-accent">
                  <Timer className="size-3.5" />
                  Next patient
                </p>
                <h2 className="mt-1 truncate text-xl font-bold tracking-tight">{nextPatient.name}</h2>
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {nextPatient.id} · {nextPatient.age} yrs · {nextPatient.primaryCondition}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
              <div className="text-left sm:text-right">
                <p className="num text-2xl font-bold tracking-tight">{to12Hour(next.time)}</p>
                <p className="text-[12px] text-muted-foreground">
                  {next.type} · <StatusBadge status={next.status} className="ml-1 align-middle" />
                </p>
              </div>
              <Button size="lg" onClick={() => navigate(`/doctor/consultations/${nextPatient.id}`)}>
                Open Consultation
                <ArrowRight />
              </Button>
            </div>
          </div>

          {inConsultation && (
            <div className="flex items-center gap-2 border-t border-accent/20 bg-info/[0.06] px-5 py-2.5 sm:px-6">
              <Badge variant="info" dot pulse>
                In consultation
              </Badge>
              <p className="truncate text-[12.5px] text-muted-foreground">
                {inConsultation.patientName} started at {to12Hour(inConsultation.time)} — finish before calling the next
                patient.
              </p>
            </div>
          )}
        </motion.div>
      )}

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Today's appointments"
          description="Your clinic list in chronological order."
          className="xl:col-span-2"
          viewAllHref="/doctor/appointments"
          delay={0.05}
        >
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            <StatTile label="Total" value={loading ? '—' : appointments.length} />
            <StatTile label="Completed" value={loading ? '—' : completed} tone="success" />
            <StatTile
              label="Waiting"
              value={loading ? '—' : appointments.filter((a) => a.status === 'Waiting').length}
              tone="warning"
            />
            <StatTile
              label="Scheduled"
              value={loading ? '—' : appointments.filter((a) => a.status === 'Scheduled').length}
              tone="info"
            />
          </div>
          {loading ? (
            <LoadingState label="Loading your clinic list" className="border-0 shadow-none" />
          ) : error ? (
            <ErrorState
              title="Could not load your appointments"
              message={error}
              onRetry={refetch}
              className="border-0 shadow-none"
            />
          ) : (
            <AppointmentTimeline
              appointments={appointments}
              linkTo={(a) => `/doctor/consultations/${a.patientId}`}
            />
          )}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Find a patient" description="Search by name, patient ID or phone number." delay={0.1}>
            <GlobalSearch />
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              Opening a result takes you to Patient 360 — history, rehab plan, vitals, prescriptions and billing in one
              record.
            </p>
          </SectionCard>

          <SectionCard title="Pending items" description="Things waiting on you." delay={0.15}>
            {pending.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <CheckCircle2 className="mb-2 size-7 text-success" />
                <p className="text-[13px] font-semibold">Nothing waiting on you</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  No labs to review, follow-ups due or prescriptions outstanding.
                </p>
              </div>
            ) : (
              <AlertList items={pending} />
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Rehabilitation plans under your care"
        description="Progress against plan for patients you are the treating physician for."
        viewAllHref="/rehab/plans"
      >
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {myPlans.map((patient, i) => {
            const plan = patient.rehabPlan!
            const pct = rehabCompletion(patient)
            return (
              <motion.li
                key={patient.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.06, duration: 0.3 }}
              >
                <Link
                  to={`/patients/${patient.id}`}
                  className="flex h-full flex-col rounded-xl border border-border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated"
                >
                  <div className="flex items-start justify-between gap-2">
                    <InitialsAvatar initials={patient.initials} color={patient.avatarColor} className="size-9" />
                    <StatusBadge status={plan.trend} />
                  </div>
                  <p className="mt-3 truncate text-[13.5px] font-semibold">{patient.name}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">{plan.title}</p>

                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="num text-lg font-bold">{pct}%</span>
                    <span className="num text-[11.5px] text-muted-foreground">
                      {plan.completedSessions} / {plan.totalSessions}
                    </span>
                  </div>
                  <Progress
                    value={pct}
                    className="mt-1.5 h-1.5"
                    tone={plan.trend === 'At Risk' ? 'danger' : plan.trend === 'Plateaued' ? 'warning' : 'accent'}
                  />
                </Link>
              </motion.li>
            )
          })}
        </ul>

        {myPlans.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center">
            <CheckCircle2 className="mb-2 size-8 text-success" />
            <p className="text-sm font-semibold">No active rehabilitation plans</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Plans you create from a consultation will appear here.
            </p>
          </div>
        )}
      </SectionCard>

      <div className="mt-5 flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-[12.5px] text-muted-foreground">
        <ClipboardList className="size-4 shrink-0" />
        Tip: press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px]">Ctrl</kbd> +{' '}
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px]">K</kbd> anywhere to jump
        straight to a patient record.
      </div>
    </>
  )
}
