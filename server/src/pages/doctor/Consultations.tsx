import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Stethoscope } from 'lucide-react'
import type { Appointment } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status'
import { InitialsAvatar } from '@/components/ui/misc'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listAppointments, todayIso } from '@/services/appointmentService'
import { to12Hour } from '@/lib/utils'

export default function DoctorConsultations() {
  const navigate = useNavigate()
  const today = React.useMemo(() => todayIso(), [])

  // The signed-in clinician's own list — resolved from the token, not the name.
  const { data, loading, error, refetch } = useQuery(
    () => listAppointments({ date: today, limit: 200 }),
    [today],
  )

  const list = React.useMemo(
    () =>
      (data?.items ?? [])
        .filter((a) => a.status !== 'Cancelled' && a.status !== 'No Show')
        .sort((a, b) => a.time.localeCompare(b.time)),
    [data],
  )

  const queue = list.filter((a) => a.status === 'Waiting' || a.status === 'In Consultation')
  const done = list.filter((a) => a.status === 'Completed')

  const columns: Column<Appointment>[] = [
    {
      key: 'patient',
      header: 'Patient',
      primary: true,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          {row.patientInitials && (
            <InitialsAvatar
              initials={row.patientInitials}
              color={row.patientAvatarColor ?? ''}
              className="size-9"
            />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{row.patientName}</p>
            <p className="truncate text-[12px] text-muted-foreground">{row.department}</p>
          </div>
        </div>
      ),
      sortValue: (row) => row.patientName,
    },
    {
      key: 'time',
      header: 'Slot',
      cell: (row) => <span className="num">{to12Hour(row.time)}</span>,
      sortValue: (row) => row.time,
    },
    { key: 'type', header: 'Encounter', cell: (row) => row.type, sortValue: (row) => row.type },
    {
      key: 'notes',
      header: 'Context',
      cell: (row) => <span className="text-[12.5px] text-muted-foreground">{row.notes ?? '—'}</span>,
      hideOnCard: false,
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button
          size="sm"
          variant={row.status === 'Completed' ? 'outline' : 'default'}
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/doctor/consultations/${row.patientId}`)
          }}
        >
          {row.status === 'Completed' ? 'View' : 'Start'}
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Consultations"
        description="Start a new encounter or revisit one you have already recorded today."
        crumbs={[{ label: 'Doctor', to: '/doctor/dashboard' }, { label: 'Consultations' }]}
      />

      {error && (
        <ErrorState title="Could not load your consultations" message={error} onRetry={refetch} className="mb-6" />
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="In the queue" value={loading ? '—' : queue.length} tone="warning" hint="Waiting or in consultation" />
        <StatTile label="Completed today" value={loading ? '—' : done.length} tone="success" />
        <StatTile label="Remaining" value={loading ? '—' : list.length - done.length} tone="info" />
      </div>

      <SectionCard
        title="Consultation queue"
        description="Patients checked in and waiting to be seen."
        className="mb-5"
        icon={<Stethoscope />}
      >
        {loading ? (
          <LoadingState label="Loading the queue" className="border-0 shadow-none" />
        ) : (
          <DataTable
            columns={columns}
            rows={queue}
            rowKey={(row) => row.id}
            emptyTitle="Queue is clear"
            emptyDescription="Nobody is waiting right now. Patients appear here as reception checks them in."
          />
        )}
      </SectionCard>

      <SectionCard title="Rest of today" description="Scheduled and completed encounters.">
        {loading ? (
          <LoadingState label="Loading today's list" className="border-0 shadow-none" />
        ) : (
          <DataTable
            columns={columns}
            rows={list.filter((a) => !queue.includes(a))}
            rowKey={(row) => row.id}
            initialSort={{ key: 'time', dir: 'asc' }}
            emptyTitle="Nothing else scheduled"
            emptyDescription="Your clinic list for today is complete."
          />
        )}
      </SectionCard>
    </>
  )
}
