import * as React from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import type { NursingTask } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { completeTask, listTasks, reopenTask, type NursingTaskRecord } from '@/services/nursingService'
import { cn, groupBy } from '@/lib/utils'

const PRIORITY_ORDER: Record<NursingTask['priority'], number> = { Critical: 0, High: 1, Routine: 2 }

const TASK_TYPES: (NursingTask['type'] | 'All')[] = [
  'All',
  'Vitals',
  'Medication',
  'Doctor Instruction',
  'Care Task',
  'Therapy Prep',
]

export default function NurseTasks() {
  const toast = useToast()
  const [filter, setFilter] = React.useState<(typeof TASK_TYPES)[number]>('All')

  const { data, loading, error, refetch } = useQuery(() => listTasks(), [])

  // A tick is applied here before the request lands so the checkbox responds
  // immediately; dropping the override on failure is what rolls it back.
  const [override, setOverride] = React.useState<Record<string, boolean>>({})

  const tasks = (data ?? []).map((task) =>
    task.id in override ? { ...task, done: override[task.id] } : task,
  )

  const visible = tasks.filter((t) => filter === 'All' || t.type === filter)
  const pending = visible.filter((t) => !t.done).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
  const done = visible.filter((t) => t.done)
  const byWard = groupBy(pending, (t) => t.ward || 'Unassigned')

  const completedCount = tasks.filter((t) => t.done).length
  // A tile shows "—" rather than a zero it cannot stand behind.
  const countsUnknown = loading || error !== null

  async function toggle(task: NursingTaskRecord, isDone: boolean) {
    setOverride((prev) => ({ ...prev, [task.id]: isDone }))
    try {
      await (isDone ? completeTask(task.id) : reopenTask(task.id))
      toast[isDone ? 'success' : 'info'](
        isDone ? 'Task completed' : 'Task reopened',
        `${task.label} — ${task.patientName}`,
      )
      refetch()
    } catch (err) {
      setOverride((prev) => {
        const next = { ...prev }
        delete next[task.id]
        return next
      })
      toast.error(
        isDone ? 'Could not complete the task' : 'Could not reopen the task',
        err instanceof Error ? err.message : 'Please try again.',
      )
    }
  }

  function TaskRow({ task }: { task: NursingTaskRecord }) {
    return (
      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
          task.done
            ? 'border-border bg-muted/35 opacity-70'
            : task.priority === 'Critical'
              ? 'border-destructive/30 bg-destructive/[0.05]'
              : task.priority === 'High'
                ? 'border-warning/30 bg-warning/[0.05]'
                : 'border-border hover:bg-muted/45',
        )}
      >
        <Checkbox checked={task.done} onCheckedChange={(v) => toggle(task, v === true)} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[13.5px] font-medium leading-snug', task.done && 'line-through')}>
            {task.label}
          </span>
          <span className="mt-0.5 block text-[12px] text-muted-foreground">
            <Link to={`/patients/${task.patientId}`} className="font-medium hover:text-accent">
              {task.patientName}
            </Link>{' '}
            · {task.ward} · {task.bed} · due {task.due}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            variant={task.priority === 'Critical' ? 'danger' : task.priority === 'High' ? 'warning' : 'default'}
            dot={task.priority === 'Critical'}
            pulse={task.priority === 'Critical' && !task.done}
          >
            {task.priority}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{task.type}</span>
        </span>
      </label>
    )
  }

  return (
    <>
      <PageHeader
        title="My tasks"
        description="Everything due this shift, grouped by ward and ordered by priority."
        crumbs={[{ label: 'Nurse', to: '/nurse/dashboard' }, { label: 'My Tasks' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Outstanding" value={countsUnknown ? '—' : tasks.filter((t) => !t.done).length} tone="warning" />
        <StatTile
          label="Critical"
          value={countsUnknown ? '—' : tasks.filter((t) => !t.done && t.priority === 'Critical').length}
          tone="danger"
        />
        <StatTile label="Completed" value={countsUnknown ? '—' : completedCount} tone="success" />
        <StatTile
          label="Completion"
          value={countsUnknown || tasks.length === 0 ? '—' : `${Math.round((completedCount / tasks.length) * 100)}%`}
          tone="accent"
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {TASK_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setFilter(type)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              filter === type
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-muted-foreground hover:border-accent/35 hover:text-foreground',
            )}
          >
            {type}
            {type !== 'All' && (
              <span className="num ml-1.5 text-[11px] opacity-70">
                {tasks.filter((t) => t.type === type && !t.done).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading your tasks" />
      ) : error ? (
        <ErrorState title="Could not load your tasks" message={error} onRetry={refetch} />
      ) : (
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
            <TabsTrigger value="done">Completed ({done.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            {pending.length === 0 ? (
              <SectionCard title="Nothing outstanding" description="Every task in this filter is complete.">
                <div className="flex flex-col items-center py-10 text-center">
                  <CheckCircle2 className="mb-3 size-9 text-success" />
                  <p className="text-sm font-semibold">Shift tasks are clear</p>
                  <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
                    New tasks appear here as doctors add instructions and medication rounds fall due.
                  </p>
                  <Button variant="outline" className="mt-4" onClick={() => setFilter('All')}>
                    Show all task types
                  </Button>
                </div>
              </SectionCard>
            ) : (
              <div className="space-y-5">
                {Object.entries(byWard).map(([ward, wardTasks]) => (
                  <SectionCard key={ward} title={ward} description={`${wardTasks.length} outstanding`}>
                    <ul className="space-y-2">
                      {wardTasks.map((task) => (
                        <li key={task.id}>
                          <TaskRow task={task} />
                        </li>
                      ))}
                    </ul>
                  </SectionCard>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="done">
            <SectionCard title="Completed this shift" description="Uncheck to reopen a task.">
              {done.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">Nothing completed yet this shift.</p>
              ) : (
                <ul className="space-y-2">
                  {done.map((task) => (
                    <li key={task.id}>
                      <TaskRow task={task} />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}
    </>
  )
}
