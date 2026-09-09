import * as React from 'react'
import { Link } from 'react-router-dom'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { RehabProgressChart } from '@/components/charts/RehabProgressChart'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { Button } from '@/components/ui/button'
import { InitialsAvatar, Progress as ProgressBar } from '@/components/ui/misc'
import { StatusBadge } from '@/components/ui/status'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { myCaseload, planProgress } from '@/services/rehabService'
import { cn, formatDate } from '@/lib/utils'

export default function TherapistProgress() {
  const { data, loading, error, refetch } = useQuery(() => myCaseload(), [])
  const caseload = React.useMemo(() => data ?? [], [data])

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  // Settle on the first plan once the caseload arrives, without overriding a
  // choice the therapist has already made.
  const selected = caseload.find((c) => c.planId === selectedId) ?? caseload[0]

  const { data: progress, loading: loadingProgress } = useQuery(
    () => planProgress(selected!.planId),
    [selected?.planId],
    { enabled: Boolean(selected) },
  )

  const points = progress?.progress ?? []
  const first = points.at(0)
  const last = points.at(-1)

  // The comparison chart needs the latest scores per patient, which the caseload
  // does not carry — so it is built from the plans already loaded here.
  const comparison = React.useMemo(
    () =>
      caseload
        .filter((c) => c.completedSessions > 0)
        .map((c) => ({
          name: c.patientName.split(' ')[0],
          progress: c.progressPercentage,
          adherence: c.adherenceRate === null ? 0 : Math.round(c.adherenceRate),
        })),
    [caseload],
  )

  return (
    <>
      <PageHeader
        title="Progress tracking"
        description="Week-by-week movement in pain, mobility and strength across your caseload."
        crumbs={[{ label: 'Therapist', to: '/therapist/dashboard' }, { label: 'Progress Tracking' }]}
      />

      {error && (
        <ErrorState title="Could not load your caseload" message={error} onRetry={refetch} className="mb-6" />
      )}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <SectionCard
          title="Caseload"
          description={loading ? 'Loading…' : `${caseload.length} active plans.`}
          bodyClassName="p-2"
        >
          {loading ? (
            <LoadingState label="Loading" className="border-0 shadow-none" />
          ) : caseload.length === 0 ? (
            <p className="px-2 py-8 text-center text-[13px] text-muted-foreground">
              No active rehabilitation plans are assigned to you.
            </p>
          ) : (
            <ul className="space-y-1">
              {caseload.map((entry) => {
                const isActive = entry.planId === selected?.planId
                return (
                  <li key={entry.planId}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(entry.planId)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors',
                        isActive ? 'bg-accent/10' : 'hover:bg-muted',
                      )}
                    >
                      <InitialsAvatar initials={entry.initials} color={entry.avatarColor} className="size-9" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{entry.patientName}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {entry.progressPercentage}% · {entry.trend}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>

        <div className="space-y-5">
          {selected && (
            <>
              <SectionCard
                title={selected.patientName}
                description={selected.planTitle}
                action={<StatusBadge status={selected.trend} />}
                viewAllHref={`/patients/${selected.patientId}`}
                viewAllLabel="Open record"
              >
                <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatTile
                    label="Overall progress"
                    value={`${selected.progressPercentage}%`}
                    hint={`${selected.completedSessions} of ${selected.totalSessions} sessions`}
                    tone="accent"
                  />
                  <StatTile
                    label="Pain score"
                    value={last ? `${last.pain} / 10` : '—'}
                    hint={first && last ? `${last.pain < first.pain ? 'Down' : 'Up'} from ${first.pain}` : 'No reviews yet'}
                    tone={first && last && last.pain < first.pain ? 'success' : 'warning'}
                  />
                  <StatTile
                    label="Mobility"
                    value={last ? last.mobility : '—'}
                    hint={
                      first && last
                        ? `${last.mobility - first.mobility >= 0 ? '+' : ''}${last.mobility - first.mobility} since week 1`
                        : 'No reviews yet'
                    }
                    tone="info"
                  />
                  <StatTile
                    label="Strength"
                    value={last ? last.strength : '—'}
                    hint={
                      first && last
                        ? `${last.strength - first.strength >= 0 ? '+' : ''}${last.strength - first.strength} since week 1`
                        : 'No reviews yet'
                    }
                    tone="info"
                  />
                </div>

                {loadingProgress ? (
                  <LoadingState label="Loading progress" className="border-0 shadow-none" />
                ) : points.length === 0 ? (
                  <p className="py-12 text-center text-[13px] text-muted-foreground">
                    No weekly reviews recorded for this plan yet.
                  </p>
                ) : (
                  <RehabProgressChart data={points} height={320} />
                )}
              </SectionCard>

              <div className="grid gap-5 xl:grid-cols-2">
                <SectionCard title="Sessions" description="Scores recorded at each delivered session." delay={0.05}>
                  {(progress?.sessions ?? []).length === 0 ? (
                    <p className="py-10 text-center text-[13px] text-muted-foreground">
                      No completed sessions yet.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {(progress?.sessions ?? [])
                        .slice(-6)
                        .reverse()
                        .map((s) => (
                          <li
                            key={s.sessionId}
                            className="flex items-start gap-3 rounded-lg border border-border px-3.5 py-3"
                          >
                            <span className="num mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-[11.5px] font-bold">
                              {s.sequence}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-medium">{formatDate(s.date)}</p>
                              <p className="num mt-0.5 text-[11.5px] text-muted-foreground">
                                {s.painBefore !== null && s.painAfter !== null
                                  ? `Pain ${s.painBefore} → ${s.painAfter}`
                                  : 'Pain not recorded'}
                                {s.mobility !== null && ` · mobility ${s.mobility}`}
                                {s.strength !== null && ` · strength ${s.strength}`}
                              </p>
                            </div>
                            {s.painBefore !== null && s.painAfter !== null && s.painAfter < s.painBefore ? (
                              <TrendingDown className="size-4 shrink-0 text-success" />
                            ) : (
                              <TrendingUp className="size-4 shrink-0 text-muted-foreground/50" />
                            )}
                          </li>
                        ))}
                    </ul>
                  )}
                </SectionCard>

                <SectionCard title="Adherence" description="Attendance and home-programme compliance." delay={0.1}>
                  <div className="space-y-5">
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-[13px] font-medium">Session attendance</span>
                        <span className="num text-[13px] font-semibold">
                          {selected.attendanceRate !== null ? `${Math.round(selected.attendanceRate)}%` : '—'}
                        </span>
                      </div>
                      <ProgressBar
                        value={selected.attendanceRate ?? 0}
                        tone={(selected.attendanceRate ?? 0) >= 85 ? 'success' : 'warning'}
                      />
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-[13px] font-medium">Treatment adherence</span>
                        <span className="num text-[13px] font-semibold">
                          {selected.adherenceRate !== null ? `${Math.round(selected.adherenceRate)}%` : '—'}
                        </span>
                      </div>
                      <ProgressBar
                        value={selected.adherenceRate ?? 0}
                        tone={(selected.adherenceRate ?? 0) >= 85 ? 'success' : 'warning'}
                      />
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-[13px] font-medium">Plan completion</span>
                        <span className="num text-[13px] font-semibold">{selected.progressPercentage}%</span>
                      </div>
                      <ProgressBar value={selected.progressPercentage} tone="accent" />
                    </div>
                  </div>

                  {selected.nextSessionDate && (
                    <div className="mt-6 rounded-lg bg-muted/50 px-3.5 py-3">
                      <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Next session
                      </p>
                      <p className="mt-1.5 text-[13px] leading-relaxed">
                        {formatDate(selected.nextSessionDate)}
                      </p>
                    </div>
                  )}

                  <Button asChild variant="outline" className="mt-4 w-full">
                    <Link to={`/patients/${selected.patientId}`}>View full rehabilitation record</Link>
                  </Button>
                </SectionCard>
              </div>
            </>
          )}

          <SectionCard
            title="Caseload comparison"
            description="Plan completion and adherence side by side."
            delay={0.15}
          >
            {loading ? (
              <LoadingState label="Loading" className="border-0 shadow-none" />
            ) : comparison.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-muted-foreground">
                No delivered sessions to compare yet.
              </p>
            ) : (
              <BarSeriesChart
                data={comparison}
                xKey="name"
                series={[
                  { key: 'progress', name: 'Completion %', color: 'chart-1' },
                  { key: 'adherence', name: 'Adherence %', color: 'chart-3' },
                ]}
                height={260}
              />
            )}
          </SectionCard>
        </div>
      </div>
    </>
  )
}
