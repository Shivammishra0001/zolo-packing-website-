import * as React from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, LogOut } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox, InitialsAvatar, Progress } from '@/components/ui/misc'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { todayIso } from '@/services/appointmentService'
import {
  discharge as dischargeApi,
  listAdmissions,
  setChecklistItem,
  type AdmissionRecord,
} from '@/services/admissionService'
import { listInvoices } from '@/services/invoiceService'
import { useAuth } from '@/context/AuthContext'
import { formatDate, inr } from '@/lib/utils'

export default function NurseDischarges() {
  const toast = useToast()
  const today = React.useMemo(() => todayIso(), [])

  const { has } = useAuth()
  const canSeeBilling = has('billing.view')
  const { data: openInvoices } = useQuery(
    () => listInvoices({ outstanding: true, limit: 100 }),
    [canSeeBilling],
    { enabled: canSeeBilling },
  )

  const { data, loading, error, refetch } = useQuery(
    () => listAdmissions({ status: 'Discharge Pending', limit: 100 }),
    [],
  )
  const {
    data: closed,
    error: closedError,
    refetch: refetchClosed,
  } = useQuery(() => listAdmissions({ status: 'Discharged', limit: 100 }), [])

  // Ticking a line returns the whole admission, so the progress bar and the
  // discharge button read the server's own figures rather than a local count.
  const [patched, setPatched] = React.useState<Record<string, AdmissionRecord>>({})
  const [busyItem, setBusyItem] = React.useState<string | null>(null)
  const [confirmFor, setConfirmFor] = React.useState<AdmissionRecord | null>(null)

  const pending = (data?.items ?? []).map((admission) => patched[admission.id] ?? admission)
  const dischargedToday = (closed?.items ?? []).filter((a) => a.dischargeDate === today)
  // A tile shows "—" rather than a zero it cannot stand behind.
  const countsUnknown = loading || error !== null

  async function toggle(itemId: string, done: boolean) {
    setBusyItem(itemId)
    try {
      const updated = await setChecklistItem(itemId, done)
      setPatched((prev) => ({ ...prev, [updated.id]: updated }))
    } catch (err) {
      toast.error(
        'Could not update the checklist',
        err instanceof Error ? err.message : 'Please try again.',
      )
    } finally {
      setBusyItem(null)
    }
  }

  async function complete(admission: AdmissionRecord) {
    try {
      await dischargeApi(admission.id)
      setPatched((prev) => {
        const next = { ...prev }
        delete next[admission.id]
        return next
      })
      refetch()
      refetchClosed()
      toast.success(
        'Discharge completed',
        `${admission.patientName} has been discharged and the bed released.`,
      )
    } catch (err) {
      toast.error(
        'Could not complete the discharge',
        err instanceof Error ? err.message : 'Please try again.',
      )
    }
  }

  return (
    <>
      <PageHeader
        title="Discharges"
        description="Patients cleared to leave, and what still stands in the way."
        crumbs={[{ label: 'Nurse', to: '/nurse/dashboard' }, { label: 'Discharges' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Discharge pending" value={countsUnknown ? '—' : pending.length} tone="warning" />
        <StatTile label="Completed today" value={closedError ? '—' : dischargedToday.length} tone="success" />
        <StatTile
          label="Beds freeing up"
          value={countsUnknown ? '—' : pending.length}
          hint="Housekeeping is notified automatically"
          tone="info"
        />
      </div>

      {loading ? (
        <LoadingState label="Loading pending discharges" />
      ) : error ? (
        <ErrorState title="Could not load pending discharges" message={error} onRetry={refetch} />
      ) : pending.length === 0 ? (
        <SectionCard title="No discharges pending" description="Every cleared patient has left the ward.">
          <div className="flex flex-col items-center py-12 text-center">
            <CheckCircle2 className="mb-3 size-9 text-success" />
            <p className="text-sm font-semibold">All discharges complete</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              When a doctor marks a patient ready to leave, the checklist appears here.
            </p>
          </div>
        </SectionCard>
      ) : (
        <div className="space-y-5">
          {pending.map((admission, di) => {
            const doneCount = admission.checklist.filter((i) => i.done).length
            const blockers = admission.checklist.filter((i) => !i.done)
            const invoice = openInvoices?.items.find((i) => i.patientId === admission.patientId)
            const balance = invoice?.balance ?? 0

            return (
              <SectionCard
                key={admission.id}
                title={admission.patientName}
                description={`${admission.ward} · ${admission.bed} · under ${admission.attendingDoctor}`}
                delay={di * 0.05}
                action={
                  <Badge variant="warning">
                    {admission.expectedDischarge ? formatDate(admission.expectedDischarge) : 'Date to confirm'}
                  </Badge>
                }
              >
                <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
                  <div>
                    <div className="mb-3 flex items-baseline justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Discharge checklist
                      </p>
                      <span className="num text-[12.5px] font-semibold">
                        {doneCount} of {admission.checklist.length}
                      </span>
                    </div>
                    <Progress
                      value={admission.checklistProgress}
                      className="mb-4"
                      tone={admission.checklistComplete ? 'success' : 'accent'}
                    />

                    <ul className="space-y-2">
                      {admission.checklist.map((item) => (
                        <li key={item.id}>
                          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 text-[13px] transition-colors hover:bg-muted/45">
                            <Checkbox
                              checked={item.done}
                              disabled={busyItem === item.id}
                              onCheckedChange={(v) => toggle(item.id, v === true)}
                            />
                            <span className={item.done ? 'text-muted-foreground line-through' : ''}>{item.label}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <aside className="space-y-4">
                    <div className="rounded-xl border border-border p-4">
                      <div className="flex items-center gap-2.5">
                        <InitialsAvatar
                          initials={admission.patientInitials}
                          color={admission.patientAvatarColor}
                          className="size-10"
                        />
                        <div className="min-w-0">
                          <Link
                            to={`/patients/${admission.patientId}`}
                            className="block truncate text-[13.5px] font-semibold hover:text-accent"
                          >
                            {admission.patientName}
                          </Link>
                          <p className="num truncate text-[11.5px] text-muted-foreground">
                            {admission.patientId} · {admission.age ?? '—'} yrs
                          </p>
                        </div>
                      </div>
                      <dl className="mt-3 space-y-2 border-t border-border pt-3 text-[12.5px]">
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Admitted</dt>
                          <dd className="font-medium">{formatDate(admission.admissionDate)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Condition</dt>
                          <dd className="text-right font-medium">{admission.primaryCondition ?? '—'}</dd>
                        </div>
                      </dl>
                    </div>

                    <div
                      className={`rounded-xl border p-4 ${
                        !canSeeBilling
                          ? 'border-border'
                          : balance > 0
                            ? 'border-destructive/25 bg-destructive/[0.05]'
                            : 'border-success/25 bg-success/[0.05]'
                      }`}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Billing status
                      </p>
                      <p className="num mt-1 text-lg font-bold">
                        {!canSeeBilling ? 'Not shown' : balance > 0 ? inr(balance) : 'Cleared'}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {!canSeeBilling
                          ? 'Accounts will confirm the balance before the patient leaves.'
                          : balance > 0
                            ? `Outstanding on ${invoice?.id}`
                            : 'No outstanding balance'}
                      </p>
                    </div>

                    <ul className="space-y-1.5">
                      {blockers.map((blocker) => (
                        <li key={blocker.id} className="flex items-start gap-2 text-[12px] text-muted-foreground">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
                          {blocker.label}
                        </li>
                      ))}
                    </ul>

                    <Button
                      className="w-full"
                      disabled={!admission.checklistComplete}
                      onClick={() => setConfirmFor(admission)}
                    >
                      <LogOut />
                      {admission.checklistComplete ? 'Complete discharge' : `${blockers.length} items remaining`}
                    </Button>
                  </aside>
                </div>
              </SectionCard>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmFor !== null}
        onOpenChange={(open) => !open && setConfirmFor(null)}
        title="Complete this discharge?"
        description="The bed will be released to housekeeping and the patient record moves to Discharged. This cannot be undone from the ward."
        confirmLabel="Complete discharge"
        onConfirm={async () => {
          if (confirmFor) await complete(confirmFor)
          setConfirmFor(null)
        }}
      />
    </>
  )
}
