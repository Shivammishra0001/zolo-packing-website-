import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, LayoutGrid, List, Search, UserPlus } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Patient, PatientStatus } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { InitialsAvatar, Progress, Skeleton } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { rehabCompletion } from '@/lib/rehab'
import { listPatients } from '@/services/patientService'
import { useDebounced, useQuery } from '@/hooks/useApi'
import { useAuth } from '@/context/AuthContext'
import { cn, formatDate } from '@/lib/utils'

const STATUSES: (PatientStatus | 'All')[] = [
  'All',
  'Active - OPD',
  'Admitted - IPD',
  'In Rehabilitation',
  'Discharge Pending',
  'Follow-up',
  'Discharged',
]

export default function Patients() {
  const navigate = useNavigate()
  const { user, has } = useAuth()
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>('All')
  const [scope, setScope] = React.useState<'all' | 'mine'>('all')
  const [view, setView] = React.useState<'grid' | 'table'>('grid')

  // Filtering, searching and paging all happen in PostgreSQL.
  const debouncedQuery = useDebounced(query, 250)
  const {
    data: page,
    loading,
    error,
    refetch,
  } = useQuery(
    () => listPatients({ search: debouncedQuery, status, scope, limit: 100 }),
    [debouncedQuery, status, scope],
  )

  const filtered = page?.items ?? []
  const total = page?.total ?? 0

  const columns: Column<Patient>[] = [
    {
      key: 'name',
      header: 'Patient',
      primary: true,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <InitialsAvatar initials={row.initials} color={row.avatarColor} className="size-9" />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="num truncate text-[11.5px] text-muted-foreground">
              {row.id} · {row.age} yrs · {row.gender}
            </p>
          </div>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: 'condition',
      header: 'Condition',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px]">{row.primaryCondition}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">{row.department}</p>
        </div>
      ),
      sortValue: (row) => row.primaryCondition,
    },
    { key: 'doctor', header: 'Doctor', cell: (row) => row.assignedDoctor, sortValue: (row) => row.assignedDoctor },
    {
      key: 'therapist',
      header: 'Therapist',
      cell: (row) => row.assignedTherapist,
      sortValue: (row) => row.assignedTherapist,
      hideOnCard: true,
    },
    {
      key: 'progress',
      header: 'Rehab',
      className: 'w-[150px]',
      cell: (row) =>
        row.rehabPlan ? (
          <div>
            <p className="num mb-1 text-[12px]">{rehabCompletion(row)}%</p>
            <Progress
              value={rehabCompletion(row)}
              className="h-1.5"
              tone={row.rehabPlan.trend === 'At Risk' ? 'danger' : row.rehabPlan.trend === 'Plateaued' ? 'warning' : 'accent'}
            />
          </div>
        ) : (
          <span className="text-[12.5px] text-muted-foreground">No plan</span>
        ),
      sortValue: (row) => rehabCompletion(row),
    },
    {
      key: 'lastVisit',
      header: 'Last visit',
      cell: (row) => formatDate(row.lastVisit),
      sortValue: (row) => row.lastVisit,
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
  ]

  return (
    <>
      <PageHeader
        title="Patients"
        description="Every patient record in the centre, searchable by name, ID, phone or condition."
        crumbs={[{ label: 'Patients' }]}
        actions={
          has('patient.create') && (
            <Button asChild>
              <Link to="/reception/register">
                <UserPlus />
                Register patient
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total patients" value={loading ? '—' : total} />
        <StatTile
          label="In rehabilitation"
          value={loading ? '—' : filtered.filter((p) => p.status === 'In Rehabilitation').length}
          tone="accent"
        />
        <StatTile
          label="Admitted"
          value={loading ? '—' : filtered.filter((p) => p.status === 'Admitted - IPD').length}
          tone="info"
        />
        <StatTile
          label="Follow-up"
          value={loading ? '—' : filtered.filter((p) => p.status === 'Follow-up').length}
          tone="warning"
        />
      </div>

      <SectionCard
        title="Patient directory"
        description={
          loading ? 'Loading…' : `${filtered.length} of ${total} patients shown.`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, ID or phone"
                className="h-8 w-52 pl-8 text-[13px]"
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as (typeof STATUSES)[number])}>
              <SelectTrigger className="h-8 w-44 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(user?.role === 'doctor' || user?.role === 'therapist' || user?.role === 'nurse') && (
              <Select value={scope} onValueChange={(v) => setScope(v as 'all' | 'mine')}>
                <SelectTrigger className="h-8 w-36 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All patients</SelectItem>
                  <SelectItem value="mine">My caseload</SelectItem>
                </SelectContent>
              </Select>
            )}
            <div className="flex overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setView('grid')}
                aria-label="Card view"
                className={cn(
                  'flex size-8 items-center justify-center transition-colors',
                  view === 'grid' ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setView('table')}
                aria-label="Table view"
                className={cn(
                  'flex size-8 items-center justify-center border-l border-border transition-colors',
                  view === 'table' ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <List className="size-4" />
              </button>
            </div>
          </div>
        }
        bodyClassName={view === 'grid' ? 'p-5' : 'p-5'}
      >
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-3 h-1.5 w-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-14 text-center">
            <AlertTriangle className="mb-3 size-8 text-destructive" />
            <p className="text-sm font-semibold">Could not load patients</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{error}</p>
            <Button variant="outline" className="mt-4" onClick={refetch}>
              Try again
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center">
            <Search className="mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-semibold">No patients match your filters</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              Try a shorter search term, or reset the status filter.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setQuery('')
                setStatus('All')
                setScope('all')
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : view === 'table' ? (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/patients/${row.id}`)}
            initialSort={{ key: 'name', dir: 'asc' }}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((patient, i) => (
              <motion.li
                key={patient.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.035, 0.3), duration: 0.28 }}
              >
                <Link
                  to={`/patients/${patient.id}`}
                  className="flex h-full flex-col rounded-xl border border-border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <InitialsAvatar initials={patient.initials} color={patient.avatarColor} className="size-10" />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold">{patient.name}</p>
                        <p className="num truncate text-[11.5px] text-muted-foreground">
                          {patient.id} · {patient.age} yrs
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={patient.status} showDot={false} />
                  </div>

                  <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                    {patient.primaryCondition}
                  </p>

                  {patient.rehabPlan ? (
                    <div className="mt-3">
                      <div className="mb-1 flex items-baseline justify-between">
                        <span className="num text-[13px] font-semibold">{rehabCompletion(patient)}%</span>
                        <span className="num text-[11px] text-muted-foreground">
                          {patient.rehabPlan.completedSessions}/{patient.rehabPlan.totalSessions}
                        </span>
                      </div>
                      <Progress
                        value={rehabCompletion(patient)}
                        className="h-1.5"
                        tone={
                          patient.rehabPlan.trend === 'At Risk'
                            ? 'danger'
                            : patient.rehabPlan.trend === 'Plateaued'
                              ? 'warning'
                              : 'accent'
                        }
                      />
                    </div>
                  ) : (
                    <p className="mt-3 text-[12px] text-muted-foreground">No rehabilitation plan</p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                    <Badge variant="outline">{patient.department}</Badge>
                    {patient.bed && <Badge variant="info">{patient.bed}</Badge>}
                    {patient.rehabPlan && <StatusBadge status={patient.rehabPlan.trend} showDot={false} />}
                  </div>
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  )
}
