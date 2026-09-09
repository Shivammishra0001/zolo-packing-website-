import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Dumbbell } from 'lucide-react'
import type { RehabTrend } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { InitialsAvatar, Progress } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listPlans, type RehabPlanRecord } from '@/services/rehabService'
import { formatDate } from '@/lib/utils'

const TRENDS: (RehabTrend | 'All')[] = ['All', 'On Track', 'Ahead of Plan', 'Plateaued', 'At Risk', 'Completed']

/** Averages a numeric field across plans, ignoring the ones with no value yet. */
function average(rows: RehabPlanRecord[], pick: (row: RehabPlanRecord) => number | null): number {
  const values = rows.map(pick).filter((v): v is number => v !== null)
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
}

export default function RehabPlans() {
  const navigate = useNavigate()
  const [trend, setTrend] = React.useState<(typeof TRENDS)[number]>('All')

  // A therapist gets their own caseload; a doctor, admin or owner gets the
  // branch. That narrowing happens server-side, not here.
  const { data, loading, error, refetch } = useQuery(() => listPlans({ limit: 200 }), [])
  const withPlans = data?.items ?? []
  const filtered = trend === 'All' ? withPlans : withPlans.filter((p) => p.trend === trend)

  const trendCounts = (['On Track', 'Ahead of Plan', 'Plateaued', 'At Risk', 'Completed'] as RehabTrend[]).map((t) => ({
    trend: t,
    count: withPlans.filter((p) => p.trend === t).length,
  }))

  const columns: Column<RehabPlanRecord>[] = [
    {
      key: 'patient',
      header: 'Patient',
      primary: true,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <InitialsAvatar initials={row.patientInitials} color={row.patientAvatarColor} className="size-9" />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.patientName}</p>
            <p className="num truncate text-[11.5px] text-muted-foreground">{row.patientId}</p>
          </div>
        </div>
      ),
      sortValue: (row) => row.patientName,
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px]">{row.title}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">with {row.primaryTherapist}</p>
        </div>
      ),
      sortValue: (row) => row.title,
    },
    {
      key: 'progress',
      header: 'Progress',
      className: 'w-[170px]',
      cell: (row) => (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="num text-[13px] font-semibold">{row.progressPercentage}%</span>
            <span className="num text-[11px] text-muted-foreground">
              {row.completedSessions}/{row.totalSessions}
            </span>
          </div>
          <Progress
            value={row.progressPercentage}
            className="h-1.5"
            tone={
              row.trend === 'At Risk'
                ? 'danger'
                : row.trend === 'Plateaued'
                  ? 'warning'
                  : row.trend === 'Completed'
                    ? 'success'
                    : 'accent'
            }
          />
        </div>
      ),
      sortValue: (row) => row.progressPercentage,
    },
    {
      key: 'attendance',
      header: 'Attendance',
      align: 'right',
      cell: (row) =>
        row.attendanceRate === null ? (
          <span className="text-[12.5px] text-muted-foreground">—</span>
        ) : (
          <span className={`num ${row.attendanceRate < 80 ? 'font-semibold text-warning' : ''}`}>
            {Math.round(row.attendanceRate)}%
          </span>
        ),
      sortValue: (row) => row.attendanceRate ?? -1,
    },
    {
      key: 'adherence',
      header: 'Adherence',
      align: 'right',
      cell: (row) =>
        row.adherenceRate === null ? (
          <span className="text-[12.5px] text-muted-foreground">—</span>
        ) : (
          <span className={`num ${row.adherenceRate < 70 ? 'font-semibold text-destructive' : ''}`}>
            {Math.round(row.adherenceRate)}%
          </span>
        ),
      sortValue: (row) => row.adherenceRate ?? -1,
    },
    {
      key: 'target',
      header: 'Target end',
      cell: (row) => (row.targetEndDate ? formatDate(row.targetEndDate) : '—'),
      sortValue: (row) => row.targetEndDate ?? '',
    },
    { key: 'trend', header: 'Trend', meta: true, cell: (row) => <StatusBadge status={row.trend} /> },
  ]

  const needsReview = withPlans.filter((p) => p.trend === 'At Risk' || p.trend === 'Plateaued')
  const active = withPlans.filter((p) => p.trend !== 'Completed')

  return (
    <>
      <PageHeader
        title="Rehabilitation plans"
        description="Every active programme, how far along it is, and which ones need a clinical review."
        crumbs={[{ label: 'Rehab Plans' }]}
        actions={
          <Select value={trend} onValueChange={(v) => setTrend(v as (typeof TRENDS)[number])}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRENDS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {error && (
        <ErrorState
          title="Could not load rehabilitation plans"
          message={error}
          onRetry={refetch}
          className="mb-6"
        />
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active plans" value={loading ? '—' : active.length} />
        <StatTile
          label="On or ahead of track"
          value={loading ? '—' : withPlans.filter((p) => ['On Track', 'Ahead of Plan'].includes(p.trend)).length}
          tone="success"
        />
        <StatTile
          label="Needs review"
          value={loading ? '—' : needsReview.length}
          tone="warning"
          hint="Plateaued or at risk"
        />
        <StatTile
          label="Completed"
          value={loading ? '—' : withPlans.filter((p) => p.trend === 'Completed').length}
          tone="accent"
        />
      </div>

      {needsReview.length > 0 && (
        <SectionCard
          title="Plans needing review"
          description="Progress has stalled or attendance has slipped on these programmes."
          className="mb-5"
        >
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {needsReview.map((plan) => (
              <li key={plan.id}>
                <Link
                  to={`/patients/${plan.patientId}`}
                  className="flex h-full flex-col rounded-xl border border-warning/30 bg-warning/[0.05] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevated"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <InitialsAvatar
                        initials={plan.patientInitials}
                        color={plan.patientAvatarColor}
                        className="size-9"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold">{plan.patientName}</p>
                        <p className="truncate text-[11.5px] text-muted-foreground">{plan.primaryTherapist}</p>
                      </div>
                    </div>
                    <StatusBadge status={plan.trend} />
                  </div>

                  <p className="mt-3 text-[12.5px] text-muted-foreground">
                    {plan.progressPercentage}% complete
                    {plan.attendanceRate !== null && ` · attendance ${Math.round(plan.attendanceRate)}%`}
                    {plan.adherenceRate !== null && ` · adherence ${Math.round(plan.adherenceRate)}%`}
                  </p>
                  <Progress
                    value={plan.progressPercentage}
                    className="mt-2 h-1.5"
                    tone={plan.trend === 'At Risk' ? 'danger' : 'warning'}
                  />

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {plan.modalities.slice(0, 2).map((m) => (
                      <Badge key={m} variant="outline">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <SectionCard title="Plans by trend" description="Distribution across the caseload." className="xl:col-span-2">
          {loading ? (
            <LoadingState label="Loading plans" className="border-0 shadow-none" />
          ) : (
            <BarSeriesChart
              data={trendCounts}
              xKey="trend"
              layout="vertical"
              series={[{ key: 'count', name: 'Plans', color: 'chart-1' }]}
              height={220}
              showLegend={false}
            />
          )}
        </SectionCard>

        <SectionCard title="Average progress" description="Across all active plans." delay={0.05}>
          {active.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              {loading ? 'Loading…' : 'No active plans to average.'}
            </p>
          ) : (
            <div className="space-y-5">
              {[
                { label: 'Plan completion', value: average(active, (p) => p.progressPercentage), tone: 'accent' as const },
                { label: 'Session attendance', value: average(active, (p) => p.attendanceRate), tone: 'success' as const },
                { label: 'Treatment adherence', value: average(active, (p) => p.adherenceRate), tone: 'info' as const },
              ].map((row) => (
                <div key={row.label}>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-[13px] font-medium">{row.label}</span>
                    <span className="num text-[13px] font-semibold">{row.value}%</span>
                  </div>
                  <Progress value={row.value} tone={row.tone} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="All rehabilitation plans"
        description={loading ? 'Loading…' : `${filtered.length} of ${withPlans.length} plans shown.`}
        icon={<Dumbbell />}
      >
        {loading ? (
          <LoadingState label="Loading rehabilitation plans" className="border-0 shadow-none" />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/patients/${row.patientId}`)}
            initialSort={{ key: 'progress', dir: 'desc' }}
            emptyTitle="No plans match this filter"
            emptyDescription="Try selecting a different trend."
            emptyAction={
              <Button variant="outline" onClick={() => setTrend('All')}>
                Show all plans
              </Button>
            }
          />
        )}
      </SectionCard>
    </>
  )
}
