import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BedDouble, CalendarPlus, LogIn, Receipt, Search, UserPlus } from 'lucide-react'
import type { Appointment } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { GlobalSearch } from '@/components/layout/GlobalSearch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InitialsAvatar } from '@/components/ui/misc'
import { StatusBadge } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import {
  appointmentKey,
  checkIn as checkInAppointment,
  listAppointments,
  todayIso,
} from '@/services/appointmentService'
import { BED_SUMMARY, BEDS } from '@/data/operations'
import { cn, groupBy, to12Hour } from '@/lib/utils'

const QUICK_ACTIONS = [
  { label: 'Register Patient', detail: 'Walk-in or referral', to: '/reception/register', icon: UserPlus, tone: 'accent' },
  { label: 'Book Appointment', detail: 'Any doctor or therapist', to: '/appointments', icon: CalendarPlus, tone: 'info' },
  { label: 'Check In', detail: 'Move a patient into the queue', to: '/reception/queue', icon: LogIn, tone: 'warning' },
  { label: 'Search Patient', detail: 'Name, ID or phone', to: '/patients', icon: Search, tone: 'default' },
  { label: 'Create Invoice', detail: 'Consultation or package', to: '/billing/invoices', icon: Receipt, tone: 'success' },
]

const TONE_CLASS: Record<string, string> = {
  accent: 'bg-accent/10 text-accent',
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
  default: 'bg-muted text-muted-foreground',
}

export default function ReceptionDashboard() {
  const toast = useToast()
  const navigate = useNavigate()
  const today = React.useMemo(() => todayIso(), [])
  const [busy, setBusy] = React.useState<string | null>(null)

  // The whole clinic diary for today — the front desk works across clinicians.
  const { data, loading, error, refetch } = useQuery(
    () => listAppointments({ date: today, scope: 'branch', limit: 200 }),
    [today],
  )
  const appointments = data?.items ?? []

  async function checkIn(appointment: Appointment) {
    const key = appointmentKey(appointment)
    setBusy(key)
    try {
      await checkInAppointment(key)
      toast.success('Patient checked in', `${appointment.patientName} is now in ${appointment.doctor}'s queue.`)
      refetch()
    } catch (err) {
      toast.error('Check-in failed', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const queue = appointments
    .filter((a) => a.status === 'Waiting' || a.status === 'Scheduled')
    .sort((a, b) => a.time.localeCompare(b.time))

  const columns: Column<Appointment>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (row) => <span className="num font-medium">{to12Hour(row.time)}</span>,
      sortValue: (row) => row.time,
    },
    {
      key: 'patient',
      header: 'Patient',
      primary: true,
      cell: (row) => {
        return (
          <div className="flex items-center gap-2.5">
            {row.patientInitials && (
              <InitialsAvatar
                initials={row.patientInitials}
                color={row.patientAvatarColor ?? ''}
                className="size-8"
              />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium">{row.patientName}</p>
              <p className="num truncate text-[11.5px] text-muted-foreground">{row.patientId}</p>
            </div>
          </div>
        )
      },
      sortValue: (row) => row.patientName,
    },
    { key: 'doctor', header: 'Doctor', cell: (row) => row.doctor, sortValue: (row) => row.doctor },
    { key: 'type', header: 'Type', cell: (row) => row.type, sortValue: (row) => row.type },
    {
      key: 'checkin',
      header: 'Check-in',
      cell: (row) =>
        row.checkedInAt ? (
          <span className="num text-[12.5px] text-success">{to12Hour(row.checkedInAt)}</span>
        ) : row.status === 'Cancelled' ? (
          <span className="text-[12.5px] text-muted-foreground">—</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy === appointmentKey(row)}
            onClick={(e) => {
              e.stopPropagation()
              void checkIn(row)
            }}
          >
            <LogIn />
            Check in
          </Button>
        ),
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
  ]

  const bedsByWard = groupBy(BEDS, (b) => b.ward)

  return (
    <>
      <PageHeader
        title="Front desk"
        description={
          loading
            ? 'Loading today’s diary…'
            : `${appointments.length} appointments today · ${queue.length} patients still to be seen.`
        }
        crumbs={[{ label: 'Reception', to: '/reception/dashboard' }, { label: 'Dashboard' }]}
        actions={
          <Button asChild>
            <Link to="/reception/register">
              <UserPlus />
              Register patient
            </Link>
          </Button>
        }
      />

      {/* ------------------------------ Quick actions ----------------------------- */}
      <motion.ul
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <motion.li
              key={action.to}
              variants={{
                hidden: { opacity: 0, y: 10 },
                show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
              }}
            >
              <Link
                to={action.to}
                className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated"
              >
                <span className={cn('flex size-10 items-center justify-center rounded-lg', TONE_CLASS[action.tone])}>
                  <Icon className="size-[18px]" />
                </span>
                <span className="mt-3 text-[13.5px] font-semibold">{action.label}</span>
                <span className="mt-0.5 text-[12px] text-muted-foreground">{action.detail}</span>
              </Link>
            </motion.li>
          )
        })}
      </motion.ul>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Appointments today" value={appointments.length} />
        <StatTile
          label="Waiting"
          value={appointments.filter((a) => a.status === 'Waiting').length}
          tone="warning"
          hint="Checked in, not yet seen"
        />
        <StatTile
          label="Completed"
          value={appointments.filter((a) => a.status === 'Completed').length}
          tone="success"
        />
        <StatTile label="Beds available" value={BED_SUMMARY.available} tone="info" hint={`${BED_SUMMARY.total} total`} />
      </div>

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Today's appointments"
          description="Check patients in as they arrive."
          className="xl:col-span-2"
          viewAllHref="/appointments"
          delay={0.05}
        >
          {loading ? (
            <LoadingState label="Loading appointments" className="border-0 shadow-none" />
          ) : error ? (
            <ErrorState
              title="Could not load appointments"
              message={error}
              onRetry={refetch}
              className="border-0 shadow-none"
            />
          ) : (
            <DataTable
              columns={columns}
              rows={appointments}
              rowKey={(row) => row.id}
              initialSort={{ key: 'time', dir: 'asc' }}
              onRowClick={(row) => navigate(`/patients/${row.patientId}`)}
            />
          )}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Find a patient" description="Search by name, ID or phone number." delay={0.1}>
            <GlobalSearch />
          </SectionCard>

          <SectionCard
            title="Check-in queue"
            description="In arrival order."
            viewAllHref="/reception/queue"
            delay={0.15}
          >
            {queue.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">Everyone has been seen.</p>
            ) : (
              <ol className="space-y-2.5">
                {queue.slice(0, 5).map((appointment) => {
                  return (
                    <li
                      key={appointment.id}
                      className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-3"
                    >
                      <span className="num flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[12px] font-bold">
                        {String(appointment.tokenNumber).padStart(2, '0')}
                      </span>
                      {appointment.patientInitials && (
                        <InitialsAvatar
                          initials={appointment.patientInitials}
                          color={appointment.patientAvatarColor ?? ''}
                          className="size-8"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{appointment.patientName}</p>
                        <p className="num truncate text-[11.5px] text-muted-foreground">
                          {to12Hour(appointment.time)} · {appointment.doctor.replace('Dr. ', '')}
                        </p>
                      </div>
                      {appointment.status === 'Waiting' ? (
                        <Badge variant="warning" dot pulse>
                          Waiting
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy === appointmentKey(appointment)}
                          onClick={() => void checkIn(appointment)}
                        >
                          Check In
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Bed availability"
        description="Live position for admissions and enquiries."
        icon={<BedDouble />}
        viewAllHref="/beds"
      >
        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          <StatTile label="Available" value={BED_SUMMARY.available} tone="success" />
          <StatTile label="Occupied" value={BED_SUMMARY.occupied} tone="info" />
          <StatTile label="Reserved" value={BED_SUMMARY.reserved} tone="warning" />
          <StatTile label="Cleaning" value={BED_SUMMARY.cleaning} />
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(bedsByWard).map(([ward, beds]) => {
            const available = beds.filter((b) => b.status === 'Available').length
            return (
              <li key={ward} className="rounded-xl border border-border p-4">
                <p className="text-[13px] font-semibold">{ward}</p>
                <p className="num mt-2 text-2xl font-bold tracking-tight">
                  {available}
                  <span className="ml-1 text-[13px] font-medium text-muted-foreground">/ {beds.length} free</span>
                </p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  {beds.filter((b) => b.status === 'Occupied').length} occupied ·{' '}
                  {beds.filter((b) => b.status === 'Reserved').length} reserved
                </p>
              </li>
            )
          })}
        </ul>
      </SectionCard>
    </>
  )
}
