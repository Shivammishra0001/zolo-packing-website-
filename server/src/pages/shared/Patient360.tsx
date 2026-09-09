import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarPlus, Download, FileText, Printer, Stethoscope, UserRound } from 'lucide-react'
import type {
  Appointment,
  DocumentRecord,
  Invoice,
  MedicalHistoryEntry,
  Prescription,
  TherapySession,
  Vitals,
} from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { PatientHeader } from '@/components/patients/PatientHeader'
import { VitalsGrid } from '@/components/patients/VitalsGrid'
import { RehabProgressPanel } from '@/components/rehab/RehabProgressPanel'
import { RehabProgressChart } from '@/components/charts/RehabProgressChart'
import { AppointmentTimeline } from '@/components/appointments/AppointmentTimeline'
import { PrescriptionDetail } from '@/components/pharmacy/PrescriptionDetail'
import { PatientRecapCard } from '@/components/ai/PatientRecapCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Tabs, TabsContent, TabsScroller, TabsUnderlineTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { Progress, Separator } from '@/components/ui/misc'
import { useToast } from '@/components/ui/toast'
import { rehabCompletion } from '@/lib/rehab'
import { getPatient360 } from '@/services/patientService'
import { useQuery } from '@/hooks/useApi'
import { Skeleton } from '@/components/ui/misc'
import { useAuth } from '@/context/AuthContext'
import { formatDate, inr, to12Hour } from '@/lib/utils'

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'history', label: 'Medical History' },
  { value: 'appointments', label: 'Appointments' },
  { value: 'plan', label: 'Rehab Plan' },
  { value: 'sessions', label: 'Therapy Sessions' },
  { value: 'vitals', label: 'Vitals' },
  { value: 'prescriptions', label: 'Prescriptions' },
  { value: 'billing', label: 'Billing' },
  { value: 'documents', label: 'Documents' },
  { value: 'progress', label: 'Progress' },
]

export default function Patient360() {
  const { patientId } = useParams()
  const toast = useToast()
  const { has } = useAuth()
  const [tab, setTab] = React.useState('overview')
  const [selectedRx, setSelectedRx] = React.useState<Prescription | null>(null)

  const { data, loading, error } = useQuery(
    () => getPatient360(patientId!),
    [patientId],
    { enabled: Boolean(patientId) },
  )

  const patient = data?.patient
  // Named by the server when the signed-in user lacks patient.clinical.view,
  // so an empty tab can say why instead of implying there are no records.
  const restricted = new Set(data?.restrictedSections ?? [])
  const clinicalRestricted = restricted.has('vitals') || restricted.has('medicalHistory')

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-52" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-24 text-center">
        <UserRound className="mb-3 size-10 text-destructive" />
        <h1 className="text-lg font-semibold">Could not load this patient</h1>
        <p className="mt-1 max-w-md text-[13px] text-muted-foreground">{error}</p>
        <Button asChild className="mt-4">
          <Link to="/patients">Back to patients</Link>
        </Button>
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="flex flex-col items-center py-24 text-center">
        <UserRound className="mb-3 size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Patient not found</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          No record exists for “{patientId}” in this workspace.
        </p>
        <Button asChild className="mt-4">
          <Link to="/patients">Back to patients</Link>
        </Button>
      </div>
    )
  }

  const appointments: Appointment[] = data?.appointments ?? []
  const prescriptions: Prescription[] = data?.prescriptions ?? []

  const sessions: TherapySession[] = data?.therapySessions ?? []
  const plan = patient.rehabPlan

  // Billing is not built yet, so the API returns it empty. It is deliberately
  // Real invoices as of Step 11, and withheld outright unless the caller holds
  // billing.view — a clinician reading a record has no business reading its bills.
  const invoices = (data?.invoices ?? []) as Invoice[]
  const outstandingOf = (invoice: Invoice) => Math.max(0, invoice.amount - invoice.paid)

  // A plan with no weekly reviews yet has no points, so never assume one.
  const last = patient.progress.at(-1)
  const first = patient.progress.at(0)

  /* ------------------------------- Table columns ------------------------------ */

  const historyColumns: Column<MedicalHistoryEntry>[] = [
    {
      key: 'title',
      header: 'Entry',
      primary: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.title}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{row.detail}</p>
        </div>
      ),
      sortValue: (row) => row.title,
    },
    {
      key: 'type',
      header: 'Type',
      meta: true,
      cell: (row) => <Badge variant={row.type === 'Allergy' ? 'danger' : 'outline'}>{row.type}</Badge>,
      sortValue: (row) => row.type,
    },
    { key: 'date', header: 'Date', cell: (row) => formatDate(row.date), sortValue: (row) => row.date },
    {
      key: 'clinician',
      header: 'Recorded by',
      cell: (row) => <span className="text-[12.5px] text-muted-foreground">{row.clinician}</span>,
      sortValue: (row) => row.clinician,
    },
  ]

  const sessionColumns: Column<TherapySession>[] = [
    {
      key: 'date',
      header: 'Session',
      primary: true,
      cell: (row) => (
        <div>
          <p className="font-medium">{row.type}</p>
          <p className="num text-[12px] text-muted-foreground">
            {formatDate(row.date)} · {to12Hour(row.time)} · {row.durationMinutes} min
          </p>
        </div>
      ),
      sortValue: (row) => `${row.date}${row.time}`,
    },
    { key: 'therapist', header: 'Therapist', cell: (row) => row.therapist, sortValue: (row) => row.therapist },
    {
      key: 'exercises',
      header: 'Exercises',
      cell: (row) => <span className="text-[12.5px] text-muted-foreground">{row.exercises.join(', ')}</span>,
    },
    {
      key: 'scores',
      header: 'Scores',
      cell: (row) =>
        row.status === 'Completed' ? (
          <span className="num text-[12.5px]">
            Pain {row.painBefore} → {row.painAfter} · Mob {row.mobilityScore} · Str {row.strengthScore}
          </span>
        ) : (
          <span className="text-[12.5px] text-muted-foreground">Not recorded</span>
        ),
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
  ]

  const vitalsColumns: Column<Vitals>[] = [
    {
      key: 'recordedAt',
      header: 'Recorded',
      primary: true,
      cell: (row) => (
        <div>
          <p className="font-medium">
            {new Date(row.recordedAt).toLocaleString('en-IN', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          <p className="text-[11.5px] text-muted-foreground">{row.recordedBy}</p>
        </div>
      ),
      sortValue: (row) => row.recordedAt,
    },
    {
      key: 'bp',
      header: 'BP (mmHg)',
      cell: (row) => (
        <span className="num">
          {row.systolic}/{row.diastolic}
        </span>
      ),
    },
    { key: 'hr', header: 'HR', cell: (row) => <span className="num">{row.heartRate}</span> },
    { key: 'temp', header: 'Temp', cell: (row) => <span className="num">{row.temperature}°C</span> },
    { key: 'spo2', header: 'SpO₂', cell: (row) => <span className="num">{row.spo2}%</span> },
    { key: 'rr', header: 'RR', cell: (row) => <span className="num">{row.respiratoryRate}</span> },
  ]

  const invoiceColumns: Column<Invoice>[] = [
    {
      key: 'id',
      header: 'Invoice',
      primary: true,
      cell: (row) => (
        <div>
          <p className="num font-medium">{row.id}</p>
          <p className="text-[12px] text-muted-foreground">
            {row.department} · {formatDate(row.date)}
          </p>
        </div>
      ),
      sortValue: (row) => row.id,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (row) => <span className="num font-semibold">{inr(row.amount)}</span>,
      sortValue: (row) => row.amount,
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      cell: (row) => <span className="num text-success">{inr(row.paid)}</span>,
      sortValue: (row) => row.paid,
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (row) => (
        <span className={`num font-medium ${outstandingOf(row) > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
          {outstandingOf(row) > 0 ? inr(outstandingOf(row)) : '—'}
        </span>
      ),
      sortValue: (row) => outstandingOf(row),
    },
    { key: 'dueDate', header: 'Due', cell: (row) => formatDate(row.dueDate), sortValue: (row) => row.dueDate },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
  ]

  const documentColumns: Column<DocumentRecord>[] = [
    {
      key: 'name',
      header: 'Document',
      primary: true,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="num text-[11.5px] text-muted-foreground">{row.size}</p>
          </div>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    { key: 'type', header: 'Type', meta: true, cell: (row) => <Badge variant="outline">{row.type}</Badge> },
    { key: 'uploadedOn', header: 'Uploaded', cell: (row) => formatDate(row.uploadedOn), sortValue: (row) => row.uploadedOn },
    { key: 'uploadedBy', header: 'By', cell: (row) => row.uploadedBy, sortValue: (row) => row.uploadedBy },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => toast.success('Download started', `${row.name} (${row.size})`)}
        >
          <Download />
          Download
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Patient 360"
        description="Every clinical, therapy, pharmacy and billing record in one place."
        crumbs={[{ label: 'Patients', to: '/patients' }, { label: patient.name }]}
        actions={
          <>
            <Button variant="outline" onClick={() => toast.success('Summary queued', 'A PDF summary will download shortly.')}>
              <Printer />
              Print summary
            </Button>
            {has('appointment.create') && (
              <Button variant="outline" asChild>
                <Link to="/appointments">
                  <CalendarPlus />
                  Book appointment
                </Link>
              </Button>
            )}
            {has('consultation.manage') && (
              <Button asChild>
                <Link to={`/doctor/consultations/${patient.id}`}>
                  <Stethoscope />
                  Start consultation
                </Link>
              </Button>
            )}
          </>
        }
      />

      <PatientHeader patient={patient} />

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsScroller>
          {TABS.map((t) => (
            <TabsUnderlineTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsUnderlineTrigger>
          ))}
        </TabsScroller>

        {/* -------------------------------- Overview ------------------------------- */}
        <TabsContent value="overview" className="space-y-5">
          <PatientRecapCard patientId={patient.id} />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Rehab progress"
              value={plan ? `${rehabCompletion(patient)}%` : '—'}
              hint={plan ? `${plan.completedSessions} of ${plan.totalSessions} sessions` : 'No active plan'}
              tone="accent"
            />
            <StatTile
              label="Pain score"
              value={last ? `${last.pain} / 10` : '—'}
              hint={first ? `From ${first.pain} at week 1` : 'No progress recorded yet'}
              tone="warning"
            />
            <StatTile
              label="Appointments"
              value={appointments.length}
              hint={
                appointments.length
                  ? `Next: ${appointments.find((a) => a.status === 'Scheduled')?.date ?? 'none scheduled'}`
                  : 'No visits booked'
              }
              tone="info"
            />
            <StatTile
              label="Outstanding"
              value={patient.outstandingAmount > 0 ? inr(patient.outstandingAmount) : 'Cleared'}
              tone={patient.outstandingAmount > 0 ? 'danger' : 'success'}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <SectionCard
              title="Latest vitals"
              description={
                patient.vitals[0]
                  ? `Recorded by ${patient.vitals[0].recordedBy}`
                  : clinicalRestricted
                    ? 'Restricted'
                    : 'Nothing recorded yet'
              }
              className="xl:col-span-2"
            >
              {/*
                An empty array is ordinary: six seeded patients have no
                observations, and build_360 returns none at all to any caller
                without patient.clinical.view. Reading [0] blindly took the
                whole screen down for five of the eight roles.
              */}
              {patient.vitals[0] ? (
                <VitalsGrid vitals={patient.vitals[0]} />
              ) : (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  {clinicalRestricted
                    ? 'Your role does not have access to clinical observations.'
                    : 'No observations have been recorded for this patient yet.'}
                </p>
              )}
            </SectionCard>

            <SectionCard title="Care team & contacts" delay={0.05}>
              <dl className="space-y-3 text-[13px]">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Treating doctor
                  </dt>
                  <dd className="mt-0.5 font-medium">{patient.assignedDoctor}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Primary therapist
                  </dt>
                  <dd className="mt-0.5 font-medium">{patient.assignedTherapist}</dd>
                </div>
                <Separator />
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Emergency contact
                  </dt>
                  <dd className="mt-0.5 font-medium">
                    {patient.emergencyContact.name}
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({patient.emergencyContact.relation})
                    </span>
                  </dd>
                  <dd className="num text-[12.5px] text-muted-foreground">{patient.emergencyContact.phone}</dd>
                </div>
                {patient.insurance && (
                  <>
                    <Separator />
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Insurance
                      </dt>
                      <dd className="mt-0.5 font-medium">{patient.insurance.provider}</dd>
                      <dd className="num text-[12.5px] text-muted-foreground">
                        {patient.insurance.policyNo} · valid till {formatDate(patient.insurance.validTill)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>

              {patient.allergies.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-destructive">Allergies</p>
                  <div className="flex flex-wrap gap-1.5">
                    {patient.allergies.map((a) => (
                      <Badge key={a} variant="danger">
                        {a}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
            </SectionCard>
          </div>

          {plan && (
            <SectionCard
              title="Rehabilitation summary"
              description={plan.title}
              action={<StatusBadge status={plan.trend} />}
              delay={0.1}
            >
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="num text-3xl font-bold tracking-tight">{rehabCompletion(patient)}%</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {plan.completedSessions} of {plan.totalSessions} sessions · target {formatDate(plan.targetEndDate)}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setTab('progress')}>
                  See full progress
                </Button>
              </div>
              <Progress value={rehabCompletion(patient)} className="mt-3 h-2" />
              <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">{plan.goal}</p>
            </SectionCard>
          )}

          <SectionCard title="Recent history" description="Latest four clinical entries." delay={0.15}>
            <ul className="space-y-3">
              {patient.history.slice(0, 4).map((entry) => (
                <li key={entry.id} className="rounded-lg border border-border p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13.5px] font-medium">{entry.title}</p>
                    <Badge variant="outline">{entry.type}</Badge>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{entry.detail}</p>
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                    {formatDate(entry.date)} · {entry.clinician}
                  </p>
                </li>
              ))}
            </ul>
          </SectionCard>
        </TabsContent>

        {/* ------------------------------- History -------------------------------- */}
        <TabsContent value="history">
          <SectionCard title="Medical history" description="Diagnoses, surgeries, injuries and chronic conditions.">
            <DataTable
              columns={historyColumns}
              rows={patient.history}
              rowKey={(row) => row.id}
              initialSort={{ key: 'date', dir: 'desc' }}
              emptyTitle={clinicalRestricted ? 'Clinical records are restricted' : 'No history recorded'}
              emptyDescription={
                clinicalRestricted
                  ? 'Your role can see this patient’s demographics but not their clinical record.'
                  : 'Entries added during consultations will appear here.'
              }
            />
          </SectionCard>
        </TabsContent>

        {/* ----------------------------- Appointments ----------------------------- */}
        <TabsContent value="appointments">
          <SectionCard title="Appointments" description="Every booked visit for this patient.">
            <AppointmentTimeline appointments={appointments} showDoctor />
          </SectionCard>
        </TabsContent>

        {/* -------------------------------- Plan --------------------------------- */}
        <TabsContent value="plan">
          <RehabProgressPanel patient={patient} />
        </TabsContent>

        {/* ------------------------------- Sessions ------------------------------- */}
        <TabsContent value="sessions">
          <SectionCard
            title="Therapy sessions"
            description={`${sessions.filter((s) => s.status === 'Completed').length} completed of ${sessions.length} scheduled.`}
          >
            <DataTable
              columns={sessionColumns}
              rows={sessions}
              rowKey={(row) => row.id}
              initialSort={{ key: 'date', dir: 'desc' }}
              emptyTitle="No therapy sessions"
              emptyDescription="Sessions booked against the rehabilitation plan appear here."
            />
          </SectionCard>
        </TabsContent>

        {/* -------------------------------- Vitals -------------------------------- */}
        <TabsContent value="vitals" className="space-y-5">
          <SectionCard
            title="Latest observation"
            description={
              patient.vitals[0]
                ? `Recorded by ${patient.vitals[0].recordedBy}`
                : clinicalRestricted
                  ? 'Restricted'
                  : 'Nothing recorded yet'
            }
          >
            {patient.vitals[0] ? (
              <VitalsGrid vitals={patient.vitals[0]} />
            ) : (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                {clinicalRestricted
                  ? 'Your role does not have access to clinical observations.'
                  : 'No observations have been recorded for this patient yet.'}
              </p>
            )}
          </SectionCard>

          <SectionCard title="Observation history" description="Most recent first." delay={0.05}>
            <DataTable
              columns={vitalsColumns}
              rows={patient.vitals}
              rowKey={(row) => row.recordedAt}
              initialSort={{ key: 'recordedAt', dir: 'desc' }}
            />
          </SectionCard>
        </TabsContent>

        {/* ----------------------------- Prescriptions ---------------------------- */}
        <TabsContent value="prescriptions">
          <SectionCard title="Prescriptions" description="Select a prescription to see the full detail.">
            {prescriptions.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-muted-foreground">
                No prescriptions have been written for this patient.
              </p>
            ) : (
              <ul className="space-y-3">
                {prescriptions.map((rx) => (
                  <li key={rx.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedRx(rx)}
                      className="w-full rounded-xl border border-border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="num text-[13.5px] font-semibold">{rx.id}</p>
                        <div className="flex items-center gap-1.5">
                          {rx.priority === 'Urgent' && <Badge variant="danger">Urgent</Badge>}
                          <StatusBadge status={rx.status} />
                        </div>
                      </div>
                      <p className="mt-1 text-[12.5px] text-muted-foreground">
                        {rx.doctor} · {formatDate(rx.date)} · {rx.items.length} medicine
                        {rx.items.length > 1 ? 's' : ''}
                      </p>
                      <p className="mt-2 truncate text-[13px]">{rx.items.map((i) => i.medicine).join(', ')}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        {/* -------------------------------- Billing ------------------------------- */}
        <TabsContent value="billing" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Total billed" value={inr(invoices.reduce((a, i) => a + i.amount, 0))} />
            <StatTile label="Paid" value={inr(invoices.reduce((a, i) => a + i.paid, 0))} tone="success" />
            <StatTile
              label="Outstanding"
              value={inr(invoices.reduce((a, i) => a + outstandingOf(i), 0))}
              tone={patient.outstandingAmount > 0 ? 'danger' : 'success'}
            />
          </div>

          <SectionCard title="Invoices" description="Every invoice raised for this patient." delay={0.05}>
            <DataTable
              columns={invoiceColumns}
              rows={invoices}
              rowKey={(row) => row.id}
              initialSort={{ key: 'dueDate', dir: 'desc' }}
              emptyTitle="No invoices"
              emptyDescription="Invoices raised at the front desk or pharmacy appear here."
            />
          </SectionCard>

          {invoices.length > 0 && (
            <SectionCard title="Latest invoice breakdown" description={invoices[0].id} delay={0.1}>
              <ul className="space-y-2">
                {invoices[0].items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-3 border-b border-border/60 pb-2.5 text-[13px] last:border-0"
                  >
                    <span className="min-w-0 flex-1">
                      {item.label}
                      {item.qty > 1 && <span className="ml-1.5 text-muted-foreground">× {item.qty}</span>}
                    </span>
                    <span className="num shrink-0 font-medium">{inr(item.qty * item.rate)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-baseline justify-between rounded-lg bg-muted/55 px-4 py-3">
                <span className="text-[13.5px] font-semibold">Invoice total</span>
                <span className="num text-lg font-bold">{inr(invoices[0].amount)}</span>
              </div>
            </SectionCard>
          )}
        </TabsContent>

        {/* ------------------------------ Documents ------------------------------- */}
        <TabsContent value="documents">
          <SectionCard title="Documents" description="Reports, scans, consents and insurance paperwork.">
            <DataTable
              columns={documentColumns}
              rows={patient.documents}
              rowKey={(row) => row.id}
              initialSort={{ key: 'uploadedOn', dir: 'desc' }}
              emptyTitle="No documents"
              emptyDescription="Uploaded files appear here with who added them and when."
            />
          </SectionCard>
        </TabsContent>

        {/* ------------------------------- Progress ------------------------------- */}
        <TabsContent value="progress" className="space-y-5">
          <RehabProgressPanel patient={patient} />

          <SectionCard title="Score history" description="Every recorded weekly review." delay={0.05}>
            <RehabProgressChart data={patient.progress} height={320} />

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Week', 'Pain', 'Mobility', 'Strength', 'Adherence'].map((h, i) => (
                      <th
                        key={h}
                        className={`py-2 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground ${
                          i === 0 ? 'text-left' : 'text-right'
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {patient.progress.map((point) => (
                    <tr key={point.week} className="border-b border-border/70 last:border-0">
                      <td className="py-2.5 text-[13px] font-medium">{point.week}</td>
                      <td className="num py-2.5 text-right text-[13px]">{point.pain}</td>
                      <td className="num py-2.5 text-right text-[13px]">{point.mobility}</td>
                      <td className="num py-2.5 text-right text-[13px]">{point.strength}</td>
                      <td className="num py-2.5 text-right text-[13px]">{point.adherence}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <PrescriptionDetail prescription={selectedRx} onOpenChange={(open) => !open && setSelectedRx(null)} />
    </>
  )
}
