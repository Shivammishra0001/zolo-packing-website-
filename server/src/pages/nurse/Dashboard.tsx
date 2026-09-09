import * as React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, BedDouble, CheckCircle2, ClipboardList, LogOut } from 'lucide-react'
import type { NursingTask } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { VitalsGrid } from '@/components/patients/VitalsGrid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox, InitialsAvatar } from '@/components/ui/misc'
import { StatusBadge } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import type { AdmissionRecord } from '@/services/admissionService'
import {
  completeTask,
  getDashboard,
  ipdPatients,
  listTasks,
  reopenTask,
  type NursingTaskRecord,
} from '@/services/nursingService'
import { latestVitals } from '@/services/vitalsService'
import { cn, formatDate, groupBy } from '@/lib/utils'

const PRIORITY_ORDER: Record<NursingTask['priority'], number> = { Critical: 0, High: 1, Routine: 2 }

export default function NurseDashboard() {
  const toast = useToast()
  const [focusId, setFocusId] = React.useState<string | null>(null)

  const {
    data: summary,
    loading: loadingSummary,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery(() => getDashboard(), [])
  const { data: ipdData, loading: loadingIpd, error: ipdError, refetch: refetchIpd } = useQuery(
    () => ipdPatients(),
    [],
  )
  const {
    data: taskData,
    loading: loadingTasks,
    error: taskError,
    refetch: refetchTasks,
  } = useQuery(() => listTasks(), [])

  // A tick is applied here before the request lands so the checkbox responds
  // immediately; dropping the override on failure is what rolls it back.
  const [override, setOverride] = React.useState<Record<string, boolean>>({})

  const tasks = (taskData ?? []).map((task) =>
    task.id in override ? { ...task, done: override[task.id] } : task,
  )
  const pending = tasks.filter((t) => !t.done).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])

  const inpatients = ipdData ?? []
  const byWard = groupBy(inpatients, (p) => p.ward || 'Unassigned')
  const dischargePending = inpatients.filter((p) => p.status === 'Discharge Pending')

  // Nothing is selected until the round is loaded, so the first bed stands in.
  const focus: AdmissionRecord | undefined = inpatients.find((p) => p.id === focusId) ?? inpatients[0]
  const {
    data: vitals,
    loading: loadingVitals,
    error: vitalsError,
    refetch: refetchVitals,
  } = useQuery(() => latestVitals(focus!.patientId), [focus?.patientId], { enabled: Boolean(focus) })

  async function toggleTask(task: NursingTaskRecord, done: boolean) {
    setOverride((prev) => ({ ...prev, [task.id]: done }))
    try {
      await (done ? completeTask(task.id) : reopenTask(task.id))
      if (done) toast.success('Task completed', `${task.label} — ${task.patientName}`)
      refetchTasks()
    } catch (err) {
      setOverride((prev) => {
        const next = { ...prev }
        delete next[task.id]
        return next
      })
      toast.error(
        done ? 'Could not complete the task' : 'Could not reopen the task',
        err instanceof Error ? err.message : 'Please try again.',
      )
    }
  }

  return (
    <>
      <PageHeader
        title="Ward round"
        description={
          loadingSummary || loadingIpd
            ? 'Loading the ward round…'
            : `${summary?.pendingTasks ?? pending.length} tasks outstanding across ${Object.keys(byWard).length} wards.`
        }
        crumbs={[{ label: 'Nurse', to: '/nurse/dashboard' }, { label: 'Dashboard' }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/nurse/vitals">Vitals round</Link>
            </Button>
            <Button asChild>
              <Link to="/nurse/tasks">
                <ClipboardList />
                All tasks
              </Link>
            </Button>
          </>
        }
      />

      {summaryError ? (
        <ErrorState
          title="Could not load the ward summary"
          message={summaryError}
          onRetry={refetchSummary}
          className="mb-6"
        />
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Assigned patients"
            value={loadingSummary ? '—' : (summary?.admittedPatients ?? 0)}
            hint="Inpatients under your care"
          />
          <StatTile
            label="Vitals pending"
            value={loadingSummary ? '—' : (summary?.vitalsPending ?? 0)}
            tone="warning"
          />
          <StatTile
            label="Medications due"
            value={loadingSummary ? '—' : (summary?.medicationsDue ?? 0)}
            tone="info"
          />
          <StatTile
            label="Discharges pending"
            value={loadingSummary ? '—' : (summary?.dischargePending ?? 0)}
            tone="accent"
          />
        </div>
      )}

      {/* --------------------------- Discharge highlight -------------------------- */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6 rounded-xl border border-warning/30 bg-warning/[0.05] p-5"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <LogOut className="size-4 text-warning" />
              Discharge pending
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              These patients cannot leave until every blocker is cleared.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/nurse/discharges">
              Manage discharges
              <ArrowRight />
            </Link>
          </Button>
        </div>

        {loadingIpd ? (
          <LoadingState label="Loading pending discharges" className="border-0 shadow-none" />
        ) : ipdError ? (
          <ErrorState
            title="Could not load pending discharges"
            message={ipdError}
            onRetry={refetchIpd}
            className="border-0 shadow-none"
          />
        ) : dischargePending.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            Nobody is waiting to be discharged.
          </p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {dischargePending.map((discharge) => (
              <li key={discharge.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <InitialsAvatar
                      initials={discharge.patientInitials}
                      color={discharge.patientAvatarColor}
                      className="size-9"
                    />
                    <div className="min-w-0">
                      <Link
                        to={`/patients/${discharge.patientId}`}
                        className="block truncate text-[13.5px] font-semibold hover:text-accent"
                      >
                        {discharge.patientName}
                      </Link>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {discharge.ward} · {discharge.bed} · {discharge.attendingDoctor}
                      </p>
                    </div>
                  </div>
                  <Badge variant="warning">
                    {discharge.expectedDischarge ? formatDate(discharge.expectedDischarge) : 'Date to confirm'}
                  </Badge>
                </div>

                <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                  {discharge.checklist
                    .filter((item) => !item.done)
                    .map((blocker) => (
                      <li
                        key={blocker.id}
                        className="flex items-start gap-2 text-[12.5px] text-muted-foreground"
                      >
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
                        {blocker.label}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </motion.section>

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Assigned patients"
          description="Grouped by ward, room and bed."
          className="xl:col-span-2"
          icon={<BedDouble />}
          delay={0.05}
        >
          {loadingIpd ? (
            <LoadingState label="Loading your inpatients" className="border-0 shadow-none" />
          ) : ipdError ? (
            <ErrorState
              title="Could not load your inpatients"
              message={ipdError}
              onRetry={refetchIpd}
              className="border-0 shadow-none"
            />
          ) : inpatients.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">No beds are occupied right now.</p>
          ) : (
            <div className="space-y-5">
              {Object.entries(byWard).map(([ward, wardPatients]) => (
                <div key={ward}>
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {ward} · {wardPatients.length} patient{wardPatients.length > 1 ? 's' : ''}
                  </p>
                  <ul className="grid gap-2.5 sm:grid-cols-2">
                    {wardPatients.map((p) => {
                      const patientTasks = pending.filter((t) => t.patientId === p.patientId)
                      const isFocus = p.id === focus?.id
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => setFocusId(p.id)}
                            className={cn(
                              'w-full rounded-xl border p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevated',
                              isFocus ? 'border-accent bg-accent/[0.06]' : 'border-border',
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="num rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold">
                                {p.bed}
                              </span>
                              <StatusBadge status={p.status} showDot={false} />
                            </div>
                            <div className="mt-2.5 flex items-center gap-2.5">
                              <InitialsAvatar
                                initials={p.patientInitials}
                                color={p.patientAvatarColor}
                                className="size-9"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-[13.5px] font-semibold">{p.patientName}</p>
                                <p className="truncate text-[11.5px] text-muted-foreground">
                                  {p.age ?? '—'} yrs · {p.attendingDoctor}
                                </p>
                              </div>
                            </div>
                            {patientTasks.length > 0 && (
                              <p className="mt-2.5 border-t border-border pt-2 text-[11.5px] text-warning">
                                {patientTasks.length} task{patientTasks.length > 1 ? 's' : ''} outstanding
                              </p>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Pending tasks"
          description="Highest priority first."
          viewAllHref="/nurse/tasks"
          delay={0.1}
        >
          {loadingTasks ? (
            <LoadingState label="Loading the task list" className="border-0 shadow-none" />
          ) : taskError ? (
            <ErrorState
              title="Could not load the task list"
              message={taskError}
              onRetry={refetchTasks}
              className="border-0 shadow-none"
            />
          ) : pending.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 className="mb-2 size-8 text-success" />
              <p className="text-sm font-semibold">All tasks complete</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Nothing outstanding for this shift.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {pending.slice(0, 8).map((task, i) => (
                <motion.li
                  key={task.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.24 }}
                >
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
                      task.priority === 'Critical'
                        ? 'border-destructive/30 bg-destructive/[0.05]'
                        : task.priority === 'High'
                          ? 'border-warning/30 bg-warning/[0.05]'
                          : 'border-border hover:bg-muted/50',
                    )}
                  >
                    <Checkbox
                      checked={task.done}
                      onCheckedChange={(v) => toggleTask(task, v === true)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-snug">{task.label}</span>
                      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                        {task.patientName} · {task.bed} · due {task.due}
                      </span>
                    </span>
                    <Badge variant={task.priority === 'Critical' ? 'danger' : task.priority === 'High' ? 'warning' : 'default'}>
                      {task.type}
                    </Badge>
                  </label>
                </motion.li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {focus && (
        <SectionCard
          title={`Latest vitals — ${focus.patientName}`}
          description={
            vitals
              ? `${focus.ward} · ${focus.bed} · recorded by ${vitals.recordedBy}`
              : `${focus.ward} · ${focus.bed}`
          }
          viewAllHref={`/patients/${focus.patientId}`}
          viewAllLabel="Open record"
        >
          {loadingVitals ? (
            <LoadingState label="Loading the latest observation" className="border-0 shadow-none" />
          ) : vitalsError ? (
            <ErrorState
              title="Could not load the latest vitals"
              message={vitalsError}
              onRetry={refetchVitals}
              className="border-0 shadow-none"
            />
          ) : !vitals ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              Nothing has been recorded for this patient yet.
            </p>
          ) : (
            <>
              <VitalsGrid vitals={vitals} />
              <p className="mt-4 text-[12px] text-muted-foreground">
                Select any patient card above to switch the vitals shown here. Full history is on the patient record.
              </p>
            </>
          )}
        </SectionCard>
      )}
    </>
  )
}
