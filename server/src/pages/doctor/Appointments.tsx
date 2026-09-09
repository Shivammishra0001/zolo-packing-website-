import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import type { Appointment, AppointmentStatus } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { AppointmentTimeline } from '@/components/appointments/AppointmentTimeline'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/ui/status'
import { InitialsAvatar } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listAppointments, todayIso } from '@/services/appointmentService'
import { formatDate, to12Hour } from '@/lib/utils'

export default function DoctorAppointments() {
  const navigate = useNavigate()
  const [tab, setTab] = React.useState('today')
  const todayDate = React.useMemo(() => todayIso(), [])

  // Scope defaults to the signed-in clinician's own diary — the backend
  // resolves that from the token, never from a name sent by the browser.
  const { data, loading, error, refetch } = useQuery(
    () => listAppointments({ limit: 200 }),
    [],
  )

  const all = React.useMemo(
    () =>
      [...(data?.items ?? [])].sort(
        (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
      ),
    [data],
  )
  const today = all.filter((a) => a.date === todayDate)
  const upcoming = all.filter((a) => a.date > todayDate)

  const columns: Column<Appointment>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (row) => (
        <div>
          <p className="num font-medium">{to12Hour(row.time)}</p>
          <p className="text-[11.5px] text-muted-foreground">{formatDate(row.date)}</p>
        </div>
      ),
      sortValue: (row) => `${row.date}${row.time}`,
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
              <p className="num truncate text-[11.5px] text-muted-foreground">
                {row.patientId} · {row.patientAge} yrs
              </p>
            </div>
          </div>
        )
      },
      sortValue: (row) => row.patientName,
    },
    { key: 'type', header: 'Type', cell: (row) => row.type, sortValue: (row) => row.type },
    {
      key: 'token',
      header: 'Token',
      align: 'center',
      cell: (row) => <span className="num text-muted-foreground">#{String(row.tokenNumber).padStart(2, '0')}</span>,
      sortValue: (row) => row.tokenNumber,
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      cell: (row) => (
        <Button
          size="sm"
          variant={row.status === 'Waiting' ? 'default' : 'outline'}
          disabled={row.status === 'Cancelled'}
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/doctor/consultations/${row.patientId}`)
          }}
        >
          {row.status === 'Completed' ? 'View notes' : 'Consult'}
        </Button>
      ),
    },
  ]

  const counts = (list: Appointment[], status: AppointmentStatus) => list.filter((a) => a.status === status).length

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Your clinic schedule, with check-in status from the front desk."
        crumbs={[{ label: 'Doctor', to: '/doctor/dashboard' }, { label: 'Appointments' }]}
      />

      {error && <ErrorState title="Could not load your schedule" message={error} onRetry={refetch} className="mb-6" />}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Today" value={loading ? '—' : today.length} hint={`${counts(today, 'Completed')} completed`} />
        <StatTile
          label="Waiting now"
          value={loading ? '—' : counts(today, 'Waiting')}
          tone="warning"
          hint="Checked in at reception"
        />
        <StatTile label="In consultation" value={loading ? '—' : counts(today, 'In Consultation')} tone="info" />
        <StatTile label="Upcoming" value={loading ? '—' : upcoming.length} tone="accent" hint="Scheduled beyond today" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="today">Today ({today.length})</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="all">All ({all.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="today">
          <SectionCard title="Today's clinic" description={formatDate(todayDate)}>
            {loading ? (
              <LoadingState label="Loading your clinic" className="border-0 shadow-none" />
            ) : (
              <AppointmentTimeline appointments={today} linkTo={(a) => `/doctor/consultations/${a.patientId}`} />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="upcoming">
          <SectionCard title="Upcoming appointments" description="Everything booked after today.">
            <DataTable
              columns={columns}
              rows={upcoming}
              rowKey={(row) => row.id}
              onRowClick={(row) => navigate(`/patients/${row.patientId}`)}
              emptyTitle="No upcoming appointments"
              emptyDescription="New bookings made at the front desk will show up here."
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="all">
          <SectionCard title="All appointments" description="Sortable list across every date.">
            <DataTable
              columns={columns}
              rows={all}
              rowKey={(row) => row.id}
              initialSort={{ key: 'time', dir: 'asc' }}
              onRowClick={(row) => navigate(`/patients/${row.patientId}`)}
            />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </>
  )
}
