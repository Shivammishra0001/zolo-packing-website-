import { motion } from 'framer-motion'
import { Activity, CalendarCheck, Dumbbell, Target, TrendingDown, TrendingUp } from 'lucide-react'
import type { Patient } from '@/types'
import { RehabProgressChart } from '@/components/charts/RehabProgressChart'
import { SectionCard } from '@/components/dashboard/SectionCard'
import { StatusBadge } from '@/components/ui/status'
import { Progress } from '@/components/ui/misc'
import { Badge } from '@/components/ui/badge'
import { rehabCompletion } from '@/lib/rehab'
import { cn, formatDate } from '@/lib/utils'

function MetricRing({
  label,
  value,
  max = 100,
  suffix,
  tone,
  delta,
  invertDelta = false,
}: {
  label: string
  value: number
  max?: number
  suffix?: string
  tone: 'accent' | 'info' | 'warning' | 'success'
  delta?: number
  invertDelta?: boolean
}) {
  const pct = Math.round((value / max) * 100)
  const size = 84
  const stroke = 7
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const good = delta === undefined ? true : invertDelta ? delta < 0 : delta > 0

  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-muted/25 p-4 text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={stroke}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={cn(
              'stroke-current',
              tone === 'accent' && 'text-accent',
              tone === 'info' && 'text-info',
              tone === 'warning' && 'text-warning',
              tone === 'success' && 'text-success',
            )}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - (pct / 100) * circumference }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-[17px] font-bold leading-none tracking-tight">{value}</span>
          {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
        </div>
      </div>
      <p className="mt-2.5 text-[12px] font-medium">{label}</p>
      {delta !== undefined && (
        <p
          className={cn(
            'mt-0.5 flex items-center gap-0.5 text-[11px] font-semibold',
            good ? 'text-success' : 'text-destructive',
          )}
        >
          {delta > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          {delta > 0 ? '+' : ''}
          {delta} since week 1
        </p>
      )}
    </div>
  )
}

export function RehabProgressPanel({ patient }: { patient: Patient }) {
  const plan = patient.rehabPlan

  if (!plan) {
    return (
      <SectionCard title="Rehabilitation progress" description="No active rehabilitation plan.">
        <div className="flex flex-col items-center py-12 text-center">
          <Target className="mb-3 size-9 text-muted-foreground" />
          <p className="text-sm font-semibold">No rehabilitation plan yet</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            A doctor can create one from the consultation screen. Once created, sessions and progress appear here.
          </p>
        </div>
      </SectionCard>
    )
  }

  const first = patient.progress[0]
  const last = patient.progress[patient.progress.length - 1]
  const completion = rehabCompletion(patient)
  const remaining = plan.totalSessions - plan.completedSessions
  const weeksLeft = Math.ceil(remaining / plan.frequencyPerWeek)

  return (
    <div className="space-y-5">
      <SectionCard
        title="Rehabilitation progress"
        description={plan.goal}
        action={<StatusBadge status={plan.trend} />}
      >
        {/* Headline completion */}
        <div className="mb-6 rounded-xl border border-accent/25 bg-gradient-to-br from-accent/[0.08] via-transparent to-transparent p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Overall progress</p>
              <p className="num mt-1 text-4xl font-bold leading-none tracking-tight">{completion}%</p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {plan.completedSessions} of {plan.totalSessions} sessions complete · {remaining} remaining
              </p>
            </div>
            <div className="text-right">
              <p className="text-[12px] text-muted-foreground">Target completion</p>
              <p className="text-[14px] font-semibold">{formatDate(plan.targetEndDate)}</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                ~{weeksLeft} week{weeksLeft === 1 ? '' : 's'} at {plan.frequencyPerWeek}× per week
              </p>
            </div>
          </div>
          <Progress
            value={completion}
            className="mt-4 h-2.5"
            tone={plan.trend === 'At Risk' ? 'danger' : plan.trend === 'Plateaued' ? 'warning' : 'accent'}
          />
        </div>

        {/* Score rings */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricRing
            label="Pain score"
            value={last.pain}
            max={10}
            suffix="of 10"
            tone="warning"
            delta={Number((last.pain - first.pain).toFixed(1))}
            invertDelta
          />
          <MetricRing
            label="Mobility"
            value={last.mobility}
            tone="accent"
            delta={last.mobility - first.mobility}
          />
          <MetricRing
            label="Strength"
            value={last.strength}
            tone="info"
            delta={last.strength - first.strength}
          />
          <MetricRing label="Attendance" value={plan.attendanceRate} suffix="%" tone="success" />
          <MetricRing label="Adherence" value={plan.adherenceRate} suffix="%" tone="success" />
        </div>

        <div className="mt-6">
          <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Activity className="size-3.5" />
            Weekly trend
          </p>
          <RehabProgressChart data={patient.progress} height={300} />
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Plan details" description={plan.title} icon={<Dumbbell />} delay={0.05}>
          <dl className="space-y-2.5 text-[13px]">
            {[
              ['Primary therapist', plan.primaryTherapist],
              ['Started', formatDate(plan.startDate)],
              ['Target end', formatDate(plan.targetEndDate)],
              ['Frequency', `${plan.frequencyPerWeek} sessions per week`],
              ['Sessions', `${plan.completedSessions} of ${plan.totalSessions}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-border/60 pb-2.5 last:border-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Modalities
          </p>
          <div className="flex flex-wrap gap-1.5">
            {plan.modalities.map((m) => (
              <Badge key={m} variant="accent">
                {m}
              </Badge>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Milestones" description="Checkpoints agreed with the patient." icon={<CalendarCheck />} delay={0.1}>
          <ol className="relative space-y-0.5">
            {plan.milestones.map((milestone, i) => {
              const isLast = i === plan.milestones.length - 1
              return (
                <motion.li
                  key={milestone.label}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.06, duration: 0.28 }}
                  className="relative flex gap-3.5 pb-4 last:pb-0"
                >
                  {!isLast && (
                    <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-border" aria-hidden />
                  )}
                  <span
                    className={cn(
                      'relative z-10 mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full border-2',
                      milestone.done
                        ? 'border-success bg-success text-white'
                        : 'border-border bg-card text-muted-foreground',
                    )}
                  >
                    {milestone.done ? (
                      <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth={2.6}>
                        <path d="M2 6.5l2.5 2.5L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <span className="size-1.5 rounded-full bg-current" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13px] font-medium leading-snug', !milestone.done && 'text-muted-foreground')}>
                      {milestone.label}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {milestone.done ? 'Achieved' : 'Target'} {formatDate(milestone.date)}
                    </p>
                  </div>
                </motion.li>
              )
            })}
          </ol>
        </SectionCard>
      </div>
    </div>
  )
}
