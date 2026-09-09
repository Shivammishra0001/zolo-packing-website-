import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, Check, Save, Timer } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { RehabProgressChart } from '@/components/charts/RehabProgressChart'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { Checkbox, InitialsAvatar, Progress, Separator, Slider } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { getPatient } from '@/services/patientService'
import { listExercises } from '@/services/exerciseService'
import { getPlan, planProgress, completeMilestone } from '@/services/rehabService'
import {
  completeSession,
  getSession,
  updateSession,
  type TherapySessionRecord,
} from '@/services/therapyService'
import { cn, formatDate, to12Hour } from '@/lib/utils'

const TOLERANCES = ['Excellent', 'Good', 'Fair', 'Poor — session shortened']

export default function SessionEntry() {
  const { sessionId } = useParams()
  const { data: session, loading, error, refetch } = useQuery(
    () => getSession(sessionId!),
    [sessionId],
    { enabled: Boolean(sessionId) },
  )

  if (loading) return <LoadingState label="Loading the session" />

  if (error || !session) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <Timer className="mb-3 size-9 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Session not found</h1>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          {error ?? 'This therapy session is not on your list.'}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={refetch}>
            Try again
          </Button>
          <Button asChild>
            <Link to="/therapist/sessions">Back to sessions</Link>
          </Button>
        </div>
      </div>
    )
  }

  return <SessionForm session={session} onSaved={refetch} />
}

function SessionForm({
  session,
  onSaved,
}: {
  session: TherapySessionRecord
  onSaved: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()

  /* ------------------------------ Loaded context ----------------------------- */

  const { data: patient } = useQuery(() => getPatient(session.patientId), [session.patientId])
  const { data: plan, refetch: refetchPlan } = useQuery(
    () => getPlan(session.planId!),
    [session.planId],
    { enabled: Boolean(session.planId) },
  )
  const { data: progress, refetch: refetchProgress } = useQuery(
    () => planProgress(session.planId!),
    [session.planId],
    { enabled: Boolean(session.planId) },
  )

  // Only the protocol for this discipline — filtered in SQL, not here.
  const { data: catalogue } = useQuery(
    () => listExercises({ category: session.type }),
    [session.type],
  )
  const library = React.useMemo(() => (catalogue ?? []).map((e) => e.name), [catalogue])

  const points = progress?.progress ?? []
  const lastPoint = points.at(-1)

  /* --------------------------------- Form state ------------------------------ */

  const closed = session.status === 'Completed' || session.status === 'Missed'

  const [exercises, setExercises] = React.useState<string[]>(session.exercises)
  const [duration, setDuration] = React.useState(session.durationMinutes ?? 45)
  const [painBefore, setPainBefore] = React.useState(session.painBefore ?? lastPoint?.pain ?? 5)
  const [painAfter, setPainAfter] = React.useState(
    session.painAfter ?? Math.max(0, (session.painBefore ?? 5) - 1),
  )
  const [mobility, setMobility] = React.useState(session.mobilityScore ?? lastPoint?.mobility ?? 50)
  const [strength, setStrength] = React.useState(session.strengthScore ?? lastPoint?.strength ?? 50)
  const [notes, setNotes] = React.useState(session.notes ?? '')
  const [tolerance, setTolerance] = React.useState(session.tolerance ?? 'Good')
  const [nextDate, setNextDate] = React.useState(session.nextSessionDate ?? '')
  const [nextTime, setNextTime] = React.useState(session.time)
  const [saving, setSaving] = React.useState(false)
  const [busyMilestone, setBusyMilestone] = React.useState<string | null>(null)

  function toggleExercise(exercise: string, on: boolean) {
    setExercises((prev) => (on ? [...prev, exercise] : prev.filter((e) => e !== exercise)))
  }

  async function markMilestone(id: string) {
    setBusyMilestone(id)
    try {
      const done = await completeMilestone(id)
      refetchPlan()
      toast.success('Milestone achieved', `${done.label} marked as achieved.`)
    } catch (err) {
      toast.error(
        'Could not update the milestone',
        err instanceof Error ? err.message : 'Please try again.',
      )
    } finally {
      setBusyMilestone(null)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (exercises.length === 0) {
      toast.error('Record at least one exercise', 'Select the exercises performed before saving the session.')
      return
    }

    const measurements = {
      durationMinutes: duration,
      painBefore,
      painAfter,
      mobilityScore: mobility,
      strengthScore: strength,
      notes: notes.trim() || undefined,
      tolerance,
      nextSessionDate: nextDate || undefined,
      exercises: exercises.map((name) => ({ name })),
    }

    setSaving(true)
    try {
      if (closed) {
        // A completed session is a clinical record; amend it rather than
        // re-completing it, which the API refuses.
        await updateSession(session.uuid, measurements)
        toast.success('Session updated', `${session.patientName}'s entry has been amended.`)
      } else {
        // Completing moves the plan's progress in the same transaction, so the
        // plan's counters can never disagree with its sessions.
        const done = await completeSession(session.uuid, measurements)
        toast.success(
          'Session saved',
          `${done.patientName}: pain ${painBefore} → ${painAfter}, mobility ${mobility}.` +
            (nextDate ? ` Next session ${formatDate(nextDate)}.` : ''),
        )
      }
      onSaved()
      refetchPlan()
      refetchProgress()
      navigate('/therapist/dashboard')
    } catch (err) {
      toast.error(
        'Could not save the session',
        err instanceof Error ? err.message : 'Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  const projectedCompletion = plan
    ? Math.round(((plan.completedSessions + (closed ? 0 : 1)) / plan.totalSessions) * 100)
    : 0

  return (
    <form onSubmit={save}>
      <PageHeader
        title="Therapy session"
        description={`${session.patientName} · ${session.type}${
          session.time ? ` · ${to12Hour(session.time)}` : ''
        }${session.room ? ` in ${session.room}` : ''}`}
        crumbs={[
          { label: 'Therapist', to: '/therapist/dashboard' },
          { label: 'Sessions', to: '/therapist/sessions' },
          { label: session.patientName },
        ]}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft />
              Back
            </Button>
            <Button type="submit" loading={saving}>
              <Save />
              {closed ? 'Update session' : 'Save session'}
            </Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <SectionCard title="Session details" description="What was delivered in this session.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Session type">
                {/* The discipline is fixed by the plan, so it is shown, not edited. */}
                <Input value={session.type} readOnly />
              </Field>
              <Field label="Duration" htmlFor="duration" hint="Minutes delivered">
                <Input
                  id="duration"
                  type="number"
                  min={10}
                  max={120}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </Field>
              <Field label="Patient tolerance">
                <Select value={tolerance} onValueChange={setTolerance}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOLERANCES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title="Exercises performed"
            description={`${exercises.length} of ${library.length} selected from the ${session.type.toLowerCase()} protocol.`}
          >
            {library.length === 0 && exercises.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                No exercises in the {session.type.toLowerCase()} library yet.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {Array.from(new Set([...library, ...session.exercises])).map((exercise) => {
                  const on = exercises.includes(exercise)
                  return (
                    <li key={exercise}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] transition-colors',
                          on ? 'border-accent/30 bg-accent/[0.06]' : 'border-border hover:bg-muted/50',
                        )}
                      >
                        <Checkbox checked={on} onCheckedChange={(v) => toggleExercise(exercise, v === true)} />
                        <span className="min-w-0 flex-1">{exercise}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Clinical scores" description="Recorded at the end of the session; these drive the progress chart.">
            <div className="space-y-7">
              <ScoreSlider
                label="Pain before session"
                value={painBefore}
                onChange={setPainBefore}
                max={10}
                step={0.5}
                suffix="/ 10"
                tone="warning"
                hint="0 = no pain, 10 = worst imaginable"
              />
              <ScoreSlider
                label="Pain after session"
                value={painAfter}
                onChange={setPainAfter}
                max={10}
                step={0.5}
                suffix="/ 10"
                tone="warning"
                hint={
                  painAfter < painBefore
                    ? `Improved by ${(painBefore - painAfter).toFixed(1)} points during the session`
                    : painAfter > painBefore
                      ? 'Pain increased — review load progression'
                      : 'No change during the session'
                }
              />
              <ScoreSlider
                label="Mobility score"
                value={mobility}
                onChange={setMobility}
                max={100}
                step={1}
                suffix="/ 100"
                tone="accent"
                hint={lastPoint ? `Last recorded ${lastPoint.mobility}` : undefined}
              />
              <ScoreSlider
                label="Strength score"
                value={strength}
                onChange={setStrength}
                max={100}
                step={1}
                suffix="/ 100"
                tone="info"
                hint={lastPoint ? `Last recorded ${lastPoint.strength}` : undefined}
              />
            </div>
          </SectionCard>

          <SectionCard title="Therapist notes" description="Observations, home programme changes and precautions.">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Managed 3 sets of 12 with good control. Progressed load by 5 kg. Advised ice for 15 minutes after the home programme."
              className="min-h-[120px]"
            />
          </SectionCard>

          <SectionCard title="Next session" description="Recorded on this entry so the diary can be booked." icon={<CalendarPlus />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" htmlFor="next-date">
                <Input id="next-date" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
              </Field>
              <Field label="Time" htmlFor="next-time">
                <Input id="next-time" type="time" value={nextTime} onChange={(e) => setNextTime(e.target.value)} />
              </Field>
            </div>
          </SectionCard>
        </div>

        {/* -------------------------------- Sidebar ------------------------------- */}
        <aside className="space-y-5">
          {patient && (
            <SectionCard title="Patient" delay={0.05}>
              <div className="flex items-center gap-3">
                <InitialsAvatar initials={patient.initials} color={patient.avatarColor} className="size-12 text-sm" />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{patient.name}</p>
                  <p className="num truncate text-[12px] text-muted-foreground">
                    {patient.id} · {patient.age} yrs · {patient.gender}
                  </p>
                </div>
              </div>

              <Separator className="my-4" />

              <dl className="space-y-2.5 text-[12.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Condition</dt>
                  <dd className="text-right font-medium">{patient.primaryCondition}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Doctor</dt>
                  <dd className="text-right font-medium">{patient.assignedDoctor}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Room</dt>
                  <dd className="text-right font-medium">{session.room || '—'}</dd>
                </div>
              </dl>

              {patient.allergies.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-destructive">
                    Precautions
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {patient.allergies.map((a) => (
                      <Badge key={a} variant="danger">
                        {a}
                      </Badge>
                    ))}
                  </div>
                </>
              )}

              <Button asChild variant="outline" className="mt-4 w-full">
                <Link to={`/patients/${patient.id}`}>Open Patient 360</Link>
              </Button>
            </SectionCard>
          )}

          {plan && (
            <SectionCard title="Rehabilitation plan" delay={0.1}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[13.5px] font-semibold">{plan.title}</p>
                <StatusBadge status={plan.trend} />
              </div>
              {plan.goal && (
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{plan.goal}</p>
              )}

              <div className="mt-4 flex items-baseline justify-between">
                <span className="num text-xl font-bold">{projectedCompletion}%</span>
                <span className="num text-[12px] text-muted-foreground">
                  {plan.completedSessions + (closed ? 0 : 1)} of {plan.totalSessions}
                  {closed ? '' : ' after this'}
                </span>
              </div>
              <Progress value={projectedCompletion} className="mt-2" />

              <div className="mt-4 grid grid-cols-2 gap-3">
                <StatTile
                  label="Attendance"
                  value={plan.attendanceRate !== null ? `${Math.round(plan.attendanceRate)}%` : '—'}
                />
                <StatTile
                  label="Adherence"
                  value={plan.adherenceRate !== null ? `${Math.round(plan.adherenceRate)}%` : '—'}
                />
              </div>

              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Milestones
              </p>
              <ul className="mt-2 space-y-2">
                {plan.milestones.map((m) => (
                  <li key={m.id} className="flex items-start gap-2 text-[12.5px]">
                    <button
                      type="button"
                      disabled={m.done || busyMilestone === m.id}
                      onClick={() => void markMilestone(m.id)}
                      aria-label={m.done ? `${m.label} achieved` : `Mark ${m.label} as achieved`}
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full transition-colors',
                        m.done
                          ? 'bg-success/15 text-success'
                          : 'bg-muted text-muted-foreground hover:bg-accent/20 hover:text-accent',
                      )}
                    >
                      {m.done ? (
                        <Check className="size-2.5" strokeWidth={3} />
                      ) : (
                        <span className="size-1 rounded-full bg-current" />
                      )}
                    </button>
                    <span className={cn('min-w-0 flex-1', !m.done && 'text-muted-foreground')}>
                      {m.label}
                      {m.date && (
                        <span className="ml-1 text-[11px] text-muted-foreground">{formatDate(m.date)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {plan.milestones.length === 0 && (
                <p className="mt-2 text-[12px] text-muted-foreground">No milestones set for this plan.</p>
              )}
            </SectionCard>
          )}

          <SectionCard title="Progress so far" description="Weekly trend before this session." delay={0.15}>
            {points.length === 0 ? (
              <p className="py-8 text-center text-[12.5px] text-muted-foreground">
                No weekly reviews recorded yet.
              </p>
            ) : (
              <RehabProgressChart data={points} height={230} />
            )}
          </SectionCard>
        </aside>
      </div>
    </form>
  )
}

function ScoreSlider({
  label,
  value,
  onChange,
  max,
  step,
  suffix,
  tone,
  hint,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  max: number
  step: number
  suffix: string
  tone: 'accent' | 'warning' | 'info'
  hint?: string
}) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[13px] font-medium">{label}</span>
        <span
          className={cn(
            'num rounded-md px-2 py-0.5 text-[13px] font-bold',
            tone === 'warning' && 'bg-warning/12 text-warning',
            tone === 'accent' && 'bg-accent/12 text-accent',
            tone === 'info' && 'bg-info/12 text-info',
          )}
        >
          {value} <span className="text-[11px] font-medium opacity-70">{suffix}</span>
        </span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        max={max}
        step={step}
        tone={tone}
        aria-label={label}
      />
      <div className="mt-0.5 flex justify-between text-[11px] text-muted-foreground">
        <span>0</span>
        {hint && <span className="px-2 text-center">{hint}</span>}
        <span>{max}</span>
      </div>
    </div>
  )
}
