import * as React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, CalendarClock, ClipboardCheck, HeartPulse, Timer, TrendingDown, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { AlertList } from '@/components/dashboard/AlertList'
import { RehabProgressChart } from '@/components/charts/RehabProgressChart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InitialsAvatar, Progress } from '@/components/ui/misc'
import { StatusBadge } from '@/components/ui/status'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { todayIso } from '@/services/appointmentService'
import { listSessions, sessionKey } from '@/services/therapyService'
import { myCaseload, planProgress } from '@/services/rehabService'
import { cn, to12Hour } from '@/lib/utils'

export default function TherapistDashboard() {
  const today = React.useMemo(() => todayIso(), [])

  // Today's diary and the caseload, both resolved from the signed-in therapist
  // server-side — the browser never asks for another therapist's work.
  const {
    data: sessionPage,
    loading: loadingSessions,
    error: sessionError,
    refetch: refetchSessions,
  } = useQuery(() => listSessions({ date: today, limit: 200 }), [today])
  const {
    data: caseloadData,
    loading: loadingCaseload,
    error: caseloadError,
  } = useQuery(() => myCaseload(), [])

  const sessions = React.useMemo(
    () => [...(sessionPage?.items ?? [])].sort((a, b) => a.time.localeCompare(b.time)),
    [sessionPage],
  )
  const caseload = caseloadData ?? []

  const completed = sessions.filter((s) => s.status === 'Completed')
  const missed = sessions.filter((s) => s.status === 'Missed')
  const inProgress = sessions.find((s) => s.status === 'In Progress')
  const next = sessions.find((s) => s.status === 'Scheduled')

  const needsReview = caseload.filter((c) => c.trend === 'Plateaued' || c.trend === 'At Risk')

  // The chart spotlights whichever plan has the most recorded progress, so it
  // is never empty while the caseload has data to show.
  const spotlight = caseload.find((c) => c.completedSessions > 0) ?? caseload[0]
  const { data: spotlightProgress } = useQuery(
    () => planProgress(spotlight!.planId),
    [spotlight?.planId],
    { enabled: Boolean(spotlight) },
  )
  const points = spotlightProgress?.progress ?? []
  const firstPoint = points.at(0)
  const lastPoint = points.at(-1)

  const alerts = [
    ...needsReview.map((c) => ({
      id: `alert-${c.planId}`,
      title: `${c.patientName} is ${c.trend.toLowerCase()}`,
      detail: `${c.attendanceRate !== null ? `Attendance ${Math.round(c.attendanceRate)}%` : 'Attendance not yet measured'}${
        c.adherenceRate !== null ? ` · adherence ${Math.round(c.adherenceRate)}%` : ''
      }. Consider revising the plan with the treating doctor.`,
      href: `/patients/${c.patientId}`,
      severity: (c.trend === 'At Risk' ? 'critical' : 'warning') as 'critical' | 'warning',
    })),
    ...missed.map((s) => ({
      id: `missed-${s.id}`,
      title: `${s.patientName} missed the ${to12Hour(s.time)} session`,
      detail: 'Front desk has been asked to reschedule within this week.',
      href: `/patients/${s.patientId}`,
      severity: 'warning' as const,
    })),
  ]

  return (
    <>
      <PageHeader
        title={`Today's therapy list`}
        description={
          loadingSessions
            ? 'Loading today’s therapy list…'
            : `${sessions.length} sessions scheduled — ${completed.length} completed, ${
                sessions.length - completed.length - missed.length
              } remaining.`
        }
        crumbs={[{ label: 'Therapist', to: '/therapist/dashboard' }, { label: 'Dashboard' }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/therapist/progress">
                <TrendingUp />
                Progress tracking
              </Link>
            </Button>
            <Button asChild>
              <Link to="/therapist/sessions">
                <CalendarClock />
                All sessions
              </Link>
            </Button>
          </>
        }
      />

      {/* --------------------------- Next / active session -------------------------- */}
      {(inProgress || next) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="mb-6 overflow-hidden rounded-xl border border-accent/25 bg-gradient-to-br from-accent/[0.09] via-card to-card shadow-card"
        >
          {(() => {
            const session = inProgress ?? next!
            return (
              <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex min-w-0 items-center gap-4">
                  <InitialsAvatar
                    initials={session.patientInitials}
                    color={session.patientAvatarColor}
                    className="size-14 text-base"
                  />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-accent">
                      <Timer className="size-3.5" />
                      {inProgress ? 'Session in progress' : 'Next session'}
                    </p>
                    <h2 className="mt-1 truncate text-xl font-bold tracking-tight">{session.patientName}</h2>
                    <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                      {session.type} · {session.durationMinutes ?? '—'} min · {session.room}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
                  <div className="text-left sm:text-right">
                    <p className="num text-2xl font-bold tracking-tight">{to12Hour(session.time)}</p>
                    <StatusBadge status={session.status} />
                  </div>
                  <Button size="lg" asChild>
                    <Link to={`/therapist/sessions/${sessionKey(session)}`}>
                      {inProgress ? 'Continue session' : 'Start session'}
                      <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </div>
            )
          })()}
        </motion.div>
      )}

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Today's therapy sessions"
          description="In time order, across every room."
          className="xl:col-span-2"
          viewAllHref="/therapist/sessions"
          delay={0.05}
        >
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            <StatTile label="Scheduled" value={loadingSessions ? '—' : sessions.length} />
            <StatTile label="Completed" value={loadingSessions ? '—' : completed.length} tone="success" />
            <StatTile
              label="Remaining"
              value={loadingSessions ? '—' : sessions.length - completed.length - missed.length}
              tone="info"
            />
            <StatTile
              label="Missed"
              value={loadingSessions ? '—' : missed.length}
              tone={missed.length ? 'danger' : 'neutral'}
            />
          </div>

          {loadingSessions ? (
            <LoadingState label="Loading today’s sessions" className="border-0 shadow-none" />
          ) : sessionError ? (
            <ErrorState
              title="Could not load your sessions"
              message={sessionError}
              onRetry={refetchSessions}
              className="border-0 shadow-none"
            />
          ) : sessions.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              Nothing booked for you today.
            </p>
          ) : (
          <ol className="space-y-2.5">
            {sessions.map((session, i) => {
              return (
                <motion.li
                  key={session.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.26 }}
                >
                  <Link
                    to={`/therapist/sessions/${sessionKey(session)}`}
                    className={cn(
                      'flex items-center gap-3.5 rounded-xl border border-border px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated',
                      session.status === 'Missed' && 'border-destructive/25 bg-destructive/[0.04]',
                      session.status === 'Completed' && 'opacity-80',
                    )}
                  >
                    <div className="w-14 shrink-0 text-right">
                      <p className="num text-[13px] font-semibold">{to12Hour(session.time).slice(0, 5)}</p>
                      <p className="text-[10px] font-medium uppercase text-muted-foreground">
                        {to12Hour(session.time).slice(-2)}
                      </p>
                    </div>
                    <InitialsAvatar
                      initials={session.patientInitials}
                      color={session.patientAvatarColor}
                      className="size-9"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold">{session.patientName}</p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {session.type} · {session.durationMinutes ?? '—'} min · {session.room}
                      </p>
                    </div>
                    <StatusBadge status={session.status} className="hidden sm:inline-flex" />
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </motion.li>
              )
            })}
          </ol>
          )}
        </SectionCard>

        <SectionCard title="Needs attention" description="Plans and sessions that are slipping." delay={0.1}>
          {loadingCaseload ? (
            <LoadingState label="Checking your caseload" className="border-0 shadow-none" />
          ) : alerts.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">
              Nothing is slipping — every plan is on track and no sessions were missed.
            </p>
          ) : (
            <AlertList items={alerts} />
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Assigned patients"
        description="Rehabilitation progress across your caseload."
        className="mb-6"
        viewAllHref="/patients"
      >
        {loadingCaseload ? (
          <LoadingState label="Loading your caseload" className="border-0 shadow-none" />
        ) : caseloadError ? (
          <ErrorState
            title="Could not load your caseload"
            message={caseloadError}
            className="border-0 shadow-none"
          />
        ) : caseload.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            No active rehabilitation plans are assigned to you.
          </p>
        ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {caseload.map((entry, i) => {
            const remaining = entry.totalSessions - entry.completedSessions

            return (
              <motion.li
                key={entry.planId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.05, duration: 0.3 }}
              >
                <Link
                  to={`/patients/${entry.patientId}`}
                  className="flex h-full flex-col rounded-xl border border-border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <InitialsAvatar initials={entry.initials} color={entry.avatarColor} className="size-9" />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold">{entry.patientName}</p>
                        <p className="num truncate text-[11px] text-muted-foreground">{entry.patientId}</p>
                      </div>
                    </div>
                    <StatusBadge status={entry.trend} />
                  </div>

                  <p className="mt-3 truncate text-[12px] text-muted-foreground">{entry.planTitle}</p>

                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="num text-xl font-bold tracking-tight">{entry.progressPercentage}%</span>
                    <span className="num text-[11.5px] text-muted-foreground">
                      {entry.completedSessions} / {entry.totalSessions} sessions
                    </span>
                  </div>
                  <Progress
                    value={entry.progressPercentage}
                    className="mt-1.5 h-1.5"
                    tone={entry.trend === 'At Risk' ? 'danger' : entry.trend === 'Plateaued' ? 'warning' : 'accent'}
                  />

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                    <Badge variant="outline">{remaining} left</Badge>
                    {entry.adherenceRate !== null && (
                      <Badge variant={entry.adherenceRate >= 80 ? 'success' : 'warning'}>
                        {entry.adherenceRate >= 80 ? (
                          <TrendingUp className="size-3" />
                        ) : (
                          <TrendingDown className="size-3" />
                        )}
                        {Math.round(entry.adherenceRate)}% adherence
                      </Badge>
                    )}
                    {entry.attendanceRate !== null && (
                      <Badge variant="outline">{Math.round(entry.attendanceRate)}% attendance</Badge>
                    )}
                  </div>
                </Link>
              </motion.li>
            )
          })}
        </ul>
        )}
      </SectionCard>

      {spotlight && (
        <SectionCard
          title={`Rehabilitation progress — ${spotlight.patientName}`}
          description="Mobility and strength against pain score, week by week."
          icon={<HeartPulse />}
          viewAllHref={`/patients/${spotlight.patientId}`}
          viewAllLabel="Open record"
        >
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Overall progress"
              value={`${spotlight.progressPercentage}%`}
              hint={`${spotlight.completedSessions} of ${spotlight.totalSessions} sessions`}
              tone="accent"
            />
            <StatTile
              label="Pain score"
              value={lastPoint ? `${lastPoint.pain} / 10` : '—'}
              hint={firstPoint ? `From ${firstPoint.pain} at week 1` : 'No reviews recorded yet'}
              tone="success"
            />
            <StatTile
              label="Mobility"
              value={lastPoint ? lastPoint.mobility : '—'}
              hint={firstPoint ? `From ${firstPoint.mobility}` : 'No reviews recorded yet'}
              tone="info"
            />
            <StatTile
              label="Adherence"
              value={spotlight.adherenceRate !== null ? `${Math.round(spotlight.adherenceRate)}%` : '—'}
              hint={
                spotlight.attendanceRate !== null
                  ? `Attendance ${Math.round(spotlight.attendanceRate)}%`
                  : 'Attendance not yet measured'
              }
            />
          </div>
          {points.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              No weekly reviews recorded for this plan yet.
            </p>
          ) : (
            <RehabProgressChart data={points} />
          )}

          <div className="mt-5 flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-[12.5px] text-muted-foreground">
            <ClipboardCheck className="size-4 shrink-0" />
            Scores are captured at the end of every session, so this chart updates as soon as you save a session entry.
          </div>
        </SectionCard>
      )}
    </>
  )
}
