import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { InitialsAvatar } from '@/components/ui/misc'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listSessions, sessionKey, type TherapySessionRecord } from '@/services/therapyService'
import { todayIso } from '@/services/appointmentService'
import { to12Hour } from '@/lib/utils'

export default function TherapistSessions() {
  const navigate = useNavigate()
  const [tab, setTab] = React.useState('mine')
  const today = React.useMemo(() => todayIso(), [])

  // The therapist's own diary. "Own" is resolved from the token, so the browser
  // never asks for somebody else's list.
  const { data, loading, error, refetch } = useQuery(
    () => listSessions({ date: today, limit: 200 }),
    [today],
  )
  const mine = React.useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => a.time.localeCompare(b.time)),
    [data],
  )

  // The department view is a broader permission this role does not hold, so the
  // request is made honestly and the refusal is shown rather than hidden.
  const {
    data: everyone,
    loading: loadingAll,
    error: allError,
  } = useQuery(() => listSessions({ date: today, scope: 'all', limit: 200 }), [today], {
    enabled: tab === 'all',
  })
  const all = React.useMemo(
    () => [...(everyone?.items ?? [])].sort((a, b) => a.time.localeCompare(b.time)),
    [everyone],
  )

  const columns: Column<TherapySessionRecord>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (row) => (
        <div>
          <p className="num font-medium">{row.time ? to12Hour(row.time) : '—'}</p>
          <p className="num text-[11.5px] text-muted-foreground">{row.durationMinutes ?? '—'} min</p>
        </div>
      ),
      sortValue: (row) => row.time,
    },
    {
      key: 'patient',
      header: 'Patient',
      primary: true,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <InitialsAvatar initials={row.patientInitials} color={row.patientAvatarColor} className="size-8" />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.patientName}</p>
            <p className="num truncate text-[11.5px] text-muted-foreground">{row.patientId}</p>
          </div>
        </div>
      ),
      sortValue: (row) => row.patientName,
    },
    {
      key: 'type',
      header: 'Therapy',
      cell: (row) => <Badge variant="accent">{row.type}</Badge>,
      sortValue: (row) => row.type,
    },
    { key: 'room', header: 'Room', cell: (row) => row.room, sortValue: (row) => row.room },
    {
      key: 'therapist',
      header: 'Therapist',
      cell: (row) => <span className="text-[12.5px] text-muted-foreground">{row.therapist}</span>,
      sortValue: (row) => row.therapist,
      hideOnCard: true,
    },
    {
      key: 'scores',
      header: 'Scores',
      cell: (row) =>
        row.status === 'Completed' && row.painBefore !== null ? (
          <span className="num text-[12.5px]">
            Pain {row.painBefore} → {row.painAfter} · Mob {row.mobilityScore}
          </span>
        ) : (
          <span className="text-[12.5px] text-muted-foreground">Not recorded</span>
        ),
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
            navigate(`/therapist/sessions/${sessionKey(row)}`)
          }}
        >
          {row.status === 'Completed' ? 'View' : row.status === 'Missed' ? 'Reschedule' : 'Record'}
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Therapy sessions"
        description="Today's therapy schedule across every room and discipline."
        crumbs={[{ label: 'Therapist', to: '/therapist/dashboard' }, { label: 'My Sessions' }]}
      />

      {error && (
        <ErrorState title="Could not load your sessions" message={error} onRetry={refetch} className="mb-6" />
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="My sessions" value={loading ? '—' : mine.length} hint="Assigned to you today" />
        <StatTile
          label="Completed"
          value={loading ? '—' : mine.filter((s) => s.status === 'Completed').length}
          tone="success"
        />
        <StatTile
          label="Remaining"
          value={loading ? '—' : mine.filter((s) => s.status === 'Scheduled' || s.status === 'In Progress').length}
          tone="info"
        />
        <StatTile
          label="Missed"
          value={loading ? '—' : mine.filter((s) => s.status === 'Missed').length}
          tone={mine.some((s) => s.status === 'Missed') ? 'danger' : 'neutral'}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mine">My sessions ({mine.length})</TabsTrigger>
          <TabsTrigger value="all">All therapists</TabsTrigger>
        </TabsList>

        <TabsContent value="mine">
          <SectionCard title="Your list" description="Select a session to record the entry.">
            {loading ? (
              <LoadingState label="Loading your sessions" className="border-0 shadow-none" />
            ) : (
              <DataTable
                columns={columns.filter((c) => c.key !== 'therapist')}
                rows={mine}
                rowKey={(row) => row.id}
                onRowClick={(row) => navigate(`/therapist/sessions/${sessionKey(row)}`)}
                initialSort={{ key: 'time', dir: 'asc' }}
                emptyTitle="No sessions assigned"
                emptyDescription="Sessions booked for you appear here on the day."
              />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="all">
          <SectionCard title="Department schedule" description="Every therapy session running today.">
            {loadingAll ? (
              <LoadingState label="Loading the department schedule" className="border-0 shadow-none" />
            ) : allError ? (
              // The API refuses a therapist the whole department's diary. Shown
              // rather than quietly falling back to their own list, which would
              // misrepresent what they are looking at.
              <div className="flex flex-col items-center py-14 text-center">
                <Lock className="mb-3 size-8 text-muted-foreground" />
                <p className="text-sm font-semibold">Department schedule is restricted</p>
                <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
                  Your role can see the sessions assigned to you. {allError}
                </p>
              </div>
            ) : (
              <DataTable
                columns={columns}
                rows={all}
                rowKey={(row) => row.id}
                onRowClick={(row) => navigate(`/therapist/sessions/${sessionKey(row)}`)}
                initialSort={{ key: 'time', dir: 'asc' }}
                emptyTitle="Nothing scheduled today"
                emptyDescription="Therapy sessions booked for today appear here."
              />
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </>
  )
}
