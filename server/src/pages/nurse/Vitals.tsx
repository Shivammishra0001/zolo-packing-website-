import * as React from 'react'
import { Link } from 'react-router-dom'
import { Save } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { VitalsGrid } from '@/components/patients/VitalsGrid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { InitialsAvatar } from '@/components/ui/misc'
import { StatusBadge } from '@/components/ui/status'
import { DataTable, type Column } from '@/components/ui/data-table'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { todayIso } from '@/services/appointmentService'
import type { AdmissionRecord } from '@/services/admissionService'
import { ipdPatients, recordAdmissionVitals } from '@/services/nursingService'
import { listVitals, type VitalsRecord } from '@/services/vitalsService'
import { cn } from '@/lib/utils'

function timeOf(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Mean of the readings that were actually taken.
 *
 * Averaging over the row count rather than the reading count would quietly
 * drag the figure down every time a nurse skipped one.
 */
function average(values: (number | null)[]): number | null {
  const taken = values.filter((v): v is number => v != null)
  if (taken.length === 0) return null
  return Math.round(taken.reduce((a, b) => a + b, 0) / taken.length)
}

export default function NurseVitals() {
  const toast = useToast()
  const today = React.useMemo(() => todayIso(), [])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const { data: ipdData, loading: loadingIpd, error: ipdError, refetch: refetchIpd } = useQuery(
    () => ipdPatients(),
    [],
  )

  const inpatients = ipdData ?? []
  // Nothing is selected until the round is loaded, so the first bed stands in.
  const patient: AdmissionRecord | undefined =
    inpatients.find((a) => a.id === selectedId) ?? inpatients[0]

  const {
    data: history,
    loading: loadingVitals,
    error: vitalsError,
    refetch: refetchVitals,
  } = useQuery(() => listVitals(patient!.patientId), [patient?.patientId], {
    enabled: Boolean(patient),
  })

  const vitals = history ?? []
  const latest = vitals[0]
  // The tiles average the most recent readings only, which is what the hints
  // beneath them claim.
  const recent = vitals.slice(0, 5)
  const readingsToday = vitals.filter((v) => v.recordedAt.slice(0, 10) === today).length

  const [form, setForm] = React.useState({
    systolic: '',
    diastolic: '',
    heartRate: '',
    temperature: '',
    spo2: '',
    respiratoryRate: '',
  })
  const [saving, setSaving] = React.useState(false)

  const historyColumns: Column<VitalsRecord>[] = [
    {
      key: 'time',
      header: 'Recorded',
      primary: true,
      cell: (row) => (
        <div>
          <p className="font-medium">{timeOf(row.recordedAt)}</p>
          <p className="text-[11.5px] text-muted-foreground">{row.recordedBy}</p>
        </div>
      ),
      sortValue: (row) => row.recordedAt,
    },
    {
      key: 'bp',
      header: 'BP',
      cell: (row) => (
        <span
          className={cn(
            'num',
            // A reading nobody took is not a high reading. Comparing null
            // against a threshold would flag it amber either way.
            row.systolic != null &&
              row.diastolic != null &&
              (row.systolic >= 140 || row.diastolic >= 90) &&
              'font-semibold text-warning',
          )}
        >
          {row.systolic == null && row.diastolic == null
            ? '—'
            : `${row.systolic ?? '—'}/${row.diastolic ?? '—'}`}
        </span>
      ),
    },
    { key: 'hr', header: 'HR', cell: (row) => <span className="num">{row.heartRate ?? '—'}</span> },
    {
      key: 'temp',
      header: 'Temp',
      cell: (row) => <span className="num">{row.temperature == null ? '—' : `${row.temperature}°C`}</span>,
    },
    {
      key: 'spo2',
      header: 'SpO₂',
      cell: (row) => (
        <span className={cn('num', row.spo2 != null && row.spo2 < 95 && 'font-semibold text-warning')}>
          {row.spo2 == null ? '—' : `${row.spo2}%`}
        </span>
      ),
    },
    { key: 'rr', header: 'RR', cell: (row) => <span className="num">{row.respiratoryRate ?? '—'}</span> },
  ]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!patient) return
    const missing = Object.entries(form).filter(([, v]) => !v)
    if (missing.length > 0) {
      toast.error('Incomplete reading', 'Fill in every field before saving the vitals round.')
      return
    }
    setSaving(true)
    try {
      // Posted against the stay, not the patient: the API refuses an
      // observation for somebody who is not in a bed.
      await recordAdmissionVitals(patient.id, {
        systolic: Number(form.systolic),
        diastolic: Number(form.diastolic),
        heartRate: Number(form.heartRate),
        temperature: Number(form.temperature),
        spo2: Number(form.spo2),
        respiratoryRate: Number(form.respiratoryRate),
      })
      toast.success(
        'Vitals recorded',
        `${patient.patientName}: ${form.systolic}/${form.diastolic} mmHg, SpO₂ ${form.spo2}%.`,
      )
      setForm({ systolic: '', diastolic: '', heartRate: '', temperature: '', spo2: '', respiratoryRate: '' })
      refetchVitals()
    } catch (err) {
      toast.error('Could not record the vitals', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Vitals round"
        description="Record observations for inpatients and review the trend since admission."
        crumbs={[{ label: 'Nurse', to: '/nurse/dashboard' }, { label: 'Vitals Rounds' }]}
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <SectionCard
          title="Inpatients"
          description={loadingIpd ? 'Loading inpatients…' : `${inpatients.length} beds occupied.`}
          bodyClassName="p-2"
        >
          {loadingIpd ? (
            <LoadingState label="Loading inpatients" className="border-0 shadow-none" />
          ) : ipdError ? (
            <ErrorState
              title="Could not load inpatients"
              message={ipdError}
              onRetry={refetchIpd}
              className="border-0 shadow-none"
            />
          ) : inpatients.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">No beds are occupied right now.</p>
          ) : (
            <ul className="space-y-1">
              {inpatients.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors',
                      p.id === patient?.id ? 'bg-accent/10' : 'hover:bg-muted',
                    )}
                  >
                    <InitialsAvatar
                      initials={p.patientInitials}
                      color={p.patientAvatarColor}
                      className="size-9"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{p.patientName}</span>
                      <span className="num block truncate text-[11.5px] text-muted-foreground">
                        {p.ward} · {p.bed}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {patient && (
          <div className="space-y-5">
            <SectionCard
              title={patient.patientName}
              description={`${patient.ward} · ${patient.bed} · ${patient.primaryCondition ?? 'No condition recorded'}`}
              action={<StatusBadge status={patient.status} />}
              viewAllHref={`/patients/${patient.patientId}`}
              viewAllLabel="Open record"
            >
              {loadingVitals ? (
                <LoadingState label="Loading the latest observation" className="border-0 shadow-none" />
              ) : vitalsError ? (
                <ErrorState
                  title="Could not load the observations"
                  message={vitalsError}
                  onRetry={refetchVitals}
                  className="border-0 shadow-none"
                />
              ) : !latest ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">
                  Nothing has been recorded for this patient yet.
                </p>
              ) : (
                <>
                  <VitalsGrid vitals={latest} />
                  <p className="mt-3 text-[12px] text-muted-foreground">
                    Last recorded {timeOf(latest.recordedAt)} by {latest.recordedBy}.
                  </p>
                </>
              )}
            </SectionCard>

            <SectionCard title="Record new observation" description="Saved against the current shift." delay={0.05}>
              <form onSubmit={submit}>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Systolic BP" htmlFor="sys" hint="mmHg">
                    <Input
                      id="sys"
                      type="number"
                      placeholder="120"
                      value={form.systolic}
                      onChange={(e) => setForm((f) => ({ ...f, systolic: e.target.value }))}
                    />
                  </Field>
                  <Field label="Diastolic BP" htmlFor="dia" hint="mmHg">
                    <Input
                      id="dia"
                      type="number"
                      placeholder="80"
                      value={form.diastolic}
                      onChange={(e) => setForm((f) => ({ ...f, diastolic: e.target.value }))}
                    />
                  </Field>
                  <Field label="Heart rate" htmlFor="hr" hint="beats per minute">
                    <Input
                      id="hr"
                      type="number"
                      placeholder="76"
                      value={form.heartRate}
                      onChange={(e) => setForm((f) => ({ ...f, heartRate: e.target.value }))}
                    />
                  </Field>
                  <Field label="Temperature" htmlFor="temp" hint="degrees Celsius">
                    <Input
                      id="temp"
                      type="number"
                      step="0.1"
                      placeholder="36.8"
                      value={form.temperature}
                      onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
                    />
                  </Field>
                  <Field label="SpO₂" htmlFor="spo2" hint="percent on room air">
                    <Input
                      id="spo2"
                      type="number"
                      placeholder="98"
                      value={form.spo2}
                      onChange={(e) => setForm((f) => ({ ...f, spo2: e.target.value }))}
                    />
                  </Field>
                  <Field label="Respiratory rate" htmlFor="rr" hint="breaths per minute">
                    <Input
                      id="rr"
                      type="number"
                      placeholder="16"
                      value={form.respiratoryRate}
                      onChange={(e) => setForm((f) => ({ ...f, respiratoryRate: e.target.value }))}
                    />
                  </Field>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12px] text-muted-foreground">
                    Readings outside the expected range are highlighted automatically for the treating doctor.
                  </p>
                  <Button type="submit" loading={saving}>
                    <Save />
                    Save vitals
                  </Button>
                </div>
              </form>
            </SectionCard>

            <SectionCard title="Observation history" description="Most recent first." delay={0.1}>
              {vitalsError ? (
                <ErrorState
                  title="Could not load the observations"
                  message={vitalsError}
                  onRetry={refetchVitals}
                  className="border-0 shadow-none"
                />
              ) : (
                <DataTable
                  columns={historyColumns}
                  rows={vitals}
                  rowKey={(row) => row.id}
                  loading={loadingVitals}
                  initialSort={{ key: 'time', dir: 'desc' }}
                />
              )}
            </SectionCard>

            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label="Average systolic"
                value={average(recent.map((v) => v.systolic)) ?? '—'}
                hint="Across the last 5 readings"
              />
              <StatTile
                label="Average SpO₂"
                value={(() => {
                  const mean = average(recent.map((v) => v.spo2))
                  return mean == null ? '—' : `${mean}%`
                })()}
                tone="success"
              />
              <StatTile
                label="Readings today"
                value={loadingVitals ? '—' : readingsToday}
                hint={<Link to={`/patients/${patient.patientId}`}>Full record</Link>}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
